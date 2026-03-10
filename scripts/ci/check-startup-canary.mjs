import { readFileSync } from 'node:fs';
import path from 'node:path';

const MAIN_PATH = path.resolve(process.cwd(), 'src/main.tsx');

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

const mainSource = readFileSync(MAIN_PATH, 'utf8');

if (mainSource.includes("import BootDiagnostics from './dev/BootDiagnostics'")) {
  fail('Startup canary failed: BootDiagnostics must be imported as a named export.');
}

if (mainSource.includes("import DevErrorBoundary from './dev/ErrorBoundary'")) {
  fail('Startup canary failed: DevErrorBoundary must be imported as a named export.');
}

if (!mainSource.includes("import { BootDiagnostics } from './dev/BootDiagnostics'")) {
  fail('Startup canary failed: expected named BootDiagnostics import in src/main.tsx.');
}

if (!mainSource.includes("import { DevErrorBoundary } from './dev/ErrorBoundary'")) {
  fail('Startup canary failed: expected named DevErrorBoundary import in src/main.tsx.');
}

console.log('✅ Startup canary passed.');
