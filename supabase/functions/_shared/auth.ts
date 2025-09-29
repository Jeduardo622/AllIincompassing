import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";

export async function getUserOrThrow(db: SupabaseClient) {
  const { data, error } = await db.auth.getUser();
  if (error || !data?.user) throw new Response("Unauthorized", { status: 401 });
  return data.user;
}

export async function assertAdminOrSuperAdmin(db: SupabaseClient) {
  const { data, error } = await db.rpc("get_user_roles");

  if (error) throw new Response("Role check failed", { status: 500 });

  const roles = Array.isArray(data)
    ? data.flatMap(entry => {
        if (!entry) return [] as string[];
        if (Array.isArray((entry as { roles?: unknown }).roles)) {
          return (entry as { roles: unknown[] }).roles.filter(
            (role): role is string => typeof role === "string",
          );
        }
        const roleValue = (entry as { roles?: unknown }).roles;
        if (typeof roleValue === "string" && roleValue.length > 0) {
          try {
            const parsed = JSON.parse(roleValue) as unknown;
            if (Array.isArray(parsed)) {
              return parsed.filter((role): role is string => typeof role === "string");
            }
          } catch (parseError) {
            // Fall through to handle comma separated values
          }
          return roleValue.split(",").map(role => role.trim()).filter(Boolean);
        }
        return [] as string[];
      })
    : [];

  const hasAdminAccess = roles.some(role => role === "admin" || role === "super_admin");

  if (!hasAdminAccess) throw new Response("Forbidden", { status: 403 });
}
