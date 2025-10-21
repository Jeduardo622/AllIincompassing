import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MCP_TOKEN = Deno.env.get('MCP_TOKEN') ?? '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const json = (body: unknown, init: ResponseInit & { headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(init.headers || {}) },
    status: init.status ?? 200,
  });

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-mcp-token',
};

const isAuthorized = (req: Request) => {
  // Only allow explicit MCP token via Authorization: Bearer <MCP_TOKEN> or X-MCP-Token header.
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const headerToken = req.headers.get('x-mcp-token') || '';
  if (MCP_TOKEN && (bearer === MCP_TOKEN || headerToken === MCP_TOKEN)) return true;
  return false;
};

const unauthorized = () => json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders });

const sanitizeTable = (t: unknown) => (typeof t === 'string' && /^[a-zA-Z0-9_.]+$/.test(t) ? t : null);

const RPC_ALLOWLIST = new Set<string>([
  // Read-only or safe diagnostics RPCs only
  'get_dashboard_data',
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

async function handleRpc(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { name, args } = body as { name?: string; args?: Record<string, unknown> };
  if (!name || typeof name !== 'string') return json({ error: 'invalid function name' }, { status: 400, headers: corsHeaders });
  if (!RPC_ALLOWLIST.has(name)) {
    audit('mcp.rpc.blocked', { name });
    return json({ error: 'rpc_not_allowed' }, { status: 403, headers: corsHeaders });
  }
  const { data, error } = await supabase.rpc(name, args ?? {});
  if (error) return json({ error: error.message }, { status: 400, headers: corsHeaders });
  audit('mcp.rpc.success', { name });
  return json({ data }, { headers: corsHeaders });
}

// Disable generic table surface: all table access is blocked
async function handleTable(): Promise<Response> {
  audit('mcp.table.blocked', {});
  return json({ error: 'table_access_blocked' }, { status: 403, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, project: SUPABASE_URL }, { headers: corsHeaders });
  }
  if (!isAuthorized(req)) return unauthorized();
  if (req.method === 'POST' && url.pathname === '/rpc') return handleRpc(req);
  if (req.method === 'POST' && url.pathname.startsWith('/table/')) return handleTable();
  return json({ error: 'not_found' }, { status: 404, headers: corsHeaders });
});


