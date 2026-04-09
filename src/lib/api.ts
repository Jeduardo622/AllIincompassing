import { supabase } from "./supabase";
import { buildSupabaseEdgeUrl } from "./runtimeConfig";
import { callApiRoute, callEdgeRoute, type AuthenticatedRequestOptions } from "./sdk/client";

const decodeBase64Url = (value: string): string | null => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    if (typeof atob === "function") {
      return atob(padded);
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(padded, "base64").toString("utf8");
    }
    return null;
  } catch {
    return null;
  }
};

const getTokenExpirySeconds = (token: string): number | null => {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  const decoded = decodeBase64Url(parts[1]);
  if (!decoded) {
    return null;
  }
  try {
    const payload = JSON.parse(decoded) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
};

const shouldRefreshAccessToken = (token: string): boolean => {
  const expiry = getTokenExpirySeconds(token);
  if (!expiry) {
    return false;
  }
  return expiry * 1000 <= Date.now() + 60_000;
};

const getCurrentAccessToken = async (): Promise<string | null> => {
  try {
    const { data } = await supabase.auth.getSession();
    const currentToken = data?.session?.access_token ?? null;
    if (currentToken) {
      if (shouldRefreshAccessToken(currentToken)) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        return refreshed?.session?.access_token ?? currentToken;
      }
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

type CallApiSdkOptions = Pick<
  AuthenticatedRequestOptions,
  "duplicateAuthorizationHeader" | "forceJsonContentType"
>;

export async function callApi(
  path: string,
  init: RequestInit = {},
  sdkOptions?: CallApiSdkOptions,
): Promise<Response> {
  return callApiRoute(path, init, {
    getAccessToken: getCurrentAccessToken,
    ...sdkOptions,
  });
}

export async function callEdgeFunctionHttp(functionName: string, init: RequestInit = {}): Promise<Response> {
  return callEdgeRoute(functionName, buildSupabaseEdgeUrl, init, {
    getAccessToken: getCurrentAccessToken,
  });
}
