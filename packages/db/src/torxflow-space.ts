import {
  ensureDeploymentSettings,
  isUniqueViolation,
  newId,
  type SignupPolicyEnv,
  seedMemberDefaults,
} from "./bootstrap-user.js";
import type { PrismaClient } from "./client.js";

/** A TorxFlow garage as the trusted identity provider names it. */
export interface TorxflowTenant {
  id: string;
  slug: string;
  name: string;
}

export type TorxflowRole = "owner" | "admin" | "member";

/** Tenant ids become part of an organization slug, so they stay plain identifiers. */
export const TORXFLOW_TENANT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The organization slug that maps one garage to its space. */
export function torxflowOrganizationSlug(tenantId: string): string {
  return `torxflow-${tenantId}`;
}

/**
 * Joins a TorxFlow user to their garage's space, creating organization and space on the garage's
 * first visit. Repeat and concurrent calls converge on the same rows: every step either wins or
 * joins the winner's state. Existing roles are never changed here, so a role changed inside
 * Rakazo stays. The first member to arrive owns the space; later ones join with their TorxFlow
 * role (owner and admin become admin, member stays member).
 */
export async function joinTorxflowSpace(
  prisma: PrismaClient,
  user: { id: string },
  tenant: TorxflowTenant,
  role: TorxflowRole,
  env: SignupPolicyEnv,
): Promise<{ spaceId: string; created: boolean }> {
  if (!TORXFLOW_TENANT_ID.test(tenant.id)) throw new Error("Invalid TorxFlow tenant id");
  const slug = torxflowOrganizationSlug(tenant.id);
  let orgId = newId();
  try {
    await prisma.organization.create({
      data: {
        id: orgId,
        name: tenant.name,
        slug,
        createdAt: new Date(),
        metadata: JSON.stringify({
          source: "torxflow",
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
        }),
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    orgId = (await prisma.organization.findUniqueOrThrow({ where: { slug } })).id;
  }
  let created = true;
  await prisma.space
    .create({
      data: {
        id: orgId,
        organizationId: orgId,
        name: tenant.name,
        // The garage is where TorxFlow users work, so it opens first and cannot be deleted.
        isDefault: true,
        createdByUserId: user.id,
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
      created = false;
    });
  const memberRole = created ? "owner" : role === "member" ? "member" : "admin";
  await prisma.member
    .create({
      data: {
        id: newId(),
        organizationId: orgId,
        userId: user.id,
        role: memberRole,
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
        role: memberRole,
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  await ensureDeploymentSettings(prisma, env);
  await seedMemberDefaults(prisma, orgId, user.id);
  return { spaceId: orgId, created };
}
