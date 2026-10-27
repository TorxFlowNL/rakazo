import { describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { joinTorxflowSpace, torxflowOrganizationSlug } from "./torxflow-space.js";

const env = { signupsEnabled: "false", signupAllowlist: "" };
const tenant = { id: "tenant-1", slug: "garage-de-vries", name: "Garage De Vries" };

function uniqueViolation() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

/** Tables with the unique keys the real schema enforces, so a repeat insert fails like Postgres. */
function fakePrisma() {
  const organizations = new Map<string, Record<string, unknown>>();
  const spaces = new Map<string, Record<string, unknown>>();
  const members = new Map<string, Record<string, unknown>>();
  const spaceMembers = new Map<string, Record<string, unknown>>();
  const memory = new Map<string, Record<string, unknown>>();
  const notifications = new Map<string, Record<string, unknown>>();
  const insert = (
    table: Map<string, Record<string, unknown>>,
    key: string,
    data: Record<string, unknown>,
  ) => {
    if (table.has(key)) throw uniqueViolation();
    table.set(key, data);
    return data;
  };
  const prisma = {
    organization: {
      create: async ({ data }: { data: { id: string; slug: string } }) => {
        if ([...organizations.values()].some((row) => row.slug === data.slug))
          throw uniqueViolation();
        return insert(organizations, data.id, data);
      },
      findUniqueOrThrow: async ({ where }: { where: { slug: string } }) =>
        [...organizations.values()].find((row) => row.slug === where.slug) ??
        Promise.reject(new Error("not found")),
    },
    space: {
      create: async ({ data }: { data: { id: string } }) => insert(spaces, data.id, data),
    },
    member: {
      create: async ({ data }: { data: { organizationId: string; userId: string } }) =>
        insert(members, `${data.organizationId}:${data.userId}`, data),
    },
    spaceMember: {
      create: async ({ data }: { data: { spaceId: string; userId: string } }) =>
        insert(spaceMembers, `${data.spaceId}:${data.userId}`, data),
    },
    deploymentSettings: { upsert: async () => ({}) },
    memoryDocument: {
      findFirst: async ({ where }: { where: { spaceId: string; userId: string } }) =>
        memory.get(`${where.spaceId}:${where.userId}`) ?? null,
      create: async ({ data }: { data: { spaceId: string; userId: string } }) =>
        insert(memory, `${data.spaceId}:${data.userId}`, data),
    },
    notificationPreference: {
      create: async ({ data }: { data: { spaceId: string; userId: string } }) =>
        insert(notifications, `${data.spaceId}:${data.userId}`, data),
    },
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    organizations,
    spaces,
    members,
    spaceMembers,
  };
}

describe("joinTorxflowSpace", () => {
  it("creates the garage's organization and default space for its first member, who owns it", async () => {
    const db = fakePrisma();
    const result = await joinTorxflowSpace(db.prisma, { id: "user-1" }, tenant, "member", env);

    expect(result.created).toBe(true);
    expect([...db.organizations.values()]).toEqual([
      expect.objectContaining({
        id: result.spaceId,
        name: "Garage De Vries",
        slug: torxflowOrganizationSlug("tenant-1"),
        metadata: JSON.stringify({
          source: "torxflow",
          tenantId: "tenant-1",
          tenantSlug: "garage-de-vries",
        }),
      }),
    ]);
    expect([...db.spaces.values()]).toEqual([
      expect.objectContaining({
        id: result.spaceId,
        organizationId: result.spaceId,
        name: "Garage De Vries",
        isDefault: true,
        createdByUserId: "user-1",
      }),
    ]);
    expect([...db.spaceMembers.values()]).toEqual([
      expect.objectContaining({ spaceId: result.spaceId, userId: "user-1", role: "owner" }),
    ]);
    expect([...db.members.values()]).toEqual([
      expect.objectContaining({ organizationId: result.spaceId, userId: "user-1", role: "owner" }),
    ]);
  });

  it("joins later members of the same garage to the same space with their TorxFlow role", async () => {
    const db = fakePrisma();
    const first = await joinTorxflowSpace(db.prisma, { id: "user-1" }, tenant, "owner", env);
    const admin = await joinTorxflowSpace(db.prisma, { id: "user-2" }, tenant, "admin", env);
    const member = await joinTorxflowSpace(db.prisma, { id: "user-3" }, tenant, "member", env);

    expect(admin).toEqual({ spaceId: first.spaceId, created: false });
    expect(member.spaceId).toBe(first.spaceId);
    expect(db.organizations.size).toBe(1);
    expect(db.spaces.size).toBe(1);
    const roles = Object.fromEntries(
      [...db.spaceMembers.values()].map((row) => [row.userId, row.role]),
    );
    expect(roles).toEqual({ "user-1": "owner", "user-2": "admin", "user-3": "member" });
  });

  it("is idempotent for a member who signs in again, and keeps roles set since", async () => {
    const db = fakePrisma();
    const first = await joinTorxflowSpace(db.prisma, { id: "user-1" }, tenant, "owner", env);
    await joinTorxflowSpace(db.prisma, { id: "user-2" }, tenant, "member", env);
    const again = await joinTorxflowSpace(db.prisma, { id: "user-2" }, tenant, "admin", env);
    const owner = await joinTorxflowSpace(db.prisma, { id: "user-1" }, tenant, "member", env);

    expect(again.spaceId).toBe(first.spaceId);
    expect(owner.spaceId).toBe(first.spaceId);
    expect(db.spaceMembers.size).toBe(2);
    expect(db.members.size).toBe(2);
    const roles = Object.fromEntries(
      [...db.spaceMembers.values()].map((row) => [row.userId, row.role]),
    );
    expect(roles).toEqual({ "user-1": "owner", "user-2": "member" });
  });

  it("keeps different garages apart", async () => {
    const db = fakePrisma();
    const a = await joinTorxflowSpace(db.prisma, { id: "user-1" }, tenant, "owner", env);
    const b = await joinTorxflowSpace(
      db.prisma,
      { id: "user-2" },
      { id: "tenant-2", slug: "other", name: "Other Garage" },
      "owner",
      env,
    );
    expect(a.spaceId).not.toBe(b.spaceId);
    expect(db.spaces.size).toBe(2);
  });

  it("converges when two members of a new garage arrive at once", async () => {
    const db = fakePrisma();
    const [a, b] = await Promise.all([
      joinTorxflowSpace(db.prisma, { id: "user-1" }, tenant, "owner", env),
      joinTorxflowSpace(db.prisma, { id: "user-2" }, tenant, "member", env),
    ]);
    expect(a.spaceId).toBe(b.spaceId);
    expect(db.organizations.size).toBe(1);
    expect(db.spaces.size).toBe(1);
    expect(db.spaceMembers.size).toBe(2);
  });

  it("refuses a tenant id that is not a plain identifier", async () => {
    const db = fakePrisma();
    await expect(
      joinTorxflowSpace(db.prisma, { id: "user-1" }, { ...tenant, id: "a/b" }, "owner", env),
    ).rejects.toThrow("Invalid TorxFlow tenant id");
    expect(db.organizations.size).toBe(0);
  });
});
