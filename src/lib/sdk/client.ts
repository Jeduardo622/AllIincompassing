import { fetchWithRetry, type RetryOptions } from "../retry";

export type TraceContext = {
  requestId?: string;
  correlationId?: string;
  agentOperationId?: string;
};

export type AuthenticatedRequestOptions = {
  accessToken?: string;
  anonKey?: string;
  getAccessToken?: () => Promise<string | null>;
  trace?: TraceContext;
  retry?: RetryOptions;
  forceJsonContentType?: boolean;
  allowCrossOriginAuth?: boolean;
};

const isFormDataBody = (body: RequestInit["body"]): boolean => {
  return typeof FormData !== "undefined" && body instanceof FormData;
};

export const generateRequestId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const withTraceHeaders = (headers: Headers, trace?: TraceContext): Headers => {
  const requestId = trace?.requestId?.trim() || headers.get("x-request-id") || generateRequestId();
  const correlationId = trace?.correlationId?.trim() || headers.get("x-correlation-id") || requestId;
  const agentOperationId = trace?.agentOperationId?.trim() || headers.get("x-agent-operation-id");

  headers.set("x-request-id", requestId);
  headers.set("x-correlation-id", correlationId);
  if (agentOperationId) {
    headers.set("x-agent-operation-id", agentOperationId);
  }
  return headers;
};

const resolveAccessToken = async (
  explicitToken: string | undefined,
  getAccessToken?: () => Promise<string | null>,
): Promise<string | null> => {
  const trimmed = explicitToken?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (!getAccessToken) {
    return null;
  }
  try {
    return await getAccessToken();
  } catch {
    return null;
  }
};

const shouldAttachAuthorization = (
  input: RequestInfo | URL,
  allowCrossOriginAuth: boolean,
): boolean => {
  const rawInput = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  if (!/^https?:\/\//i.test(rawInput)) {
    return true;
  }
  if (allowCrossOriginAuth) {
    return true;
  }
  if (typeof window === "undefined" || !window.location?.origin) {
    return false;
  }
  try {
    const target = new URL(rawInput);
    return target.origin === window.location.origin;
  } catch {
    return false;
  }
};

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: AuthenticatedRequestOptions = {},
): Promise<Response> {
  const headers = withTraceHeaders(new Headers(init.headers), options.trace);
  const token = await resolveAccessToken(options.accessToken, options.getAccessToken);
  const canAttachAuthorization = shouldAttachAuthorization(input, options.allowCrossOriginAuth ?? false);

  if (token && canAttachAuthorization) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (typeof options.anonKey === "string" && options.anonKey.trim().length > 0) {
    headers.set("apikey", options.anonKey.trim());
  }
  if ((options.forceJsonContentType ?? true) && !headers.has("Content-Type") && !isFormDataBody(init.body)) {
    headers.set("Content-Type", "application/json");
  }

  const finalInit: RequestInit = { ...init, headers };
  if (options.retry) {
    return fetchWithRetry(input, finalInit, options.retry);
  }
  return fetch(input, finalInit);
}

export async function callApiRoute(
  path: string,
  init: RequestInit = {},
  options: AuthenticatedRequestOptions = {},
): Promise<Response> {
  return authenticatedFetch(path, init, options);
}

export async function callEdgeRoute(
  functionName: string,
  buildEdgeUrl: (name: string) => string,
  init: RequestInit = {},
  options: AuthenticatedRequestOptions = {},
): Promise<Response> {
  const url = buildEdgeUrl(functionName);
  return authenticatedFetch(url, init, { ...options, allowCrossOriginAuth: true });
}

