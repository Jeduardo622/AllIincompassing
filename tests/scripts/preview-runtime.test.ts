import { promises as fs } from 'node:fs';
import type http from 'node:http';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { PreviewConfig } from '../../src/preview/config';

import {
  forwardRequest,
  isPreviewSessionNotesApiEnabled,
  isPreviewSessionNotesApiRequest,
  startPreviewServer,
} from '../../scripts/lib/preview-runtime';

const requestFrom = (body: string, headers: http.IncomingHttpHeaders = {}): http.IncomingMessage => {
  const request = Readable.from([body]) as http.IncomingMessage;
  request.method = 'POST';
  request.url = '/api/session-notes/upsert?mode=draft';
  request.headers = headers;
  return request;
};

const responseRecorder = () => {
  const headers = new Map<string, string | number | readonly string[]>();
  let body = Buffer.alloc(0);
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    end(chunk?: Uint8Array) {
      body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
      return this;
    },
  } as unknown as http.ServerResponse;

  return { response, headers, getBody: () => body.toString('utf8') };
};

const reserveEphemeralPort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to reserve an ephemeral preview port');
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
};

const withPreviewServer = async (
  optIn: string | undefined,
  handler: ((request: Request) => Promise<Response>) | undefined,
  assertion: (baseUrl: string) => Promise<void>,
): Promise<void> => {
  const previousOptIn = process.env.PREVIEW_ENABLE_SESSION_NOTES_API;
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-session-notes-'));
  const port = await reserveEphemeralPort();
  const config: PreviewConfig = {
    host: '127.0.0.1',
    port,
    protocol: 'http',
    outDir,
    url: `http://127.0.0.1:${port}`,
  };
  await fs.writeFile(path.join(outDir, 'index.html'), '<html><body>SPA fallback marker</body></html>');
  if (optIn === undefined) {
    delete process.env.PREVIEW_ENABLE_SESSION_NOTES_API;
  } else {
    process.env.PREVIEW_ENABLE_SESSION_NOTES_API = optIn;
  }

  const preview = await startPreviewServer(config, { sessionNotesUpsertHandler: handler });
  try {
    await assertion(config.url);
  } finally {
    await preview.close();
    await fs.rm(outDir, { recursive: true, force: true });
    if (previousOptIn === undefined) {
      delete process.env.PREVIEW_ENABLE_SESSION_NOTES_API;
    } else {
      process.env.PREVIEW_ENABLE_SESSION_NOTES_API = previousOptIn;
    }
  }
};

describe.sequential('preview session-notes API routing', () => {
  it('enables the real handler only for the literal true opt-in', () => {
    expect(isPreviewSessionNotesApiEnabled({ PREVIEW_ENABLE_SESSION_NOTES_API: 'true' })).toBe(true);
    expect(isPreviewSessionNotesApiEnabled({ PREVIEW_ENABLE_SESSION_NOTES_API: 'TRUE' })).toBe(false);
    expect(isPreviewSessionNotesApiEnabled({})).toBe(false);
  });

  it('routes only the exact session-notes upsert pathname when opted in', () => {
    const enabledEnv = { PREVIEW_ENABLE_SESSION_NOTES_API: 'true' };

    expect(isPreviewSessionNotesApiRequest('/api/session-notes/upsert', enabledEnv)).toBe(true);
    expect(isPreviewSessionNotesApiRequest('/api/session-notes/upsert?action=read', enabledEnv)).toBe(true);
    expect(isPreviewSessionNotesApiRequest('/api/session-notes/upsert-extra', enabledEnv)).toBe(false);
    expect(isPreviewSessionNotesApiRequest('/api/other', enabledEnv)).toBe(false);
    expect(isPreviewSessionNotesApiRequest('/api/session-notes/upsert', {})).toBe(false);
  });

  it('preserves the method, headers, body, and handler response', async () => {
    const incoming = requestFrom('{"note":"synthetic"}', {
      authorization: 'Bearer synthetic-token',
      'content-type': 'application/json',
      'x-proof-header': 'preserved',
    });
    const recorded = responseRecorder();

    await forwardRequest(incoming, recorded.response, async (request) => {
      expect(request.method).toBe('POST');
      expect(request.url).toBe('http://localhost/api/session-notes/upsert?mode=draft');
      expect(request.headers.get('authorization')).toBe('Bearer synthetic-token');
      expect(request.headers.get('x-proof-header')).toBe('preserved');
      expect(await request.text()).toBe('{"note":"synthetic"}');
      return new Response('{"bridged":true}', {
        status: 202,
        headers: { 'content-type': 'application/json', 'x-handler': 'real' },
      });
    });

    expect(recorded.response.statusCode).toBe(202);
    expect(recorded.headers.get('content-type')).toBe('application/json');
    expect(recorded.headers.get('x-handler')).toBe('real');
    expect(recorded.getBody()).toBe('{"bridged":true}');
  });

  it('rejects request bodies larger than 1 MiB before invoking the handler', async () => {
    const incoming = requestFrom('x'.repeat(1024 * 1024 + 1));
    const recorded = responseRecorder();
    let handlerCalled = false;

    await forwardRequest(incoming, recorded.response, async () => {
      handlerCalled = true;
      return new Response(null, { status: 204 });
    });

    expect(handlerCalled).toBe(false);
    expect(recorded.response.statusCode).toBe(413);
    expect(recorded.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(recorded.getBody())).toEqual({ error: 'Request body exceeds 1 MiB limit' });
  });

  it('wires the opted-in preview route to the configured real-handler boundary', async () => {
    const handler = vi.fn(async () =>
      new Response('{"source":"session-notes-handler"}', {
        status: 209,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await withPreviewServer('true', handler, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/session-notes/upsert?proof=integration`);
      expect(response.status).toBe(209);
      expect(await response.json()).toEqual({ source: 'session-notes-handler' });
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0].url).toContain('/api/session-notes/upsert?proof=integration');
  });

  it('uses the real session-notes handler by default when opted in', async () => {
    await withPreviewServer('true', undefined, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/session-notes/upsert`);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        success: false,
        code: 'unauthorized',
        error: 'Missing authorization token',
      });
    });
  });

  it('keeps the SPA fallback when the opt-in is missing or non-literal', async () => {
    for (const optIn of [undefined, 'TRUE']) {
      const handler = vi.fn(async () => new Response('unexpected handler response', { status: 209 }));

      await withPreviewServer(optIn, handler, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/session-notes/upsert`);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('SPA fallback marker');
      });

      expect(handler).not.toHaveBeenCalled();
    }
  });
});
