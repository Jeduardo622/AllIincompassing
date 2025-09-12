#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const FUNCTIONS_DIR = path.join(ROOT, 'supabase', 'functions');
const ALLOW_SUBSTRINGS = ['/admin', '/_shared/'];
const PATTERN = /SUPABASE_SERVICE_ROLE_KEY/;

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...listFiles(full));
    else if (e.isFile() && full.endsWith('.ts')) files.push(full);
  }
  return files;
}

function isAllowed(filePath) {
  const p = filePath.replace(/\\/g, '/');
  return ALLOW_SUBSTRINGS.some((s) => p.includes(`/supabase/functions${s}`));
}

const files = listFiles(FUNCTIONS_DIR);
const offenders = [];
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  if (PATTERN.test(content) && !isAllowed(f)) {
    offenders.push(f.replace(ROOT + path.sep, ''));
  }
}

if (offenders.length > 0) {
  console.error('\nService-role key usage found outside admin/_shared:');
  for (const f of offenders) console.error(' - ' + f);
  console.error('\nFailing audit.');
  process.exit(1);
}

console.log('Service-role audit passed.');
