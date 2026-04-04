import { supabase } from "./supabase";
import { buildSupabaseEdgeUrl } from "./runtimeConfig";
import { callApiRoute, callEdgeRoute } from "./sdk/client";

const getCurrentAccessToken = async (): Promise<string | null> => {
  try {
    const { data } = await supabase.auth.getSession();
    const currentToken = data?.session?.access_token ?? null;
    if (currentToken) {
      return currentToken;
    }

    // In long-lived preview tabs, auth state can lag behind storage restoration.
    // Triggering getUser hydrates auth state without changing caller behavior.
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return null;
    }

    const { data: reloaded } = await supabase.auth.getSession();
    const reloadedToken = reloaded?.session?.access_token ?? null;
    if (reloadedToken) {
      return reloadedToken;
    }

    const { data: refreshed } = await supabase.auth.refreshSession();
    return refreshed?.session?.access_token ?? null;
  } catch {
    return null;
  }
};

export async function callApi(path: string, init: RequestInit = {}): Promise<Response> {
  return callApiRoute(path, init, {
    getAccessToken: getCurrentAccessToken,
  });
}

export async function callEdgeFunctionHttp(functionName: string, init: RequestInit = {}): Promise<Response> {
  return callEdgeRoute(functionName, buildSupabaseEdgeUrl, init, {
    getAccessToken: getCurrentAccessToken,
  });
}
