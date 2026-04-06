import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { supabaseAdmin } from "./database.ts";

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

/**
 * Like `requireOrg`, but when the DB has no org for the caller (common for super-admins scoped only
 * via client runtime-config / UI) and the user is a super admin, resolves org from the booking
 * therapist row. Matches schedule RPC behavior where tenant context can come from impersonation
 * without `profiles.organization_id` or JWT-backed `current_user_organization_id`.
 */
export async function requireOrgForScheduling(db: SupabaseClient, therapistId: string): Promise<string> {
  const direct = await resolveOrgId(db);
  if (direct) {
    return direct;
  }

  const { data: isSuper, error: superErr } = await db.rpc("current_user_is_super_admin");
  if (superErr) {
    console.error("requireOrgForScheduling current_user_is_super_admin", superErr);
    throw new MissingOrgContextError();
  }
  if (isSuper !== true) {
    throw new MissingOrgContextError();
  }

  const trimmed = therapistId.trim();
  if (trimmed.length === 0) {
    throw new MissingOrgContextError();
  }

  const { data: row, error } = await supabaseAdmin
    .from("therapists")
    .select("organization_id")
    .eq("id", trimmed)
    .maybeSingle();

  if (error) {
    console.error("requireOrgForScheduling therapist lookup", error);
    throw new MissingOrgContextError();
  }

  const org =
    row && typeof (row as { organization_id?: unknown }).organization_id === "string"
      ? (row as { organization_id: string }).organization_id.trim()
      : "";

  if (org.length === 0) {
    throw new MissingOrgContextError();
  }

  return org;
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
