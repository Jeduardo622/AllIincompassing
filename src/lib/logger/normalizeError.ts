export const toError = (value: unknown, fallback = 'Unknown error'): Error => {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return new Error(value);
  }

  return new Error(fallback);
};
