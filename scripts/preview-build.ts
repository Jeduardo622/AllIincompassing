import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';

import { describePreviewConfig, resolvePreviewConfig } from '../src/preview/config';

const loadPreviewEnv = (): void => {
  const envPath = path.resolve('.env.preview');
  if (!fs.existsSync(envPath)) {
    console.log('[preview] .env.preview not found; using process environment variables only.');
    return;
  }

  loadEnv({ path: envPath, override: false });
  console.log(`[preview] Loaded environment variables from ${envPath}.`);
};

const runCommand = async (command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', (error) => {
      reject(error);
    });
  });
};

const ensureCleanOutput = (outDir: string): void => {
  if (!fs.existsSync(outDir)) {
    return;
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`[preview] Cleared existing preview output at ${path.resolve(outDir)}.`);
};

const main = async (): Promise<void> => {
  loadPreviewEnv();
  const previewConfig = resolvePreviewConfig(process.env);
  console.log(`[preview] Using configuration -> ${describePreviewConfig(previewConfig)}`);

  ensureCleanOutput(previewConfig.outDir);

  const commandEnv = { ...process.env, NODE_ENV: 'preview' };

  await runCommand('npx', ['tsc', '-p', 'tsconfig.json'], commandEnv);
  await runCommand('npx', ['vite', 'build', '--mode', 'preview', '--outDir', previewConfig.outDir], commandEnv);

  console.log(`[preview] Build completed. Assets available at ${path.resolve(previewConfig.outDir)}.`);
  console.log(`[preview] Baseline preview URL: ${previewConfig.url}`);
};

main().catch((error) => {
  console.error('[preview] Build failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
