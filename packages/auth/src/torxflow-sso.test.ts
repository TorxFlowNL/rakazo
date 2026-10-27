import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createAuth } from "./index.js";
import { safeRedirectPath, TorxflowTokenError, verifyTorxflowToken } from "./torxflow-sso.js";

// Better Auth's real routes over its offline memory adapter. The memory adapter accepts a
// repeated primary key, which Postgres rejects; the wrapper restores that so a reserved
// one-time marker (the token's jti) can be taken only once, as it can in production.
vi.mock("better-auth/adapters/prisma", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return {
    prismaAdapter: (prisma: { authData: Record<string, Record<string, unknown>[]> }) => {
      const factory = memoryAdapter(prisma.authData);
      return (options: never) => {
        const adapter = factory(options);
        const create = adapter.create.bind(adapter);
        adapter.create = (async (input: {
          model: string;
          data: Record<string, unknown>;
          forceAllowId?: boolean;
        }) => {
          const rows = prisma.authData[input.model] ?? [];
          if (input.forceAllowId && rows.some((row) => row.id === input.data.id)) {
            throw new Error("Unique constraint failed on the primary key");
          }
          return create(input as never);
        }) as typeof adapter.create;
        return adapter;
      };
    },
  };
});
const joinTorxflowSpace = vi.hoisted(() =>
  vi.fn(async (_prisma: unknown, _user: unknown, _tenant: unknown, _role: unknown) => ({
    spaceId: "garage-space",
    created: true,
  })),
);
vi.mock("@rakazo/db", () => ({
  bootstrapUserSpace: vi.fn(async () => ({ spaceId: "personal-space" })),
  recordSecurityEvent: vi.fn(async () => undefined),
  joinTorxflowSpace,
  TORXFLOW_TENANT_ID: /^[A-Za-z0-9_-]{1,64}$/,
}));

const secret = "torxflow-sso-secret-at-least-32-characters";
const baseURL = "http://auth.example.test";
const now = 1_800_000_000;

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: "torxflow",
    aud: "rakazo",
    iat: now,
    exp: now + 60,
    jti: "jti-0000000001",
    sub: "tf-user-1",
    email: "Ada@Garage.Example",
    name: "Ada Garage",
    tenantId: "tenant-1",
    tenantSlug: "garage-de-vries",
    tenantName: "Garage De Vries",
    role: "owner",
    ...overrides,
  };
}

function sign(payload: Record<string, unknown>, key = secret, header: unknown = { alg: "HS256" }) {
  const body = `${encode(header)}.${encode(payload)}`;
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

describe("verifyTorxflowToken", () => {
  const at = now * 1000;
  const verify = (token: string) => verifyTorxflowToken(token, secret, at);

  it("returns the claims, lower-casing the email", () => {
    expect(verify(sign(claims()))).toEqual({
      jti: "jti-0000000001",
      exp: now + 60,
      sub: "tf-user-1",
      email: "ada@garage.example",
      name: "Ada Garage",
      tenant: { id: "tenant-1", slug: "garage-de-vries", name: "Garage De Vries" },
      role: "owner",
    });
  });

  it.each([
    ["expired", claims({ exp: now - 1 })],
    ["valid for longer than 120 seconds", claims({ exp: now + 121 })],
    ["wrong issuer", claims({ iss: "someone-else" })],
    ["wrong audience", claims({ aud: "other-app" })],
    ["missing jti", claims({ jti: undefined })],
    ["unknown role", claims({ role: "superuser" })],
    ["bad tenant id", claims({ tenantId: "../x" })],
    ["issued in the future", claims({ iat: now + 3600 })],
  ])("refuses a token that is %s", (_name, payload) => {
    expect(() => verify(sign(payload))).toThrow(TorxflowTokenError);
  });

  it("accepts the longest lifetime and refuses a different key", () => {
    expect(verify(sign(claims({ exp: now + 120 }))).exp).toBe(now + 120);
    expect(() => verify(sign(claims(), "another-secret-of-at-least-32-characters"))).toThrow(
      "bad signature",
    );
  });

  it("refuses other algorithms and malformed tokens", () => {
    expect(() => verify(`${encode({ alg: "none" })}.${encode(claims())}.`)).toThrow(
      "unsupported algorithm",
    );
    expect(() => verify(sign(claims(), secret, { alg: "HS512" }))).toThrow("unsupported algorithm");
    expect(() => verify("not-a-token")).toThrow("malformed token");
  });
});

describe("safeRedirectPath", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirectPath("/app/x/clients?tab=1#top")).toBe("/app/x/clients?tab=1#top");
    expect(safeRedirectPath("/")).toBe("/");
  });

  it.each([
    undefined,
    "",
    "app",
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/ok\nSet-Cookie: x=1",
  ])("falls back to / for %j", (value) => {
    expect(safeRedirectPath(value)).toBe("/");
  });
});

function fixture({
  withTorxflow = true,
  provision = vi.fn(async () => undefined),
}: {
  withTorxflow?: boolean;
  provision?: (input: unknown) => Promise<void>;
} = {}) {
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  };
  const prisma = {
    authData: data,
    // The garage membership exists before the session, so no personal space is opened.
    spaceMember: { findFirst: vi.fn(async () => ({ spaceId: "garage-space" })) },
  };
  const log = vi.fn();
  const auth = createAuth(prisma as never, {
    secret: "offline-auth-secret-at-least-32-characters",
    baseURL,
    webOrigin: baseURL,
    signupsEnabled: "false",
    signupAllowlist: "",
    logger: { level: "error", log },
    torxflow: withTorxflow ? { secret, provision } : undefined,
  });
  const sso = (token: string, redirect?: string) => {
    const url = new URL(`${baseURL}/api/auth/torxflow/sso`);
    url.searchParams.set("token", token);
    if (redirect !== undefined) url.searchParams.set("redirect", redirect);
    return auth.handler(new Request(url));
  };
  const fresh = (overrides: Record<string, unknown> = {}) =>
    sign(
      claims({
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        ...overrides,
      }),
    );
  return { data, sso, fresh, provision, log };
}

describe("TorxFlow SSO endpoint", () => {
  it("signs a new user in, links the TorxFlow account and redirects", async () => {
    const f = fixture();
    const response = await f.sso(f.fresh(), "/app/x/clients");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app/x/clients");
    expect(response.headers.get("set-cookie")).toMatch(/better-auth\.session_token=/);
    expect(f.data.user).toHaveLength(1);
    expect(f.data.user?.[0]).toMatchObject({
      email: "ada@garage.example",
      emailVerified: true,
    });
    expect(f.data.account).toEqual([
      expect.objectContaining({ providerId: "torxflow", accountId: "tf-user-1" }),
    ]);
    expect(f.data.session).toHaveLength(1);
    expect(joinTorxflowSpace).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ id: f.data.user?.[0]?.id }),
      { id: "tenant-1", slug: "garage-de-vries", name: "Garage De Vries" },
      "owner",
      expect.anything(),
    );
    expect(f.provision).toHaveBeenCalledWith({
      userId: f.data.user?.[0]?.id,
      email: "ada@garage.example",
      spaceId: "garage-space",
      tenant: { id: "tenant-1", slug: "garage-de-vries", name: "Garage De Vries" },
      role: "owner",
    });
  });

  it("opens the session cookie it sets", async () => {
    const f = fixture();
    const cookie = (await f.sso(f.fresh())).headers.get("set-cookie")!.split(";")[0]!;
    expect(cookie).toMatch(/^better-auth\.session_token=/);
    expect(f.data.session?.[0]).toMatchObject({ userId: f.data.user?.[0]?.id });
  });

  it("defaults to / and never redirects off site", async () => {
    for (const redirect of [
      undefined,
      "https://evil.example/",
      "//evil.example",
      "/\\evil.example",
    ]) {
      const f = fixture();
      const response = await f.sso(f.fresh(), redirect);
      expect(response.headers.get("location")).toBe("/");
    }
  });

  it("signs the same person in again without a second user or account", async () => {
    const f = fixture();
    await f.sso(f.fresh({ jti: "jti-first-0001" }));
    const again = await f.sso(f.fresh({ jti: "jti-second-002" }));
    expect(again.status).toBe(302);
    expect(f.data.user).toHaveLength(1);
    expect(f.data.account).toHaveLength(1);
    expect(f.data.session).toHaveLength(2);
    expect(f.provision).toHaveBeenCalledTimes(2);
  });

  it("links an existing account that has the same email and marks it verified", async () => {
    const f = fixture();
    f.data.user!.push({
      id: "existing",
      email: "ada@garage.example",
      name: "Ada",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect((await f.sso(f.fresh())).status).toBe(302);
    expect(f.data.user).toHaveLength(1);
    expect(f.data.user?.[0]?.emailVerified).toBe(true);
    expect(f.data.account).toEqual([
      expect.objectContaining({
        userId: "existing",
        providerId: "torxflow",
        accountId: "tf-user-1",
      }),
    ]);
  });

  it("never links a different TorxFlow identity to an email that already has one", async () => {
    const f = fixture();
    await f.sso(f.fresh({ jti: "jti-first-0001" }));
    const other = await f.sso(f.fresh({ jti: "jti-second-002", sub: "tf-user-2" }));
    expect(other.status).toBe(401);
    expect(other.headers.get("set-cookie")).toBeNull();
    expect(f.data.account).toHaveLength(1);
    expect(f.data.session).toHaveLength(1);
  });

  it.each([
    ["expired", { exp: Math.floor(Date.now() / 1000) - 5 }],
    ["valid for too long", { exp: Math.floor(Date.now() / 1000) + 600 }],
    ["for another audience", { aud: "other" }],
    ["from another issuer", { iss: "other" }],
  ])("refuses a token that is %s", async (_name, overrides) => {
    const f = fixture();
    const response = await f.sso(f.fresh(overrides));
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(f.data.user).toHaveLength(0);
    expect(f.data.session).toHaveLength(0);
    expect(f.provision).not.toHaveBeenCalled();
  });

  it("refuses a bad signature and an unsigned token", async () => {
    const f = fixture();
    const token = f.fresh();
    const tampered = `${token.slice(0, -4)}AAAA`;
    for (const bad of [tampered, sign(claims(), "x".repeat(40)), "garbage"]) {
      const response = await f.sso(bad);
      expect(response.status).toBe(401);
    }
    expect(f.data.session).toHaveLength(0);
  });

  it("accepts a token once: a replay is refused", async () => {
    const f = fixture();
    const token = f.fresh();
    expect((await f.sso(token)).status).toBe(302);
    const replay = await f.sso(token);
    expect(replay.status).toBe(401);
    expect(replay.headers.get("set-cookie")).toBeNull();
    expect(f.data.session).toHaveLength(1);
  });

  it("refuses the address chat bridges use for their own senders", async () => {
    const f = fixture();
    expect((await f.sso(f.fresh({ email: "x@messaging.invalid" }))).status).toBe(401);
    expect(f.data.user).toHaveLength(0);
  });

  it("signs in even when the bot and tools could not be provisioned", async () => {
    const f = fixture({
      provision: vi.fn(async () => {
        throw new Error("persona unreachable");
      }),
    });
    expect((await f.sso(f.fresh())).status).toBe(302);
    expect(f.data.session).toHaveLength(1);
  });

  it("does not exist unless TorxFlow is configured", async () => {
    const f = fixture({ withTorxflow: false });
    expect((await f.sso(f.fresh())).status).toBe(404);
    expect(f.data.user).toHaveLength(0);
  });
});
