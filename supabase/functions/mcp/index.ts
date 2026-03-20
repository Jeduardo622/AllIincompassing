import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const json = (body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(init.headers || {}) },
    status: init.status ?? 200,
  });

const DEFAULT_ALLOWED_ORIGINS = [
  'https://app.allincompassing.ai',
  'https://preview.allincompassing.ai',
  'https://staging.allincompassing.ai',
  'http://localhost:3000',
  'http://localhost:5173',
] as const;

const parseAllowedOrigins = () =>
  (Deno.env.get('MCP_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

const allowedOrigins = new Set<string>([...DEFAULT_ALLOWED_ORIGINS, ...parseAllowedOrigins()]);
const fallbackAllowedOrigin = DEFAULT_ALLOWED_ORIGINS[0] ?? 'https://app.allincompassing.ai';

const baseCorsHeaders = {
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
  vary: 'origin',
};

const resolveAllowedOrigin = (req: Request): string | null => {
  const origin = req.headers.get('origin');
  if (!origin) {
    return fallbackAllowedOrigin;
  }
  return allowedOrigins.has(origin) ? origin : null;
};

const corsHeadersForRequest = (req: Request): Record<string, string> => {
  const resolvedOrigin = resolveAllowedOrigin(req);
  return {
    ...baseCorsHeaders,
    'access-control-allow-origin': resolvedOrigin ?? fallbackAllowedOrigin,
  };
};

const isDisallowedOriginRequest = (req: Request): boolean => {
  const origin = req.headers.get('origin');
  return Boolean(origin) && !allowedOrigins.has(origin);
};

const getBearerToken = (req: Request): string | null => {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token.length === auth.trim().length) return null;
  return token.length > 0 ? token : null;
};

const unauthorized = (req: Request) =>
  json({ error: 'unauthorized' }, { status: 401, headers: corsHeadersForRequest(req) });

const RPC_ALLOWLIST = new Set<string>([
  // Read-only or safe diagnostics RPCs only
  'get_client_metrics',
  'get_therapist_metrics',
  'get_authorization_metrics',
]);

function audit(event: string, details: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    details,
  };
  console.log(JSON.stringify(payload));
}

const createRequestSupabaseClient = (token: string) =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

async function handleRpc(req: Request, token: string) {
  const body = await req.json().catch(() => ({}));
  const { name, args } = body as { name?: string; args?: Record<string, unknown> };
  if (!name || typeof name !== 'string') {
    return json({ error: 'invalid function name' }, { status: 400, headers: corsHeadersForRequest(req) });
  }
  if (!RPC_ALLOWLIST.has(name)) {
    audit('mcp.rpc.blocked', { name });
    return json({ error: 'rpc_not_allowed' }, { status: 403, headers: corsHeadersForRequest(req) });
  }
  const requestSupabase = createRequestSupabaseClient(token);
  const { data, error } = await requestSupabase.rpc(name, args ?? {});
  if (error) return json({ error: error.message }, { status: 400, headers: corsHeadersForRequest(req) });
  audit('mcp.rpc.success', { name });
  return json({ data }, { headers: corsHeadersForRequest(req) });
}

// Disable generic table surface: all table access is blocked
async function handleTable(req: Request): Promise<Response> {
  audit('mcp.table.blocked', {});
  return json({ error: 'table_access_blocked' }, { status: 403, headers: corsHeadersForRequest(req) });
}

Deno.serve(async (req: Request) => {
  if (isDisallowedOriginRequest(req)) {
    return json({ error: 'origin_not_allowed' }, { status: 403, headers: corsHeadersForRequest(req) });
  }

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeadersForRequest(req) });
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, project: SUPABASE_URL }, { headers: corsHeadersForRequest(req) });
  }

  const token = getBearerToken(req);
  if (!token) return unauthorized(req);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    audit('mcp.auth.denied', { reason: error?.message ?? 'user_not_found' });
    return unauthorized(req);
  }

  if (req.method === 'POST' && url.pathname === '/rpc') return handleRpc(req, token);
  if (req.method === 'POST' && url.pathname.startsWith('/table/')) return handleTable(req);
  return json({ error: 'not_found' }, { status: 404, headers: corsHeadersForRequest(req) });
});


