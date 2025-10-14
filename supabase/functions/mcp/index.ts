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

async function handleRpc(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { name, args } = body as { name?: string; args?: Record<string, unknown> };
  if (!name || typeof name !== 'string') return json({ error: 'invalid function name' }, { status: 400, headers: corsHeaders });
  const { data, error } = await supabase.rpc(name, args ?? {});
  if (error) return json({ error: error.message }, { status: 400, headers: corsHeaders });
  return json({ data }, { headers: corsHeaders });
}

async function handleTable(req: Request, path: string) {
  const [, , action] = path.split('/'); // /table/<action>
  const body = await req.json().catch(() => ({}));
  const table = sanitizeTable((body as { table?: string }).table);
  if (!table) return json({ error: 'invalid table' }, { status: 400, headers: corsHeaders });
  const selector = typeof (body as { select?: string }).select === 'string' && (body as { select?: string }).select!.length > 0 ? (body as { select?: string }).select! : '*';

  const applyMatch = (q: any) => {
    const m = (body as { match?: Record<string, unknown> }).match ?? {};
    for (const [k, v] of Object.entries(m)) q = q.eq(k, v as any);
    return q;
  };

  if (action === 'insert') {
    const rows = (body as { rows?: unknown; values?: unknown }).rows ?? (body as { values?: unknown }).values;
    if (!rows) return json({ error: 'missing rows' }, { status: 400, headers: corsHeaders });
    const { data, error } = await supabase.from(table).insert(rows as any).select(selector);
    if (error) return json({ error: error.message }, { status: 400, headers: corsHeaders });
    return json({ data }, { headers: corsHeaders });
  }

  if (action === 'upsert') {
    const rows = (body as { rows?: unknown; values?: unknown }).rows ?? (body as { values?: unknown }).values;
    if (!rows) return json({ error: 'missing rows' }, { status: 400, headers: corsHeaders });
    const { data, error } = await supabase.from(table).upsert(rows as any, { onConflict: (body as { onConflict?: string }).onConflict }).select(selector);
    if (error) return json({ error: error.message }, { status: 400, headers: corsHeaders });
    return json({ data }, { headers: corsHeaders });
  }

  if (action === 'update') {
    const values = (body as { values?: unknown }).values;
    if (!values) return json({ error: 'missing values' }, { status: 400, headers: corsHeaders });
    let q: any = supabase.from(table).update(values as any).select(selector);
    q = applyMatch(q);
    const { data, error } = await q;
    if (error) return json({ error: error.message }, { status: 400, headers: corsHeaders });
    return json({ data }, { headers: corsHeaders });
  }

  if (action === 'delete') {
    let q: any = supabase.from(table).delete().select(selector);
    q = applyMatch(q);
    const { data, error } = await q;
    if (error) return json({ error: error.message }, { status: 400, headers: corsHeaders });
    return json({ data }, { headers: corsHeaders });
  }

  if (action === 'select') {
    let q: any = supabase
      .from(table)
      .select(selector)
      .limit(Math.max(1, Math.min(1000, Number((body as { limit?: number }).limit) || 100)));
    q = applyMatch(q);
    const { data, error } = await q;
    if (error) return json({ error: error.message }, { status: 400, headers: corsHeaders });
    return json({ data }, { headers: corsHeaders });
  }

  return json({ error: 'unknown action' }, { status: 404, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, project: SUPABASE_URL }, { headers: corsHeaders });
  }
  if (!isAuthorized(req)) return unauthorized();
  if (req.method === 'POST' && url.pathname === '/rpc') return handleRpc(req);
  if (req.method === 'POST' && url.pathname.startsWith('/table/')) return handleTable(req, url.pathname);
  return json({ error: 'not_found' }, { status: 404, headers: corsHeaders });
});


