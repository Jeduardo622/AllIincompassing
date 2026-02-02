export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryOn: (error: unknown) => boolean;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const jitterDelay = (baseDelayMs: number, maxDelayMs: number, attempt: number): number => {
  const expDelay = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * baseDelayMs;
  return Math.min(maxDelayMs, expDelay + jitter);
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      const shouldRetry = attempt < options.maxAttempts && options.retryOn(error);
      if (!shouldRetry) {
        throw error;
      }
      const delayMs = jitterDelay(options.baseDelayMs, options.maxDelayMs, attempt);
      await sleep(delayMs);
    }
  }
}
