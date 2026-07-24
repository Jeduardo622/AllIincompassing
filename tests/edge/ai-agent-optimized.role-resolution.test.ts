import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { resolveAgentRole } from "../../supabase/functions/ai-agent-optimized/roleResolution";

const functionSource = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "functions",
    "ai-agent-optimized",
    "index.ts",
  ),
  "utf8",
);

describe("AI agent role resolution", () => {
  it("preserves BCBA identity above an additional admin assignment", async () => {
    const checkedRoles: string[] = [];
    const role = await resolveAgentRole(async (candidate) => {
      checkedRoles.push(candidate);
      return candidate === "bcba" || candidate === "admin";
    });

    expect(role).toBe("bcba");
    expect(checkedRoles).toEqual(["super_admin", "bcba"]);
  });

  it("resolves an organization-scoped admin when higher roles are absent", async () => {
    const role = await resolveAgentRole(async (candidate) => candidate === "admin");
    expect(role).toBe("admin");
  });

  it("fails closed when no authoritative organization role matches", async () => {
    const role = await resolveAgentRole(async () => false);
    expect(role).toBe("client");
  });

  it("fails closed and reports an authoritative role lookup error", async () => {
    const lookupError = new Error("role lookup failed");
    const onError = vi.fn();
    const role = await resolveAgentRole(async () => {
      throw lookupError;
    }, onError);

    expect(role).toBe("client");
    expect(onError).toHaveBeenCalledWith(lookupError);
  });

  it("wires authoritative role checks to the resolved organization", () => {
    expect(functionSource).toContain("resolveActorRole(db, orgId)");
    expect(functionSource).toContain('db.rpc("user_has_role_for_org"');
    expect(functionSource).toContain("target_organization_id: orgId");
    expect(functionSource).toContain("if (!orgId) return false");
    expect(functionSource).toContain('["org_super_admin", "admin"]');
    expect(functionSource).not.toContain('db.rpc("get_user_roles"');
  });
});
