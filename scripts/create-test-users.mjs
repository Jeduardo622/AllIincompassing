// Creates role-based test users using Supabase Auth Admin API.
// Requirements:
// - Node >= 18 (global fetch)
// - .env.local present with VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// - Does NOT print secrets. Outputs created user emails and ids.

import fs from 'node:fs';
import path from 'node:path';

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function getConfig() {
  const env = { ...process.env, ...loadEnvLocal() };
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Missing SUPABASE URL (VITE_SUPABASE_URL or SUPABASE_URL)');
  if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  return { url, serviceRoleKey };
}

async function createUser({ url, serviceRoleKey }, email, password, role) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceRoleKey}`,
      'apikey': serviceRoleKey,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: { role },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed (${res.status}) ${email} role=${role}: ${body}`);
  }
  const json = await res.json();
  return { id: json?.id, email, role };
}

function generatePassword(ts) {
  return `Str0ng!Pass#${ts}`;
}

async function main() {
  const cfg = getConfig();
  const ts = process.env.E2E_TS || Date.now().toString();
  const users = [
    { role: 'client', email: `client.e2e.${ts}@example.com` },
    { role: 'therapist', email: `therapist.e2e.${ts}@example.com` },
    { role: 'admin', email: `admin.e2e.${ts}@example.com` },
    { role: 'superadmin', email: `superadmin.e2e.${ts}@example.com` },
  ];
  const password = generatePassword(ts);

  const created = [];
  for (const u of users) {
    try {
      const res = await createUser(cfg, u.email, password, u.role);
      created.push(res);
      console.log(JSON.stringify({ created: { role: u.role, email: u.email, id: res.id } }));
    } catch (e) {
      // Proceed even if one fails, but log minimal error message (no secrets)
      console.error(JSON.stringify({ error: `createUser failed`, role: u.role, email: u.email, message: String(e.message).slice(0, 300) }));
    }
  }

  // Persist a small artifact with the emails for later login steps
  const outDir = path.resolve(process.cwd(), 'audits');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'e2e-users.json'), JSON.stringify({ ts, users: created, passwordHint: `Str0ng!Pass#<ts>` }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ fatal: 'create-test-users', message: e.message }));
  process.exit(1);
});


