import { randomBytes } from "node:crypto";
import { signupPolicyFromEnv } from "@rakazo/core";
import type { PrismaClient } from "./client.js";

export interface SignupPolicyEnv {
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
}

export function newId(): string {
  return randomBytes(16).toString("hex");
}

/** Prisma unique-constraint violation; anything else must still throw. */
export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

/** Provision a personal workspace. Signup never grants deployment administration. */
export async function bootstrapUserSpace(
  prisma: PrismaClient,
  user: { id: string },
  env: SignupPolicyEnv,
): Promise<{ spaceId: string }> {
  // Concurrent bootstraps for the same user (e.g. overlapping first phone
  // inbounds) race on every unique key below; each step either wins or
  // joins the winner's state instead of failing.
  const slug = `user-${user.id.slice(0, 12)}`;
  let orgId = newId();
  try {
    await prisma.organization.create({
      data: { id: orgId, name: "Personal", slug, createdAt: new Date() },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    orgId = (await prisma.organization.findUniqueOrThrow({ where: { slug } })).id;
  }
  await prisma.member
    .create({
      data: {
        id: newId(),
        organizationId: orgId,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  await prisma.space
    .create({
      data: {
        id: orgId,
        organizationId: orgId,
        name: "Personal",
        isDefault: true,
        createdByUserId: user.id,
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  await prisma.spaceMember
    .create({
      data: {
        id: newId(),
        spaceId: orgId,
        organizationId: orgId,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  await ensureDeploymentSettings(prisma, env);
  await seedMemberDefaults(prisma, orgId, user.id);
  return { spaceId: orgId };
}

/** Seeds the deployment's signup policy from the environment on the first signup. */
export async function ensureDeploymentSettings(
  prisma: PrismaClient,
  env: SignupPolicyEnv,
): Promise<void> {
  const policy = signupPolicyFromEnv(env);
  await prisma.deploymentSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      ownerUserId: null,
      signupsEnabled: policy.enabled,
      signupAllowlist: policy.allowlist.join(","),
      signupPolicyInitialized: true,
    },
    update: {},
  });
}

/** A member's space memory and notification preferences; a repeat call keeps what exists. */
export async function seedMemberDefaults(
  prisma: PrismaClient,
  spaceId: string,
  userId: string,
): Promise<void> {
  const hasMemory = await prisma.memoryDocument.findFirst({
    where: { spaceId, userId, scope: "user", path: "MEMORY.md" },
  });
  if (!hasMemory) {
    await prisma.memoryDocument
      .create({
        data: {
          spaceId,
          userId,
          scope: "user",
          path: "MEMORY.md",
          content: "# Space memory\n\nPreferences and context kept within this space live here.\n",
        },
      })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
  }
  await prisma.notificationPreference
    .create({ data: { spaceId, userId } })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
}
