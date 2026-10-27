import type { SecretRecord, SecretStore } from "@rakazo/adapter-kit";
import type * as Adapters from "@rakazo/adapters";
import type { McpServer as McpServerRow, PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import type { TorxflowMcpServers } from "./torxflow-provision.js";
import {
  createTorxflowProvisioner,
  TORXFLOW_MCP_SLUG,
  torxflowBotSpawnKey,
  torxflowPersonaFetcher,
} from "./torxflow-provision.js";

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

type Row = Record<string, unknown> & { id: string };

/** A database with the unique keys provisioning relies on, and a record of every write. */
function fixture(mcp = { url, token }) {
  const servers = new Map<string, McpServerRow & Row>();
  const secretsTable = new Map<string, Row>();
  const bots = new Map<string, Row>();
  const assignments = new Map<string, Row>();
  const vault = new Map<string, string>();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;
  const serverKey = (spaceId: string, userId: string) =>
    `${spaceId}:${userId}:${TORXFLOW_MCP_SLUG}`;

  const tx = {
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
  const provision = createTorxflowProvisioner({
    prisma,
    secrets,
    mcp,
    mcpServers,
    createBot,
    persona: fetchPersona,
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
