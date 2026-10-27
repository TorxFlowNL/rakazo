import type { SecretRecord, SecretStore } from "@rakazo/adapter-kit";
import { createSafeRemoteFetch, persistPreparedSecret } from "@rakazo/adapters";
import type { TorxflowProvisionInput } from "@rakazo/auth";
import type { Actor, Bot, McpServerConfigInput as McpServerInput } from "@rakazo/contracts";
import { BOT_INSTRUCTIONS_MAX_LENGTH, McpServerConfigInput } from "@rakazo/contracts";
import type { McpServer as McpServerRow, Prisma, PrismaClient } from "@rakazo/db";
import type { McpSecretMaterial } from "./mcp-material.js";
import type { RouterDeps } from "./router.js";
import { isUniqueViolation } from "./routes/shared.js";

/** The slug that identifies the garage's tools among a member's MCP servers. */
export const TORXFLOW_MCP_SLUG = "torxflow";
const PERSONA_TIMEOUT_MS = 5_000;

/** What the garage's persona endpoint answers: the bot's name and its instructions. */
export interface TorxflowPersona {
  name: string;
  instructions: string;
}

function parsePersona(value: unknown): TorxflowPersona {
  if (!value || typeof value !== "object") throw new Error("persona is not an object");
  const name = "name" in value && typeof value.name === "string" ? value.name.trim() : "";
  const instructions =
    "instructions" in value && typeof value.instructions === "string" ? value.instructions : "";
  if (!name || name.length > 120) throw new Error("persona name is missing or too long");
  if (instructions.length > BOT_INSTRUCTIONS_MAX_LENGTH) throw new Error("persona is too long");
  return { name, instructions };
}

/** The key under which a member's Tessa bot is found again, one per space and member. */
export const torxflowBotSpawnKey = (userId: string) => `torxflow:tessa:${userId}`;

/** The parts of `createMcpServers` provisioning reuses, so installs go through the same path as the MCP settings. */
export interface TorxflowMcpServers {
  prepareMcpServer(actor: Actor, input: McpServerInput): Promise<SecretRecord | null>;
  insertMcpServer(
    tx: Prisma.TransactionClient,
    actor: Actor,
    input: McpServerInput,
    stored: SecretRecord | null,
  ): Promise<McpServerRow>;
  announceMcpServer(row: McpServerRow, actor: Actor): Promise<unknown>;
}

export type TorxflowProvisioner = (input: TorxflowProvisionInput) => Promise<void>;

export interface TorxflowProvisionDeps {
  prisma: PrismaClient;
  secrets: SecretStore;
  /** The garage's MCP endpoint and its bearer token. */
  mcp: { url: string; token: string };
  mcpServers: TorxflowMcpServers;
  createBot: (
    actor: Actor,
    input: {
      name: string;
      title: string;
      description: string;
      instructions: string;
      notifyOnFinish: boolean;
      spawnKey: string;
    },
  ) => Promise<Pick<Bot, "id">>;
  /** The same egress policy remote MCP uses, so the persona is fetched from a public https host. */
  persona: (url: string, token: string) => Promise<TorxflowPersona>;
}

/** Fetches `<mcp url>/persona` through the SSRF-checked transport remote MCP servers use. */
export function torxflowPersonaFetcher(
  deps: Pick<RouterDeps, "remoteConnectors" | "env">,
): TorxflowProvisionDeps["persona"] {
  return async (url, token) => {
    const safeFetch = createSafeRemoteFetch(
      deps.remoteConnectors?.fetch,
      deps.remoteConnectors?.resolveHostname,
      { allowPrivateEndpoint: deps.env.mcpAllowPrivateEndpoint === true },
    );
    try {
      const response = await safeFetch(`${url}/persona`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        signal: AbortSignal.timeout(PERSONA_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`persona request failed with status ${response.status}`);
      return parsePersona(await response.json());
    } finally {
      await safeFetch.close();
    }
  };
}

/**
 * Gives one member of a garage space what Tessa needs: the TorxFlow MCP install, and a Tessa bot
 * that uses it. Both are per member because Rakazo keeps bots and MCP servers private to the
 * member who owns them. Every step finds its existing row first, so calling it on each sign-in
 * never duplicates anything, and a step that failed last time is retried.
 */
export function createTorxflowProvisioner(deps: TorxflowProvisionDeps) {
  const { prisma } = deps;
  const mcpInput = McpServerConfigInput.parse({
    slug: TORXFLOW_MCP_SLUG,
    name: "TorxFlow",
    description: "The garage's customers, appointments and tools from TorxFlow.",
    transport: "streamable_http",
    endpoint: deps.mcp.url,
    secret: deps.mcp.token,
  });

  const ensureServer = async (actor: Actor): Promise<{ id: string }> => {
    const where = {
      spaceId_userId_slug: {
        spaceId: actor.spaceId,
        userId: actor.userId,
        slug: TORXFLOW_MCP_SLUG,
      },
    };
    const existing = await prisma.mcpServer.findUnique({ where });
    if (!existing) {
      const stored = await deps.mcpServers.prepareMcpServer(actor, mcpInput);
      try {
        const row = await prisma.$transaction((tx) =>
          deps.mcpServers.insertMcpServer(tx, actor, mcpInput, stored),
        );
        await deps.mcpServers.announceMcpServer(row, actor);
        return row;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return prisma.mcpServer.findUniqueOrThrow({ where });
      }
    }
    if (await credentialsCurrent(actor, existing)) return existing;
    // The endpoint or the token was rotated on the deployment: point the install at the new one.
    const stored = await deps.mcpServers.prepareMcpServer(actor, mcpInput);
    const row = await persistPreparedSecret(prisma, deps.secrets, stored ?? undefined, () =>
      prisma.$transaction(async (tx) => replaceCredentials(tx, actor, existing, stored)),
    );
    await deps.mcpServers.announceMcpServer(row, actor);
    return row;
  };

  const credentialsCurrent = async (
    actor: Actor,
    server: { endpoint: string | null; secretId: string | null },
  ) => {
    if (server.endpoint !== deps.mcp.url || !server.secretId) return false;
    const secret = await prisma.secret.findFirst({
      where: { id: server.secretId, spaceId: actor.spaceId, userId: actor.userId },
    });
    if (!secret) return false;
    try {
      const material: McpSecretMaterial = JSON.parse(
        await deps.secrets.load(secret.ciphertext, { recordId: secret.id }),
      );
      return material.secret === deps.mcp.token;
    } catch {
      return false;
    }
  };

  const replaceCredentials = async (
    tx: Prisma.TransactionClient,
    actor: Actor,
    existing: { id: string; secretId: string | null },
    stored: SecretRecord | null,
  ) => {
    if (stored) {
      await tx.secret.create({
        data: {
          id: stored.id,
          userId: actor.userId,
          spaceId: actor.spaceId,
          kind: "mcp",
          ciphertext: stored.ciphertext,
        },
      });
    }
    const updated = await tx.mcpServer.update({
      where: { id: existing.id },
      data: {
        endpoint: deps.mcp.url,
        secretId: stored?.id ?? null,
        revision: { increment: 1 },
        // The old verdict is about the old config.
        healthStatus: "unknown",
        healthMessage: null,
        healthToolCount: null,
        healthCheckedAt: null,
      },
    });
    if (existing.secretId) {
      await tx.secret.deleteMany({
        where: { id: existing.secretId, spaceId: actor.spaceId, userId: actor.userId },
      });
    }
    return updated;
  };

  const ensureBot = async (actor: Actor, server: { id: string }) => {
    const spawnKey = torxflowBotSpawnKey(actor.userId);
    let bot: { id: string } | null = await prisma.bot.findUnique({
      where: { spaceId_spawnKey: { spaceId: actor.spaceId, spawnKey } },
      select: { id: true },
    });
    if (!bot) {
      const persona = await deps.persona(deps.mcp.url, deps.mcp.token);
      bot = await deps.createBot(actor, {
        name: persona.name,
        title: "",
        description: "",
        instructions: persona.instructions,
        notifyOnFinish: true,
        spawnKey,
      });
    }
    await prisma.botMcpServer.upsert({
      where: { botId_serverId: { botId: bot.id, serverId: server.id } },
      create: {
        spaceId: actor.spaceId,
        userId: actor.userId,
        botId: bot.id,
        serverId: server.id,
        allowAllTools: true,
        allowedTools: [],
      },
      update: {},
    });
  };

  const provision: TorxflowProvisioner = async (input) => {
    const actor: Actor = {
      userId: input.userId,
      spaceId: input.spaceId,
      email: input.email,
      isDeploymentOwner: false,
    };
    // The sign-in keeps going when this throws; the next one retries from where this stopped.
    await ensureBot(actor, await ensureServer(actor));
  };
  return provision;
}
