import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";

type RoleName = "therapist" | "admin" | "super_admin";

interface AuthorizationFailure {
  status: number;
  body: Record<string, unknown>;
}

interface AuthorizationResult {
  ok: true;
  failure?: undefined;
}

interface AuthorizationErrorResult {
  ok: false;
  failure: AuthorizationFailure;
}

export type TherapistAuthorizationResult = AuthorizationResult | AuthorizationErrorResult;

export async function evaluateTherapistAuthorization(
  client: SupabaseClient,
  therapistId: string,
): Promise<TherapistAuthorizationResult> {
  const roles: RoleName[] = ["therapist", "admin", "super_admin"];

  for (const role of roles) {
    const { data, error } = await client.rpc("user_has_role_for_org", {
      role_name: role,
      target_therapist_id: therapistId,
    });

    if (error) {
      console.error("user_has_role_for_org error", error);
      return {
        ok: false,
        failure: {
          status: 500,
          body: { success: false, error: "Role validation failed" },
        },
      };
    }

    if (data === true) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    failure: {
      status: 403,
      body: { success: false, error: "Forbidden" },
    },
  };
}
