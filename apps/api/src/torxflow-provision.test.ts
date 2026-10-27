import type { SecretRecord, SecretStore } from "@rakazo/adapter-kit";
import type * as Adapters from "@rakazo/adapters";
import type { McpServer as McpServerRow, PrismaClient } from "@rakazo/db";
import type * as Logging from "@rakazo/logging";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TorxflowMcpServers, TorxflowTool } from "./torxflow-provision.js";
import {
  createTorxflowProvisioner,
  TORXFLOW_MCP_SLUG,
  TORXFLOW_RULE_SOURCE,
  torxflowBotSpawnKey,
  torxflowPersonaFetcher,
  torxflowToolLister,
} from "./torxflow-provision.js";

const logged = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock("@rakazo/logging", async (importOriginal) => ({
  ...(await importOriginal<typeof Logging>()),
  getLogger: () => logged,
}));

// The rotation path commits through the secret store's cleanup bookkeeping, which needs a database.
vi.mock("@rakazo/adapters", async (importOriginal) => ({
  ...(await importOriginal<typeof Adapters>()),
  persistPreparedSecret: async (
    _prisma: unknown,
    _store: unknown,
    _written: unknown,
    commit: () => Promise<unknown>,
  ) => commit(),
}));

const url = "https://garage.203-0-113-7.sslip.io/tessa/mcp";
const token = "mcp-token-for-tests";
const persona = { name: "Tessa", instructions: "Help the garage staff." };
/** What TorxFlow's tessa lists: lookups declare readOnlyHint, writes declare false, one is silent. */
const garageTools: TorxflowTool[] = [
  { name: "check_apk_status", readOnly: true },
  { name: "search_inventory", readOnly: true },
  { name: "request_appointment", readOnly: false },
  { name: "save_card", readOnly: false },
  { name: "start_video_job", readOnly: false },
  { name: "finish_video_job", readOnly: false },
  { name: "higgsfield_render", readOnly: false },
  { name: "undeclared_tool" },
];
const readOnlyRules = ["check_apk_status", "search_inventory"].map(
  (name) => `mcp__${TORXFLOW_MCP_SLUG}__${name}`,
);

type Row = Record<string, unknown> & { id: string };

/** A database with the unique keys provisioning relies on, and a record of every write. */
function fixture(mcp = { url, token }) {
  const servers = new Map<string, McpServerRow & Row>();
  const secretsTable = new Map<string, Row>();
  const bots = new Map<string, Row>();
  const assignments = new Map<string, Row>();
  const vault = new Map<string, string>();
  type RuleRow = Row & {
    userId?: string;
    spaceId?: string;
    createdByUserId?: string;
    effect: string;
    matchKind: string;
    matchValue: string;
    source: string | null;
  };
  /** Account copies (`userActionApprovalRule`) and Space copies (`actionApprovalRule`). */
  const accountRules: RuleRow[] = [];
  const spaceRules: RuleRow[] = [];
  const overrides = new Set<string>();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;
  const serverKey = (spaceId: string, userId: string) =>
    `${spaceId}:${userId}:${TORXFLOW_MCP_SLUG}`;

  /** A rules table keyed like the schema's unique index, so a duplicate create is skipped. */
  const ruleTable = (rows: RuleRow[], owner: (row: Record<string, unknown>) => string) => ({
    findMany: async ({ where }: { where: Record<string, string> }) =>
      rows.filter((row) =>
        Object.entries(where).every(
          ([key, value]) => (row as Record<string, unknown>)[key] === value,
        ),
      ),
    deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
      for (const id of where.id.in) {
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows.splice(index, 1);
      }
    },
    createMany: async ({
      data,
      skipDuplicates,
    }: {
      data: Array<Record<string, unknown>>;
      skipDuplicates?: boolean;
    }) => {
      for (const item of data) {
        const key = (row: Record<string, unknown>) =>
          [owner(row), row.effect, row.matchKind, row.matchValue].join("|");
        if (rows.some((row) => key(row) === key(item))) {
          if (!skipDuplicates) throw Object.assign(new Error("unique"), { code: "P2002" });
          continue;
        }
        rows.push({ id: nextId("rule"), ...item } as RuleRow);
      }
    },
  });
  const tx = {
    $queryRaw: async () => [{ locked: 1 }],
    spaceSettingOverride: {
      findUnique: async ({
        where,
      }: {
        where: { spaceId_userId_setting: { spaceId: string; userId: string; setting: string } };
      }) => {
        const { spaceId, userId, setting } = where.spaceId_userId_setting;
        return overrides.has(`${spaceId}:${userId}:${setting}`) ? { setting } : null;
      },
    },
    userActionApprovalRule: ruleTable(accountRules, (row) => String(row.userId)),
    actionApprovalRule: ruleTable(
      spaceRules,
      (row) => `${String(row.spaceId)}:${String(row.createdByUserId)}`,
    ),
    secret: {
      create: async ({ data }: { data: Row }) => {
        secretsTable.set(data.id, data);
        return data;
      },
      deleteMany: async ({ where }: { where: { id: string } }) => {
        secretsTable.delete(where.id);
      },
    },
    mcpServer: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = [...servers.values()].find((server) => server.id === where.id)!;
        const next = { ...row, ...data, revision: row.revision + 1 } as McpServerRow & Row;
        servers.set(serverKey(row.spaceId, row.userId), next);
        return next;
      },
    },
  };
  const prisma = {
    mcpServer: {
      findUnique: async ({
        where,
      }: {
        where: { spaceId_userId_slug: { spaceId: string; userId: string } };
      }) => {
        const { spaceId, userId } = where.spaceId_userId_slug;
        return servers.get(serverKey(spaceId, userId)) ?? null;
      },
      findUniqueOrThrow: async ({
        where,
      }: {
        where: { spaceId_userId_slug: { spaceId: string; userId: string } };
      }) => {
        const { spaceId, userId } = where.spaceId_userId_slug;
        return servers.get(serverKey(spaceId, userId))!;
      },
    },
    secret: {
      findFirst: async ({ where }: { where: { id: string } }) => secretsTable.get(where.id) ?? null,
    },
    bot: {
      findUnique: async ({
        where,
      }: {
        where: { spaceId_spawnKey: { spaceId: string; spawnKey: string } };
      }) =>
        bots.get(`${where.spaceId_spawnKey.spaceId}:${where.spaceId_spawnKey.spawnKey}`) ?? null,
    },
    botMcpServer: {
      upsert: async ({
        where,
        create,
      }: {
        where: { botId_serverId: { botId: string; serverId: string } };
        create: Row;
      }) => {
        const key = `${where.botId_serverId.botId}:${where.botId_serverId.serverId}`;
        if (!assignments.has(key)) assignments.set(key, create);
        return assignments.get(key);
      },
    },
    $transaction: async <T>(run: (client: typeof tx) => Promise<T>) => run(tx),
  } as unknown as PrismaClient;

  const secrets = {
    load: async (ref: string) => vault.get(ref)!,
  } as unknown as SecretStore;
  const prepareMcpServer = vi.fn(
    async (_actor: unknown, input: { secret?: string }): Promise<SecretRecord | null> => {
      const id = nextId("secret");
      const ciphertext = `cipher-${id}`;
      vault.set(ciphertext, JSON.stringify({ secret: input.secret, env: {}, headers: {} }));
      return { id, ref: ciphertext, ciphertext };
    },
  );
  const insertMcpServer = vi.fn(
    async (
      client: typeof tx,
      actor: { spaceId: string; userId: string },
      input: { endpoint: string; enabled: boolean },
      stored: SecretRecord | null,
    ) => {
      if (servers.has(serverKey(actor.spaceId, actor.userId)))
        throw Object.assign(new Error("unique"), { code: "P2002" });
      await client.secret.create({ data: { id: stored!.id, ciphertext: stored!.ciphertext } });
      const row = {
        id: nextId("server"),
        spaceId: actor.spaceId,
        userId: actor.userId,
        slug: TORXFLOW_MCP_SLUG,
        endpoint: input.endpoint,
        secretId: stored!.id,
        enabled: input.enabled,
        revision: 1,
      } as unknown as McpServerRow & Row;
      servers.set(serverKey(actor.spaceId, actor.userId), row);
      return row;
    },
  );
  const announceMcpServer = vi.fn(async () => undefined);
  const mcpServers: TorxflowMcpServers = {
    prepareMcpServer,
    insertMcpServer,
    announceMcpServer,
  } as TorxflowMcpServers;
  const createBot = vi.fn(
    async (
      actor: { spaceId: string; userId: string },
      input: { spawnKey: string; name: string; instructions: string },
    ) => {
      const bot = { id: nextId("bot"), ...input, spaceId: actor.spaceId, userId: actor.userId };
      bots.set(`${actor.spaceId}:${input.spawnKey}`, bot);
      return bot;
    },
  );
  const fetchPersona = vi.fn(async () => persona);
  const listTools = vi.fn(async (): Promise<TorxflowTool[]> => garageTools);
  const provision = createTorxflowProvisioner({
    prisma,
    secrets,
    mcp,
    mcpServers,
    createBot,
    persona: fetchPersona,
    tools: listTools,
  });
  const member = (userId: string, spaceId = "garage-space") => ({
    userId,
    email: `${userId}@garage.example`,
    spaceId,
    tenant: { id: "tenant-1", slug: "garage", name: "Garage" },
    role: "member" as const,
  });
  return {
    provision,
    member,
    servers,
    secretsTable,
    bots,
    assignments,
    createBot,
    fetchPersona,
    listTools,
    accountRules,
    spaceRules,
    overrides,
    prepareMcpServer,
    announceMcpServer,
    rebuild: (rotated: { url: string; token: string }) =>
      createTorxflowProvisioner({
        prisma,
        secrets,
        mcp: rotated,
        mcpServers,
        createBot,
        persona: fetchPersona,
        tools: listTools,
      }),
  };
}

describe("createTorxflowProvisioner", () => {
  it("installs the TorxFlow MCP server with its bearer token and attaches it to a new Tessa bot", async () => {
    const f = fixture();
    await f.provision(f.member("user-1"));

    const [server] = [...f.servers.values()];
    expect(f.servers.size).toBe(1);
    expect(server).toMatchObject({
      slug: "torxflow",
      spaceId: "garage-space",
      userId: "user-1",
      endpoint: url,
      enabled: true,
    });
    expect(f.prepareMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "garage-space", userId: "user-1" }),
      expect.objectContaining({
        transport: "streamable_http",
        name: "TorxFlow",
        endpoint: url,
        secret: token,
      }),
    );
    expect(f.announceMcpServer).toHaveBeenCalledTimes(1);
    expect(f.fetchPersona).toHaveBeenCalledWith(url, token);
    expect(f.createBot).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "garage-space", userId: "user-1" }),
      {
        name: "Tessa",
        title: "",
        description: "",
        instructions: "Help the garage staff.",
        notifyOnFinish: true,
        // Persona palette orange (resolves to the "orange" def, gradient ending #EA580C).
        color: "#F97316",
        spawnKey: torxflowBotSpawnKey("user-1"),
      },
    );
    const [bot] = [...f.bots.values()];
    expect([...f.assignments.values()]).toEqual([
      expect.objectContaining({
        botId: bot?.id,
        serverId: server?.id,
        userId: "user-1",
        allowAllTools: true,
      }),
    ]);
  });

  it("changes nothing when run again", async () => {
    const f = fixture();
    await f.provision(f.member("user-1"));
    await f.provision(f.member("user-1"));

    expect(f.servers.size).toBe(1);
    expect(f.secretsTable.size).toBe(1);
    expect(f.bots.size).toBe(1);
    expect(f.assignments.size).toBe(1);
    expect(f.createBot).toHaveBeenCalledTimes(1);
    expect(f.prepareMcpServer).toHaveBeenCalledTimes(1);
    expect(f.fetchPersona).toHaveBeenCalledTimes(1);
  });

  it("gives a second member of the same space their own install and bot, once each", async () => {
    const f = fixture();
    await f.provision(f.member("user-1"));
    await f.provision(f.member("user-2"));
    await f.provision(f.member("user-2"));

    expect(f.servers.size).toBe(2);
    expect(f.bots.size).toBe(2);
    expect(f.assignments.size).toBe(2);
    expect([...f.bots.values()].map((bot) => bot.spawnKey).sort()).toEqual([
      torxflowBotSpawnKey("user-1"),
      torxflowBotSpawnKey("user-2"),
    ]);
  });

  it("does not recreate a Tessa bot the member archived or kept", async () => {
    const f = fixture();
    await f.provision(f.member("user-1"));
    const [bot] = [...f.bots.values()];
    f.assignments.clear();
    await f.provision(f.member("user-1"));
    expect(f.bots.size).toBe(1);
    expect([...f.assignments.values()]).toEqual([expect.objectContaining({ botId: bot?.id })]);
  });

  it("keeps the install when the persona is unreachable and finishes the bot next time", async () => {
    const f = fixture();
    f.fetchPersona.mockRejectedValueOnce(new Error("persona request failed with status 503"));
    await expect(f.provision(f.member("user-1"))).rejects.toThrow("status 503");
    expect(f.servers.size).toBe(1);
    expect(f.bots.size).toBe(0);

    await f.provision(f.member("user-1"));
    expect(f.servers.size).toBe(1);
    expect(f.bots.size).toBe(1);
    expect(f.assignments.size).toBe(1);
  });

  it("points the existing install at a rotated token without a second server", async () => {
    const f = fixture();
    await f.provision(f.member("user-1"));
    const [before] = [...f.servers.values()];

    await f.rebuild({ url, token: "rotated-token" })(f.member("user-1"));

    expect(f.servers.size).toBe(1);
    const [after] = [...f.servers.values()];
    expect(after?.id).toBe(before?.id);
    expect(after?.secretId).not.toBe(before?.secretId);
    expect(after?.revision).toBe(2);
    // The old credential is deleted with the swap.
    expect(f.secretsTable.size).toBe(1);
    expect(f.bots.size).toBe(1);
    expect(f.announceMcpServer).toHaveBeenCalledTimes(2);
  });
});

describe("read-only tool approval rules", () => {
  const ruleValues = (rows: Array<{ matchValue: string }>) =>
    rows.map((row) => row.matchValue).sort();
  const rulesOf = (rows: Array<{ userId?: string }>, userId: string) =>
    rows.filter((row) => row.userId === userId);

  beforeEach(() => logged.error.mockClear());

  it("writes an always-allow rule per tool that declares readOnlyHint, and none for writes", async () => {
    const f = fixture();
    await f.provision(f.member("user-1"));

    expect(f.listTools).toHaveBeenCalledWith(url, token);
    expect(ruleValues(f.accountRules)).toEqual(readOnlyRules);
    for (const rule of f.accountRules) {
      expect(rule).toMatchObject({
        userId: "user-1",
        effect: "always_allow",
        matchKind: "tool",
        source: TORXFLOW_RULE_SOURCE,
      });
    }
    expect(f.spaceRules).toEqual([]);
    expect(f.accountRules.map((rule) => rule.matchValue)).not.toContain(
      "mcp__torxflow__request_appointment",
    );
  });

  it("adds no duplicates when run again, and picks up a new read-only tool", async () => {
    const f = fixture();
    await f.provision(f.member("user-1"));
    await f.provision(f.member("user-1"));
    expect(f.accountRules).toHaveLength(2);

    f.listTools.mockResolvedValue([...garageTools, { name: "list_customers", readOnly: true }]);
    await f.provision(f.member("user-1"));
    expect(ruleValues(f.accountRules)).toEqual(
      [...readOnlyRules, "mcp__torxflow__list_customers"].sort(),
    );
  });

  it("gives each member their own rules, once, as bots and installs are", async () => {
    const f = fixture();
    await f.provision(f.member("user-1"));
    await f.provision(f.member("user-2"));
    await f.provision(f.member("user-2"));

    expect(f.accountRules).toHaveLength(4);
    expect(ruleValues(rulesOf(f.accountRules, "user-1"))).toEqual(readOnlyRules);
    expect(ruleValues(rulesOf(f.accountRules, "user-2"))).toEqual(readOnlyRules);
  });

  it("removes the rule of a tool that stopped being read-only or disappeared", async () => {
    const f = fixture();
    await f.provision(f.member("user-1"));

    f.listTools.mockResolvedValue(
      garageTools
        .filter((tool) => tool.name !== "search_inventory")
        .map((tool) => (tool.name === "check_apk_status" ? { ...tool, readOnly: false } : tool)),
    );
    await f.provision(f.member("user-1"));
    expect(f.accountRules).toEqual([]);
  });

  it("never allows a tool that shares a case-insensitive name with one that is not read-only", async () => {
    const f = fixture();
    f.listTools.mockResolvedValue([
      { name: "Lookup", readOnly: true },
      { name: "lookup", readOnly: false },
      { name: "plain", readOnly: true },
    ]);
    await f.provision(f.member("user-1"));
    expect(ruleValues(f.accountRules)).toEqual(["mcp__torxflow__plain"]);
  });

  it("keeps the rules and the sign-in when the tools cannot be listed", async () => {
    const f = fixture();
    await f.provision(f.member("user-1"));

    f.listTools.mockRejectedValue(new Error("tools/list failed with status 503"));
    await f.provision(f.member("user-1"));
    expect(ruleValues(f.accountRules)).toEqual(readOnlyRules);
    expect(logged.error).toHaveBeenCalledWith(
      "torxflow read-only approval rules",
      expect.objectContaining({ message: "tools/list failed with status 503" }),
    );

    // A first sign-in with the tools down still installs and creates the bot.
    await f.provision(f.member("user-2"));
    expect(f.servers.size).toBe(2);
    expect(f.bots.size).toBe(2);
    expect(rulesOf(f.accountRules, "user-2")).toEqual([]);
  });

  it("writes the rules before the bot, so an unreachable persona does not skip them", async () => {
    const f = fixture();
    f.fetchPersona.mockRejectedValueOnce(new Error("persona request failed with status 503"));
    await expect(f.provision(f.member("user-1"))).rejects.toThrow("status 503");
    expect(ruleValues(f.accountRules)).toEqual(readOnlyRules);
  });

  it("never touches a rule the member made, whatever its effect or case", async () => {
    const f = fixture();
    const own = (effect: string, matchValue: string) => ({
      id: `own-${effect}-${matchValue}`,
      userId: "user-1",
      effect,
      matchKind: "tool",
      matchValue,
      source: null,
    });
    const made = [
      // Their own allow for a lookup, typed in another case: provisioning adds nothing beside it.
      own("always_allow", "MCP__TORXFLOW__SEARCH_INVENTORY"),
      // They blocked a lookup: provisioning must not override that.
      own("deny", "mcp__torxflow__check_apk_status"),
      // They allowed a write tool: provisioning neither adds nor removes it.
      own("always_allow", "mcp__torxflow__request_appointment"),
    ];
    f.accountRules.push(...made);

    await f.provision(f.member("user-1"));
    expect(f.accountRules).toEqual(made);

    // Every tool turns into a write: only provisioned rules go, and there were none.
    f.listTools.mockResolvedValue(garageTools.map((tool) => ({ ...tool, readOnly: false })));
    await f.provision(f.member("user-1"));
    expect(f.accountRules).toEqual(made);
  });

  it("leaves a rule the member made after provisioning added its own", async () => {
    const f = fixture();
    await f.provision(f.member("user-1"));
    // The member blocks a lookup in Settings: the save replaces the provisioned rule.
    const index = f.accountRules.findIndex((rule) => rule.matchValue.endsWith("check_apk_status"));
    f.accountRules.splice(index, 1, {
      id: "own-deny",
      userId: "user-1",
      effect: "deny",
      matchKind: "tool",
      matchValue: "mcp__torxflow__check_apk_status",
      source: null,
    });

    await f.provision(f.member("user-1"));
    expect(f.accountRules.filter((rule) => rule.matchValue.endsWith("check_apk_status"))).toEqual([
      expect.objectContaining({ id: "own-deny", effect: "deny" }),
    ]);
    expect(f.accountRules).toHaveLength(2);
  });

  it("writes to the Space's copy when the member has their own confirmations there", async () => {
    const f = fixture();
    f.overrides.add("garage-space:user-1:confirmations");
    await f.provision(f.member("user-1"));

    expect(f.accountRules).toEqual([]);
    expect(ruleValues(f.spaceRules)).toEqual(readOnlyRules);
    for (const rule of f.spaceRules) {
      expect(rule).toMatchObject({
        spaceId: "garage-space",
        createdByUserId: "user-1",
        effect: "always_allow",
        source: TORXFLOW_RULE_SOURCE,
      });
    }
  });
});

describe("torxflowPersonaFetcher", () => {
  const publicHost = async () => [{ address: "203.0.113.7", family: 4 }];
  const deps = (
    fetch: typeof globalThis.fetch,
    resolveHostname: (host: string) => Promise<Array<{ address: string; family: number }>>,
    mcpAllowPrivateEndpoint = false,
  ) => ({
    remoteConnectors: { fetch, resolveHostname },
    env: { mcpAllowPrivateEndpoint },
  });

  it("reads the persona from <url>/persona with the bearer token", async () => {
    const fetch = vi.fn(async () => Response.json(persona));
    const result = await torxflowPersonaFetcher(deps(fetch as never, publicHost as never) as never)(
      url,
      token,
    );
    expect(result).toEqual(persona);
    const [requested, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(requested)).toBe(`${url}/persona`);
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
  });

  it.each([
    ["an error status", async () => new Response("no", { status: 401 })],
    ["a body without a name", async () => Response.json({ instructions: "x" })],
    ["a body that is not an object", async () => Response.json("Tessa")],
  ])("rejects %s", async (_name, respond) => {
    await expect(
      torxflowPersonaFetcher(deps(vi.fn(respond) as never, publicHost as never) as never)(
        url,
        token,
      ),
    ).rejects.toThrow();
  });

  it("applies the remote MCP egress policy: a private address is refused", async () => {
    const fetch = vi.fn();
    const privateHost = async () => [{ address: "10.0.0.8", family: 4 }];
    await expect(
      torxflowPersonaFetcher(deps(fetch as never, privateHost as never) as never)(url, token),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("torxflowToolLister", () => {
  it("applies the remote MCP egress policy: a private address is refused", async () => {
    const fetch = vi.fn();
    const privateHost = async () => [{ address: "10.0.0.8", family: 4 }];
    const list = torxflowToolLister({
      remoteConnectors: { fetch, resolveHostname: privateHost },
      env: { mcpAllowPrivateEndpoint: false },
    } as never);
    await expect(list(url, token)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
