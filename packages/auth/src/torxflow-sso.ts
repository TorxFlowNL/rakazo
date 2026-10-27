import { createHmac, timingSafeEqual } from "node:crypto";
import { displayName, isMessagingEmail } from "@rakazo/core";
import type { PrismaClient, SignupPolicyEnv, TorxflowRole, TorxflowTenant } from "@rakazo/db";
import { joinTorxflowSpace, recordSecurityEvent, TORXFLOW_TENANT_ID } from "@rakazo/db";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

export const TORXFLOW_SSO_PATH = "/torxflow/sso";
export const TORXFLOW_SSO_PROVIDER = "torxflow";
export const TORXFLOW_SSO_ISSUER = "torxflow";
export const TORXFLOW_SSO_AUDIENCE = "rakazo";
/** A token minted for one navigation. Anything valid for longer is refused. */
export const TORXFLOW_SSO_MAX_LIFETIME_SECONDS = 120;
export const TORXFLOW_SSO_MIN_SECRET_LENGTH = 32;
/** Allowed clock difference for `iat` between the two servers. */
const IAT_SKEW_SECONDS = 60;
const MAX_SPACE_NAME_LENGTH = 60;

const jtiKey = (jti: string) => `torxflow-sso-jti-${jti}`;

export interface TorxflowClaims {
  jti: string;
  exp: number;
  sub: string;
  email: string;
  name: string;
  tenant: TorxflowTenant;
  role: TorxflowRole;
}

// Built on use: the tenant id pattern comes from the db package.
const claimsSchema = () =>
  z.object({
    iss: z.literal(TORXFLOW_SSO_ISSUER),
    aud: z.literal(TORXFLOW_SSO_AUDIENCE),
    exp: z.number().int().positive(),
    iat: z.number().int().positive(),
    jti: z.string().min(8).max(128),
    sub: z.string().min(1).max(128),
    email: z.string().trim().min(3).max(254).includes("@"),
    name: z.string().max(200),
    tenantId: z.string().regex(TORXFLOW_TENANT_ID),
    tenantSlug: z.string().min(1).max(64),
    tenantName: z.string().trim().min(1).max(200),
    role: z.enum(["owner", "admin", "member"]),
  });

/** Why a token was refused; never shown to the browser beyond the generic message. */
export class TorxflowTokenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "TorxflowTokenError";
  }
}

function decodeSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new TorxflowTokenError("malformed token");
  }
}

/**
 * Checks an HS256 token from TorxFlow: signature first (constant time), then the claims. Only the
 * signature algorithm TorxFlow uses is accepted, so `alg: none` and key-confusion tokens fail.
 * `now` is in milliseconds.
 */
export function verifyTorxflowToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): TorxflowClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new TorxflowTokenError("malformed token");
  const [header, payload, signature] = parts as [string, string, string];
  const decodedHeader = decodeSegment(header);
  if (
    !decodedHeader ||
    typeof decodedHeader !== "object" ||
    !("alg" in decodedHeader) ||
    decodedHeader.alg !== "HS256"
  ) {
    throw new TorxflowTokenError("unsupported algorithm");
  }
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new TorxflowTokenError("bad signature");
  }
  const parsed = claimsSchema().safeParse(decodeSegment(payload));
  if (!parsed.success) {
    throw new TorxflowTokenError(`invalid claims: ${parsed.error.issues[0]?.path.join(".")}`);
  }
  const claims = parsed.data;
  const seconds = Math.floor(now / 1000);
  if (claims.exp <= seconds) throw new TorxflowTokenError("expired");
  if (claims.exp > seconds + TORXFLOW_SSO_MAX_LIFETIME_SECONDS)
    throw new TorxflowTokenError("lifetime too long");
  if (claims.iat > seconds + IAT_SKEW_SECONDS) throw new TorxflowTokenError("issued in the future");
  return {
    jti: claims.jti,
    exp: claims.exp,
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    name: claims.name,
    tenant: {
      id: claims.tenantId,
      slug: claims.tenantSlug,
      name: claims.tenantName.slice(0, MAX_SPACE_NAME_LENGTH).trim(),
    },
    role: claims.role,
  };
}

/**
 * Only an absolute path on this site is a valid landing spot. Scheme-relative URLs, backslashes,
 * control characters and other origins fall back to `/`, so the endpoint is no open redirect.
 */
export function safeRedirectPath(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const base = "http://torxflow.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

/** UI languages of the TorxFlow dashboard, as Rakazo's locale ids. */
export type TorxflowSsoLocale = "nl" | "en" | "zh-CN";

/**
 * The workspace language for the dashboard's `lang` value: `zh` is Simplified Chinese, `nl` and
 * `en` map to themselves, and anything else is Dutch, the language of the garages.
 */
export function torxflowSsoLocale(value: string): TorxflowSsoLocale {
  const language = value.trim().toLowerCase().replace(/_/g, "-").split("-")[0];
  if (language === "en") return "en";
  if (language === "zh") return "zh-CN";
  return "nl";
}

/**
 * The landing path with the language the client adopts (`lang`, removed again once read). No
 * language leaves the path as the dashboard asked.
 */
export function ssoLandingPath(redirect: string | undefined, lang: string | undefined): string {
  const path = safeRedirectPath(redirect);
  if (lang === undefined) return path;
  const url = new URL(path, "http://torxflow.invalid");
  url.searchParams.set("lang", torxflowSsoLocale(lang));
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface TorxflowProvisionInput {
  userId: string;
  email: string;
  spaceId: string;
  tenant: TorxflowTenant;
  role: TorxflowRole;
}

export interface TorxflowSsoOptions {
  /** HS256 secret shared with TorxFlow. */
  secret: string;
  signupPolicy: SignupPolicyEnv;
  /**
   * Gives the member's garage space its bot and tools. Runs after the membership exists and
   * before the session is issued. A failure is logged and the sign-in still succeeds; the next
   * sign-in repeats it, so it has to be idempotent.
   */
  provision?: (input: TorxflowProvisionInput) => Promise<void>;
}

const unauthorized = (code: string) =>
  new APIError("UNAUTHORIZED", {
    code,
    message: "TorxFlow sign-in failed. Open the assistants page in TorxFlow again.",
  });

/**
 * `GET /torxflow/sso?token=<jwt>&redirect=<path>&lang=<nl|en|zh>`: signs a TorxFlow user in from a short-lived
 * token TorxFlow signs with a shared secret. TorxFlow is the identity provider on this
 * deployment, so its verified email links to an existing account and an unknown one is created
 * without the signup policy, which governs self-service signups only.
 */
export function torxflowSso(prisma: PrismaClient, options: TorxflowSsoOptions) {
  return {
    id: "torxflow-sso",
    endpoints: {
      torxflowSso: createAuthEndpoint(
        TORXFLOW_SSO_PATH,
        {
          method: "GET",
          query: z.object({
            token: z.string().max(4096),
            redirect: z.string().max(2048).optional(),
            lang: z.string().max(32).optional(),
          }),
        },
        async (ctx) => {
          let claims: TorxflowClaims;
          try {
            claims = verifyTorxflowToken(ctx.query.token, options.secret);
          } catch (error) {
            ctx.context.logger.warn("torxflow sso refused", {
              reason: error instanceof Error ? error.message : "unknown",
            });
            throw unauthorized("INVALID_TORXFLOW_TOKEN");
          }
          if (isMessagingEmail(claims.email)) throw unauthorized("EMAIL_NOT_AVAILABLE");
          const adapter = ctx.context.internalAdapter;
          // First writer wins, so a replayed or raced token signs in at most once.
          const fresh = await adapter.reserveVerificationValue({
            identifier: jtiKey(claims.jti),
            value: claims.sub,
            expiresAt: new Date(claims.exp * 1000),
          });
          if (!fresh) throw unauthorized("TORXFLOW_TOKEN_REPLAYED");

          const key = { providerId: TORXFLOW_SSO_PROVIDER, accountId: claims.sub };
          const owner = await adapter.findAccountOwnerByKey(key);
          if (owner?.kind === "orphaned") throw unauthorized("TORXFLOW_ACCOUNT_UNAVAILABLE");
          let user = owner?.user ?? null;
          if (user && user.email.toLowerCase() !== claims.email) {
            // TorxFlow changed this person's address; follow it unless another account owns it.
            if (await adapter.findUserByEmail(claims.email)) {
              throw unauthorized("TORXFLOW_EMAIL_CONFLICT");
            }
            user = await adapter.updateUser(user.id, { email: claims.email, emailVerified: true });
          }
          if (!user) {
            const existing = await adapter.findUserByEmail(claims.email);
            if (existing) {
              const accounts = await adapter.findAccounts(existing.user.id);
              // One TorxFlow identity per email: never hand this account to a different one.
              if (
                accounts.some(
                  (account) =>
                    account.providerId === TORXFLOW_SSO_PROVIDER &&
                    account.accountId !== claims.sub,
                )
              ) {
                throw unauthorized("TORXFLOW_ACCOUNT_CONFLICT");
              }
              user = existing.user;
              if (!user.emailVerified) {
                user = await adapter.updateUser(user.id, { emailVerified: true });
              }
            } else {
              // Two tabs opening at once can both create; the loser joins the winner's user.
              user = await adapter
                .createUser(
                  {
                    email: claims.email,
                    name: displayName(claims.name, claims.email.split("@")[0] ?? claims.email),
                    emailVerified: true,
                  },
                  { method: "torxflow" },
                )
                .catch(async (error: unknown) => {
                  const winner = await adapter.findUserByEmail(claims.email);
                  if (!winner) throw error;
                  return winner.user;
                });
            }
            if (!(await adapter.findAccountByKey(key))) {
              await adapter.linkAccount({ userId: user.id, ...key });
            }
          }

          // The membership must exist before the session: without one the session hook would
          // open a personal space instead.
          const { spaceId } = await joinTorxflowSpace(
            prisma,
            user,
            claims.tenant,
            claims.role,
            options.signupPolicy,
          );
          if (options.provision) {
            await options
              .provision({
                userId: user.id,
                email: user.email,
                spaceId,
                tenant: claims.tenant,
                role: claims.role,
              })
              .catch((error: unknown) => {
                ctx.context.logger.error("torxflow sso provisioning failed", error);
              });
          }

          const session = await adapter.createSession(user.id);
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "No session" });
          await setSessionCookie(ctx, { session, user });
          await recordSecurityEvent({
            type: "auth.identity.confirmed",
            userId: user.id,
            metadata: { method: "torxflow" },
          });
          throw ctx.redirect(ssoLandingPath(ctx.query.redirect, ctx.query.lang));
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
