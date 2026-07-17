import type http from 'node:http';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  forwardRequest,
  isPreviewSessionNotesApiEnabled,
  isPreviewSessionNotesApiRequest,
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

describe('preview session-notes API routing', () => {
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
});
