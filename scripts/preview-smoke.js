#!/usr/bin/env node

// Preview smoke test: validates Netlify Deploy Preview is serving the app
// and that /api/runtime-config returns Supabase config.

const MASK = (value) => {
  if (typeof value !== 'string' || value.length === 0) return '<empty>';
  if (value.length <= 8) return `${value[0]}***${value[value.length - 1]}`;
  return `${value.slice(0, 6)}***${value.slice(-2)}`;
};

const getArg = (flag) => {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return undefined;
};

const withTimeout = async (promise, ms, label) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const result = await promise(controller.signal);
    clearTimeout(timer);
    return result;
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`);
  }
};

const fetchJson = async (url, signal) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.error === 'string') detail = `${res.status} ${body.error}`;
    } catch {}
    throw new Error(`HTTP ${res.status} ${detail}`);
  }
  return res.json();
};

const fetchText = async (url, signal) => {
  const res = await fetch(url, { headers: { Accept: 'text/html' }, cache: 'no-store', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
};

const main = async () => {
  const baseUrl =
    process.env.PREVIEW_URL ||
    getArg('--url') ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.URL;

  if (!baseUrl) {
    console.error('[smoke] Missing preview URL. Provide via PREVIEW_URL env or --url flag.');
    process.exit(1);
  }

  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  console.log(`[smoke] Target: ${normalized}`);

  // 1) Check index page renders
  const html = await withTimeout(
    (signal) => fetchText(normalized, signal),
    15000,
    'Fetch index.html',
  );
  const hasRoot = /<div\s+id=["']root["']/.test(html);
  console.log(`[smoke] index.html root div: ${hasRoot ? 'OK' : 'MISSING'}`);
  if (!hasRoot) throw new Error('Root element not found in index.html');

  // 2) Check runtime config endpoint
  const config = await withTimeout(
    (signal) => fetchJson(`${normalized}/api/runtime-config`, signal),
    15000,
    'Fetch /api/runtime-config',
  );

  const { supabaseUrl, supabaseAnonKey, supabaseEdgeUrl } = config;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Runtime config missing supabaseUrl and/or supabaseAnonKey');
  }

  console.log('[smoke] runtime-config:', {
    supabaseUrl,
    supabaseAnonKey: MASK(supabaseAnonKey),
    supabaseEdgeUrl: supabaseEdgeUrl || '<derived>',
  });

  console.log('[smoke] PASS');
};

// run
main().catch((error) => {
  console.error('[smoke] FAIL', error);
  process.exit(1);
});


