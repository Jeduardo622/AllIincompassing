type ErrorLikeRecord = {
  message?: unknown;
  error?: unknown;
  error_description?: unknown;
  code?: unknown;
};

const extractMessage = (value: ErrorLikeRecord): string | null => {
  const candidates = [value.message, value.error_description, value.error];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
};

export const toError = (value: unknown, fallback = 'Unknown error'): Error => {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return new Error(value.trim());
  }

  if (value && typeof value === 'object') {
    const message = extractMessage(value as ErrorLikeRecord);
    if (message) {
      const err = new Error(message);
      const code = (value as ErrorLikeRecord).code;
      if (typeof code === 'string' && code.trim().length > 0) {
        err.name = `SupabaseError:${code.trim()}`;
      }
      return err;
    }
  }

  return new Error(fallback);
};
