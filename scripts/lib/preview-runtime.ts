import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import type { PreviewConfig } from '../../src/preview/config';
import { runtimeConfigHandler } from '../../src/server/api/runtime-config';

export type PreviewServerHandle = {
  readonly close: () => Promise<void>;
};

export const ensureBuildArtifactsExist = (config: PreviewConfig): void => {
  const absoluteDir = path.resolve(config.outDir);
  if (!fs.existsSync(absoluteDir)) {
    throw new Error(`Preview build output not found at ${absoluteDir}. Run "npm run preview:build" first.`);
  }
  const indexPath = path.join(absoluteDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Preview build output missing index.html at ${indexPath}.`);
  }
};

export const ensureSupabaseEnv = (config: PreviewConfig): void => {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return;
  }

  const stubBase = `${config.protocol}://${config.host}:${config.port}/__supabase`;
  const stubAnonKey = process.env.SUPABASE_ANON_KEY ?? 'preview-anon-key';

  process.env.SUPABASE_URL = stubBase;
  process.env.VITE_SUPABASE_URL = stubBase;
  process.env.SUPABASE_EDGE_URL = process.env.SUPABASE_EDGE_URL ?? `${stubBase}/edge-functions`;
  process.env.VITE_SUPABASE_EDGE_URL = process.env.VITE_SUPABASE_EDGE_URL ?? `${stubBase}/edge-functions`;
  process.env.SUPABASE_ANON_KEY = stubAnonKey;
  process.env.VITE_SUPABASE_ANON_KEY = stubAnonKey;
};

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

const contentTypeForPath = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
};

const sendFile = async (
  res: http.ServerResponse,
  filePath: string,
  fallbackPath: string,
  absoluteDir: string,
): Promise<void> => {
  let resolvedPath = path.normalize(filePath);

  if (!resolvedPath.startsWith(absoluteDir)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  try {
    const fileStat = await fsPromises.stat(resolvedPath);
    if (fileStat.isDirectory()) {
      resolvedPath = path.join(resolvedPath, 'index.html');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    resolvedPath = fallbackPath;
  }

  const stream = fs.createReadStream(resolvedPath);
  stream.on('error', (error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (resolvedPath !== fallbackPath) {
        void sendFile(res, fallbackPath, fallbackPath, absoluteDir);
        return;
      }
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    res.statusCode = 500;
    res.end('Internal Server Error');
  });

  res.statusCode = 200;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', contentTypeForPath(resolvedPath));
  stream.pipe(res);
};

export const startPreviewServer = async (config: PreviewConfig): Promise<PreviewServerHandle> => {
  const absoluteDir = path.resolve(config.outDir);
  const fallbackPath = path.join(absoluteDir, 'index.html');
  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url ?? '/';
    if (rawUrl.startsWith('/__supabase/auth/v1/health')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (rawUrl.startsWith('/__supabase/auth/v1/session')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ currentSession: null, currentUser: null }));
      return;
    }

    if (rawUrl.startsWith('/api/runtime-config')) {
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

    const url = new URL(rawUrl, `${config.protocol}://${config.host}:${config.port}`);
    const decodedPath = decodeURIComponent(url.pathname);
    const requestedPath = path.join(absoluteDir, decodedPath);

    try {
      await sendFile(res, requestedPath, fallbackPath, absoluteDir);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Preview server error serving static asset' }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

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
