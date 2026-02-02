export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOnStatus?: number[];
  retryOnNetworkError?: boolean;
};

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 2000,
  retryOnStatus: [429, 502, 503, 504],
  retryOnNetworkError: true,
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const nextDelay = (baseDelayMs: number, maxDelayMs: number, attempt: number): number => {
  const expDelay = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * baseDelayMs;
  return Math.min(maxDelayMs, expDelay + jitter);
};

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const config = { ...DEFAULT_RETRY, ...options };
  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(input, init);
      if (
        attempt + 1 < config.maxAttempts &&
        config.retryOnStatus.includes(response.status)
      ) {
        attempt += 1;
        const delayMs = nextDelay(config.baseDelayMs, config.maxDelayMs, attempt);
        await sleep(delayMs);
        continue;
      }
      return response;
    } catch (error) {
      attempt += 1;
      if (!config.retryOnNetworkError || attempt >= config.maxAttempts) {
        throw error;
      }
      const delayMs = nextDelay(config.baseDelayMs, config.maxDelayMs, attempt);
      await sleep(delayMs);
    }
  }
}
