import { supabase } from "./supabase";

export async function callApi(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  } catch {
    // Best effort: allow unauthenticated calls to surface 401s.
  }

  return fetch(path, { ...init, headers });
}
