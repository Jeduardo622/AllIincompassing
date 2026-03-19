import { supabase } from "./supabase";
import { buildSupabaseEdgeUrl } from "./runtimeConfig";
import { callApiRoute, callEdgeRoute } from "./sdk/client";

const getCurrentAccessToken = async (): Promise<string | null> => {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
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
