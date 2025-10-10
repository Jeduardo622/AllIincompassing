import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { describePreviewConfig, resolvePreviewConfig } from '../src/preview/config';
import {
  ensureBuildArtifactsExist,
  ensureSupabaseEnv,
  startPreviewServer,
  type PreviewServerHandle,
} from './lib/preview-runtime';

const resolveCypressBin = (): string => {
  const binaryName = process.platform === 'win32' ? 'cypress.cmd' : 'cypress';
  return path.resolve('node_modules', '.bin', binaryName);
};

const run = async (): Promise<void> => {
  const previewConfig = resolvePreviewConfig(process.env);
  console.log(`[cypress] Using preview configuration -> ${describePreviewConfig(previewConfig)}`);

  ensureBuildArtifactsExist(previewConfig);
  ensureSupabaseEnv(previewConfig);

  const server: PreviewServerHandle = await startPreviewServer(previewConfig);
  console.log(`[cypress] Preview server ready at ${previewConfig.url}`);

  const cypressBin = resolveCypressBin();
  const cypressArgs = ['run', '--spec', 'cypress/e2e/routes_integrity.cy.ts', ...process.argv.slice(2)];

  const env = {
    ...process.env,
    PREVIEW_URL: previewConfig.url,
    CYPRESS_BASE_URL: previewConfig.url,
  };

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const command = process.platform === 'win32' ? 'cmd' : cypressBin;
      const commandArgs = process.platform === 'win32'
        ? ['/d', '/s', '/c', cypressBin, ...cypressArgs]
        : cypressArgs;

      const child = spawn(command, commandArgs, {
        env,
        stdio: 'inherit',
        shell: false,
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolvePromise();
        } else {
          rejectPromise(new Error(`cypress run exited with code ${code ?? 'null'}`));
        }
      });

      child.on('error', (error) => {
        rejectPromise(error);
      });
    });
  } finally {
    await server.close();
  }
};

run().catch((error) => {
  console.error('[cypress] Route integrity suite failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
