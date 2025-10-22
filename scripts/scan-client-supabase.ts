#!/usr/bin/env -S node --experimental-import-meta-resolve
import { globby } from 'globby';
import { readFileSync } from 'node:fs';

type Issue = { file: string; line: number; message: string };

const ROOTS = [
  'src/**/*.ts',
  'src/**/*.tsx',
  'dist/**/*.js',
];

const ALLOW_PATHS = new Set<string>([
  'src/test/',
  'src/tests/',
]);

const PATTERNS: Array<{ re: RegExp; message: string }> = [
  { re: /rpc\(['"]get_dashboard_data['"]\)/g, message: 'Direct rpc("get_dashboard_data") not allowed in client code' },
  { re: /supabaseAdmin|SUPABASE_SERVICE_ROLE_KEY|service[_-]?role/gi, message: 'Service-role constructs are forbidden in client bundles' },
  { re: /\/rest\/v1\//g, message: 'Direct PostgREST calls from client code are forbidden; use supabase client or server proxy' },
];

function isAllowed(file: string): boolean {
  return Array.from(ALLOW_PATHS).some((prefix) => file.replace(/\\/g, '/').includes(prefix));
}

async function main() {
  const files = await globby(ROOTS, { gitignore: true });
  const issues: Issue[] = [];

  for (const file of files) {
    const rel = file.replace(process.cwd() + '/', '');
    if (isAllowed(rel)) continue;
    const content = readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const { re, message } of PATTERNS) {
        if (re.test(line)) {
          issues.push({ file: rel, line: index + 1, message });
        }
        re.lastIndex = 0;
      }
    });
  }

  if (issues.length > 0) {
    console.error('Client Supabase scan failed with the following issues:');
    for (const issue of issues) {
      console.error(`- ${issue.file}:${issue.line} ${issue.message}`);
    }
    process.exit(1);
  }

  console.log('Client Supabase scan passed.');
}

main().catch((error) => {
  console.error('Unexpected error in scan-client-supabase:', error);
  process.exit(1);
});


