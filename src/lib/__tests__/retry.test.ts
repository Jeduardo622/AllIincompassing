import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { fetchWithRetry } from '../retry';

const buildResponse = (status: number) => ({ status } as Response);

describe('fetchWithRetry', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('retries on retryable status codes', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(buildResponse(503))
      .mockResolvedValueOnce(buildResponse(200));

    const response = await fetchWithRetry('https://example.com', { method: 'GET' }, {
      baseDelayMs: 1,
      maxDelayMs: 1,
      maxAttempts: 2,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it('retries on network errors when enabled', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(buildResponse(200));

    const response = await fetchWithRetry('https://example.com', { method: 'GET' }, {
      baseDelayMs: 1,
      maxDelayMs: 1,
      maxAttempts: 2,
      retryOnNetworkError: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });
});
