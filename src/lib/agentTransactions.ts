export interface AgentOperationContext {
  actionType: string;
  operationId: string;
  idempotencyKey: string;
  maxAttempts: number;
}

type RetryableError = Error & { status?: number };

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createAgentOperationContext(
  actionType: string,
  maxAttempts = 2,
): AgentOperationContext {
  const operationId = createOperationId();
  return {
    actionType,
    operationId,
    idempotencyKey: `${actionType}:${operationId}`,
    maxAttempts: Math.max(1, Math.trunc(maxAttempts)),
  };
}

export function isRetryableAgentError(error: unknown): boolean {
  const retryable = error as RetryableError;
  if (typeof retryable?.status === "number" && RETRYABLE_STATUS.has(retryable.status)) {
    return true;
  }

  if (retryable?.message) {
    const normalized = retryable.message.toLowerCase();
    return normalized.includes("network")
      || normalized.includes("timed out")
      || normalized.includes("unable to reach");
  }

  return false;
}

function parseRetryDelayMs(error: unknown): number | null {
  const retryable = error as RetryableError & {
    retryAfterSeconds?: number | null;
    retryAfter?: string | null;
  };

  if (typeof retryable.retryAfterSeconds === "number" && Number.isFinite(retryable.retryAfterSeconds)) {
    const boundedSeconds = Math.max(0, Math.min(30, retryable.retryAfterSeconds));
    return boundedSeconds * 1000;
  }

  if (typeof retryable.retryAfter === "string" && retryable.retryAfter.trim().length > 0) {
    const targetMs = Date.parse(retryable.retryAfter);
    if (Number.isFinite(targetMs)) {
      const delta = targetMs - Date.now();
      return Math.max(0, Math.min(30_000, delta));
    }
  }

  return null;
}

export async function withAgentRetry<T>(
  context: AgentOperationContext,
  operation: () => Promise<T>,
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < context.maxAttempts) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= context.maxAttempts || !isRetryableAgentError(error)) {
        throw error;
      }

      const explicitRetryMs = parseRetryDelayMs(error);
      const backoffMs = explicitRetryMs ?? Math.min(250 * 2 ** (attempt - 1), 1000);
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Agent operation failed");
}
