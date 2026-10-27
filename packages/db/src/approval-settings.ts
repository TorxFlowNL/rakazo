import type { SettingsScope } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { lockSpaceSettings, settingsTarget } from "./space-settings.js";

type Scope = { userId: string; spaceId: string };
/** A write runs in a transaction: it locks the member's settings before picking a copy. */
type ConfirmationsTx = ConfirmationsClient & Pick<Prisma.TransactionClient, "$queryRaw">;
type ConfirmationsClient = Pick<
  PrismaClient,
  | "spaceSettingOverride"
  | "actionApprovalRule"
  | "userActionApprovalRule"
  | "actionAutoReviewPreference"
  | "userActionAutoReviewPreference"
>;

export type ApprovalRuleInput = { effect: string; matchKind: string; matchValue: string };
export type AutoReviewPreference = { enabled: boolean; skipApprovals: boolean };

/**
 * Approval rules and auto review are confirmations: the account's copy, or the Space's
 * override. Every call reads or writes the copy that applies unless it names one.
 */
function confirmationsTarget(prisma: ConfirmationsClient, scope: Scope, requested?: SettingsScope) {
  return settingsTarget(prisma, scope, "confirmations", requested);
}

export async function listApprovalRules(
  prisma: ConfirmationsClient,
  scope: Scope,
  requested?: SettingsScope,
) {
  const orderBy = { createdAt: "asc" } as const;
  return (await confirmationsTarget(prisma, scope, requested)) === "account"
    ? prisma.userActionApprovalRule.findMany({ where: { userId: scope.userId }, orderBy })
    : prisma.actionApprovalRule.findMany({
        where: { spaceId: scope.spaceId, createdByUserId: scope.userId },
        orderBy,
      });
}

/**
 * Saves a rule once and drops any other effect on the same match in the same copy, so a match
 * has one rule. Matching ignores case, so the replacement does too; the lock keeps concurrent
 * saves of different effects from both landing. Runs inside the caller's transaction.
 */
export async function saveApprovalRule(
  tx: ConfirmationsTx,
  scope: Scope,
  rule: ApprovalRuleInput,
  requested?: SettingsScope,
) {
  await lockSpaceSettings(tx, scope);
  const account = (await confirmationsTarget(tx, scope, requested)) === "account";
  const owner = account ? `account:${scope.userId}` : `${scope.spaceId}:${scope.userId}`;
  const value = rule.matchValue.toLowerCase();
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`approval-rule:${owner}:${rule.matchKind}:${value}`}, 0))::text AS "lock"
  `);
  const others = { not: rule.effect };
  // Compared here, not with Prisma's insensitive mode: that is ILIKE, where "_" is a wildcard.
  const sameMatch = (rows: Array<{ id: string; matchValue: string }>) =>
    rows.filter((row) => row.matchValue.toLowerCase() === value).map((row) => row.id);
  const select = { id: true, matchValue: true } as const;
  if (account) {
    const where = { userId: scope.userId, matchKind: rule.matchKind };
    const ids = sameMatch(
      await tx.userActionApprovalRule.findMany({ where: { ...where, effect: others }, select }),
    );
    await tx.userActionApprovalRule.deleteMany({ where: { id: { in: ids } } });
    const row = { userId: scope.userId, ...rule };
    return tx.userActionApprovalRule.upsert({
      where: { userId_effect_matchKind_matchValue: row },
      create: row,
      update: {},
    });
  }
  const where = {
    spaceId: scope.spaceId,
    createdByUserId: scope.userId,
    matchKind: rule.matchKind,
  };
  const ids = sameMatch(
    await tx.actionApprovalRule.findMany({ where: { ...where, effect: others }, select }),
  );
  await tx.actionApprovalRule.deleteMany({ where: { id: { in: ids } } });
  const row = { spaceId: scope.spaceId, createdByUserId: scope.userId, ...rule };
  return tx.actionApprovalRule.upsert({
    where: { spaceId_createdByUserId_effect_matchKind_matchValue: row },
    create: row,
    update: {},
  });
}

export async function removeApprovalRule(
  prisma: ConfirmationsTx,
  scope: Scope,
  id: string,
  requested?: SettingsScope,
) {
  await lockSpaceSettings(prisma, scope);
  if ((await confirmationsTarget(prisma, scope, requested)) === "account") {
    await prisma.userActionApprovalRule.deleteMany({ where: { id, userId: scope.userId } });
  } else {
    await prisma.actionApprovalRule.deleteMany({
      where: { id, spaceId: scope.spaceId, createdByUserId: scope.userId },
    });
  }
}

/**
 * Makes the rules a deployment owns for `source` exactly one `effect` rule per match value, in the
 * copy that applies to the member. Only rows carrying `source` are ever removed. A match the
 * member already has a rule for, whatever its effect, is theirs and is left as it is, so a
 * rule they added or changed is never overridden or deleted. Matching ignores case, like
 * rule resolution. Runs inside the caller's transaction and is safe to repeat.
 */
export async function syncManagedApprovalRules(
  tx: ConfirmationsTx,
  scope: Scope,
  managed: { source: string; effect: string; matchKind: string; matchValues: string[] },
  requested?: SettingsScope,
): Promise<{ added: number; removed: number }> {
  await lockSpaceSettings(tx, scope);
  const account = (await confirmationsTarget(tx, scope, requested)) === "account";
  const { source, effect, matchKind } = managed;
  const wanted = new Map(managed.matchValues.map((value) => [value.toLowerCase(), value]));
  const existing: Array<{ id: string; matchValue: string; effect: string; source: string | null }> =
    account
      ? await tx.userActionApprovalRule.findMany({ where: { userId: scope.userId, matchKind } })
      : await tx.actionApprovalRule.findMany({
          where: { spaceId: scope.spaceId, createdByUserId: scope.userId, matchKind },
        });
  const kept = new Set<string>();
  const stale: string[] = [];
  for (const row of existing) {
    const value = row.matchValue.toLowerCase();
    if (row.source !== source) {
      kept.add(value);
    } else if (row.effect === effect && wanted.has(value) && !kept.has(value)) {
      kept.add(value);
    } else {
      stale.push(row.id);
    }
  }
  const missing = [...wanted].filter(([value]) => !kept.has(value)).map(([, value]) => value);
  if (stale.length) {
    if (account) await tx.userActionApprovalRule.deleteMany({ where: { id: { in: stale } } });
    else await tx.actionApprovalRule.deleteMany({ where: { id: { in: stale } } });
  }
  if (missing.length) {
    const rows = missing.map((matchValue) => ({ effect, matchKind, matchValue, source }));
    if (account) {
      await tx.userActionApprovalRule.createMany({
        data: rows.map((row) => ({ userId: scope.userId, ...row })),
        skipDuplicates: true,
      });
    } else {
      await tx.actionApprovalRule.createMany({
        data: rows.map((row) => ({
          spaceId: scope.spaceId,
          createdByUserId: scope.userId,
          ...row,
        })),
        skipDuplicates: true,
      });
    }
  }
  return { added: missing.length, removed: stale.length };
}

/** The saved auto review choice, or null when the member never chose. */
export async function findAutoReviewPreference(
  prisma: ConfirmationsClient,
  scope: Scope,
  requested?: SettingsScope,
): Promise<AutoReviewPreference | null> {
  const select = { enabled: true, skipApprovals: true } as const;
  return (await confirmationsTarget(prisma, scope, requested)) === "account"
    ? prisma.userActionAutoReviewPreference.findUnique({
        where: { userId: scope.userId },
        select,
      })
    : prisma.actionAutoReviewPreference.findUnique({
        where: { spaceId_userId: { spaceId: scope.spaceId, userId: scope.userId } },
        select,
      });
}

/** Updates the given fields; a first save fills the rest from `defaults`. */
export async function saveAutoReviewPreference(
  prisma: ConfirmationsTx,
  scope: Scope,
  update: Partial<AutoReviewPreference>,
  defaults: AutoReviewPreference,
  requested?: SettingsScope,
) {
  const create = {
    enabled: update.enabled ?? defaults.enabled,
    skipApprovals: update.skipApprovals ?? defaults.skipApprovals,
  };
  await lockSpaceSettings(prisma, scope);
  if ((await confirmationsTarget(prisma, scope, requested)) === "account") {
    await prisma.userActionAutoReviewPreference.upsert({
      where: { userId: scope.userId },
      create: { userId: scope.userId, ...create },
      update,
    });
  } else {
    await prisma.actionAutoReviewPreference.upsert({
      where: { spaceId_userId: { spaceId: scope.spaceId, userId: scope.userId } },
      create: { spaceId: scope.spaceId, userId: scope.userId, ...create },
      update,
    });
  }
}
