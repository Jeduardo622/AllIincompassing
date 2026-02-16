import { toError } from '../logger/normalizeError';
import { describePostgrestError } from './isMissingRpcFunctionError';

interface MaybePostgrestError {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  status?: unknown;
}

const toSearchableText = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
};

const getPostgrestError = (error: unknown): MaybePostgrestError => {
  if (!error || typeof error !== 'object') {
    return {};
  }
  return error as MaybePostgrestError;
};

const isTimeoutError = (error: unknown): boolean => {
  const message = toSearchableText(toError(error).message);
  return message.includes('timed out') || message.startsWith('timeout:');
};

export const withMutationTimeout = async <T>(
  promise: Promise<T>,
  operation: string,
  timeoutMs = 15000,
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Timeout: ${operation}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

export const isPermissionDeniedError = (error: unknown): boolean => {
  const postgrestError = getPostgrestError(error);
  const code = toSearchableText(postgrestError.code);
  const status = typeof postgrestError.status === 'number' ? postgrestError.status : null;
  const message = toSearchableText(postgrestError.message);
  const details = toSearchableText(postgrestError.details);
  const hint = toSearchableText(postgrestError.hint);
  const rawMessage = toSearchableText(toError(error).message);
  const combined = `${message} ${details} ${hint} ${rawMessage}`;

  if (code === '42501' || status === 403) {
    return true;
  }

  return (
    combined.includes('permission denied') ||
    combined.includes('access denied') ||
    combined.includes('forbidden') ||
    combined.includes('not allowed') ||
    combined.includes('insufficient privileges') ||
    combined.includes('row-level security')
  );
};

export const toTherapistMutationError = (error: unknown): Error => {
  if (isPermissionDeniedError(error)) {
    return new Error(
      'Access denied while creating the therapist. Make sure your account has admin access for this organization.',
    );
  }

  if (isTimeoutError(error)) {
    return new Error('Therapist creation timed out. Please retry.');
  }

  return toError(error, describePostgrestError(error));
};
