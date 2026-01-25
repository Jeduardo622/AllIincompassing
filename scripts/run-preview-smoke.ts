import { spawn } from 'node:child_process';
import process from 'node:process';

import { describePreviewConfig, resolvePreviewConfig } from '../src/preview/config';
import {
  ensureBuildArtifactsExist,
  ensureSupabaseEnv,
  startPreviewServer,
  type PreviewServerHandle,
} from './lib/preview-runtime';

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
    child.on('error', (error) => reject(error));
  });
};

const logServerReady = (configDescription: string): void => {
  console.log(`[preview] Preview server ready on ${configDescription}.`);
};

const main = async (): Promise<void> => {
  const smokeArgs = process.argv.slice(2);
  const previewConfig = resolvePreviewConfig(process.env);
  console.log(`[preview] Smoke configuration -> ${describePreviewConfig(previewConfig)}`);

  ensureBuildArtifactsExist(previewConfig);
  ensureSupabaseEnv(previewConfig);

  const server: PreviewServerHandle = await startPreviewServer(previewConfig);
  logServerReady(`http://${previewConfig.host}:${previewConfig.port} serving ${previewConfig.outDir}`);

  const smokeEnv = { ...process.env, PREVIEW_URL: previewConfig.url };

  try {
    await runCommand('npx', ['tsx', 'scripts/smoke-preview.ts', ...smokeArgs], smokeEnv);
    console.log('[preview] Smoke suite completed successfully.');
  } finally {
    await server.close();
  }
};

main().catch((error) => {
  console.error('[preview] Smoke run failed:', error instanceof Error ? error.message : error);
  console.error('❌ Preview build or smoke test failed — downstream tasks halted.');
  process.exitCode = 1;
});
