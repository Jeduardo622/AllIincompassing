import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
export async function getUserOrThrow(db: SupabaseClient) {
  const { data, error } = await db.auth.getUser();
  if (error || !data?.user) throw new Response("Unauthorized", { status: 401 });
  return data.user;
}
export async function assertAdmin(db: SupabaseClient) {
  const { data, error } = await db.rpc("is_admin");
  if (error) throw new Response("Admin check failed", { status: 500 });
  if (!data) throw new Response("Forbidden", { status: 403 });
}
