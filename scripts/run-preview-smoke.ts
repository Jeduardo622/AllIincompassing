import { spawn } from 'node:child_process';
import process from 'node:process';

import { describePreviewConfig, resolvePreviewConfig } from '../src/preview/config';
import {
  ensureBuildArtifactsExist,
  ensureSupabaseEnv,
  startPreviewServer,
  type PreviewServerHandle,
} from './lib/preview-runtime';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import handler from 'serve-handler';

import { describePreviewConfig, resolvePreviewConfig } from '../src/preview/config';
import { runtimeConfigHandler } from '../src/server/api/runtime-config';

const ensureSupabaseEnv = (host: string, port: number): void => {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return;
  }

  const stubBase = `http://${host}:${port}/__supabase`;
  const stubAnonKey = process.env.SUPABASE_ANON_KEY ?? 'preview-anon-key';

  process.env.SUPABASE_URL = stubBase;
  process.env.VITE_SUPABASE_URL = stubBase;
  process.env.SUPABASE_EDGE_URL = process.env.SUPABASE_EDGE_URL ?? `${stubBase}/edge-functions`;
  process.env.VITE_SUPABASE_EDGE_URL = process.env.VITE_SUPABASE_EDGE_URL ?? `${stubBase}/edge-functions`;
  process.env.SUPABASE_ANON_KEY = stubAnonKey;
  process.env.VITE_SUPABASE_ANON_KEY = stubAnonKey;
};

type CloseableServer = {
  readonly close: () => Promise<void>;
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
    child.on('error', (error) => reject(error));
  });
};

const logServerReady = (configDescription: string): void => {
  console.log(`[preview] Preview server ready on ${configDescription}.`);
const forwardRuntimeConfig = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
  const url = req.url ?? '/api/runtime-config';
  const method = req.method ?? 'GET';
  const request = new Request(new URL(url, 'http://localhost'), {
    method,
    headers: new Headers(
      Object.entries(req.headers).reduce<Record<string, string>>((acc, [key, value]) => {
        if (typeof value === 'string') {
          acc[key] = value;
        } else if (Array.isArray(value)) {
          acc[key] = value.join(', ');
        }
        return acc;
      }, {}),
    ),
  });

  const response = await runtimeConfigHandler(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const body = await response.arrayBuffer();
  res.end(Buffer.from(body));
};

const startPreviewServer = async (outDir: string, host: string, port: number): Promise<CloseableServer> => {
  const absoluteDir = path.resolve(outDir);
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/__supabase/auth/v1/health')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (url.startsWith('/__supabase/auth/v1/session')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ currentSession: null, currentUser: null }));
      return;
    }

    if (url.startsWith('/api/runtime-config')) {
      try {
        await forwardRuntimeConfig(req, res);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Runtime config handler failed';
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    handler(req, res, {
      public: absoluteDir,
      cleanUrls: true,
      rewrites: [{ source: '**', destination: '/index.html' }],
      headers: [{ source: '**/*', headers: [{ key: 'Cache-Control', value: 'no-store' }] }],
    }).catch((error: unknown) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Preview server error' }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  console.log(`[preview] Preview server ready on http://${host}:${port} serving ${absoluteDir}.`);

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
};

const ensureBuildArtifactsExist = (outDir: string): void => {
  const absoluteDir = path.resolve(outDir);
  if (!fs.existsSync(absoluteDir)) {
    throw new Error(`Preview build output not found at ${absoluteDir}. Run \"npm run preview:build\" first.`);
  }
  const indexPath = path.join(absoluteDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Preview build output missing index.html at ${indexPath}.`);
  }
};

const main = async (): Promise<void> => {
  const smokeArgs = process.argv.slice(2);
  const previewConfig = resolvePreviewConfig(process.env);
  console.log(`[preview] Smoke configuration -> ${describePreviewConfig(previewConfig)}`);

  ensureBuildArtifactsExist(previewConfig);
  ensureSupabaseEnv(previewConfig);

  const server: PreviewServerHandle = await startPreviewServer(previewConfig);
  logServerReady(`http://${previewConfig.host}:${previewConfig.port} serving ${previewConfig.outDir}`);
  ensureBuildArtifactsExist(previewConfig.outDir);
  ensureSupabaseEnv(previewConfig.host, previewConfig.port);

  const server = await startPreviewServer(previewConfig.outDir, previewConfig.host, previewConfig.port);

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
