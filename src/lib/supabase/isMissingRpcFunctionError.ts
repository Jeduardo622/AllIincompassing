import type { PostgrestError } from '@supabase/supabase-js';
import { toError } from '../logger/normalizeError';

interface MaybePostgrestError extends Partial<PostgrestError> {
  status?: number;
}

const isStringContaining = (value: unknown, search: string): boolean => (
  typeof value === 'string' && value.toLowerCase().includes(search.toLowerCase())
);

const extractPostgrest = (error: unknown): MaybePostgrestError => (
  typeof error === 'object' && error !== null
    ? (error as MaybePostgrestError)
    : {}
);

const hasMissingFunctionMessage = (message: string | undefined, functionName: string): boolean => (
  isStringContaining(message, functionName) &&
  (isStringContaining(message, 'not found') || isStringContaining(message, 'missing function') || isStringContaining(message, 'could not find'))
);

/**
 * Detects whether a PostgREST error indicates that a requested RPC function is missing.
 */
export const isMissingRpcFunctionError = (
  error: unknown,
  functionName: string,
): boolean => {
  if (!error) {
    return false;
  }

  const postgrestError = extractPostgrest(error);

  if (typeof postgrestError.status === 'number' && postgrestError.status === 404) {
    return true;
  }

  const code = typeof postgrestError.code === 'string' ? postgrestError.code.toUpperCase() : undefined;
  if (code === 'PGRST301' || code === 'PGRST404') {
    return true;
  }

  if (hasMissingFunctionMessage(postgrestError.message, functionName)) {
    return true;
  }

  if (hasMissingFunctionMessage(postgrestError.details, functionName)) {
    return true;
  }

  if (hasMissingFunctionMessage(postgrestError.hint, functionName)) {
    return true;
  }

  if (error instanceof Error && hasMissingFunctionMessage(error.message, functionName)) {
    return true;
  }

  return false;
};

export const describePostgrestError = (error: unknown): string => {
  if (!error) {
    return 'Unknown PostgREST error';
  }

  const postgrestError = extractPostgrest(error);
  const code = typeof postgrestError.code === 'string' && postgrestError.code.length > 0
    ? `[${postgrestError.code}] `
    : '';
  const primaryMessage = typeof postgrestError.message === 'string' && postgrestError.message.length > 0
    ? postgrestError.message
    : undefined;
  const fallbackMessage = toError(error).message;
  const message = primaryMessage ?? fallbackMessage;
  const details = typeof postgrestError.details === 'string' && postgrestError.details.length > 0
    ? ` (${postgrestError.details})`
    : '';
  return `${code}${message}${details}`.trim();
};
