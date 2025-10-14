import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";

export class MissingOrgContextError extends Error {
  status = 403;
  constructor(message = "Organization context required") {
    super(message);
    this.name = "MissingOrgContextError";
  }
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function resolveOrgId(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db.rpc("current_user_organization_id");
  if (error) {
    console.error("resolveOrgId error", error);
    return null;
  }
  return typeof data === "string" && data.length > 0 ? data : null;
}

export async function requireOrg(db: SupabaseClient): Promise<string> {
  const orgId = await resolveOrgId(db);
  if (!orgId) {
    throw new MissingOrgContextError();
  }
  return orgId;
}

type OrgRoleTargets = {
  targetTherapistId?: string;
  targetClientId?: string;
  targetSessionId?: string;
};

export async function assertUserHasOrgRole(
  db: SupabaseClient,
  orgId: string,
  role: string,
  targets: OrgRoleTargets = {},
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    role_name: role,
    target_organization_id: orgId,
  };

  if (targets.targetTherapistId) {
    payload.target_therapist_id = targets.targetTherapistId;
  }
  if (targets.targetClientId) {
    payload.target_client_id = targets.targetClientId;
  }
  if (targets.targetSessionId) {
    payload.target_session_id = targets.targetSessionId;
  }

  const { data, error } = await db.rpc("user_has_role_for_org", payload);
  if (error) {
    console.error("assertUserHasOrgRole rpc error", error);
    return false;
  }
  return data === true;
}

export async function withOrg<T>(
  db: SupabaseClient,
  handler: (orgId: string) => Promise<T>,
): Promise<T> {
  const orgId = await requireOrg(db);
  return handler(orgId);
}

export function orgScopedQuery(
  db: SupabaseClient,
  table: string,
  orgId: string,
) {
  return db.from(table).eq("organization_id", orgId);
}
