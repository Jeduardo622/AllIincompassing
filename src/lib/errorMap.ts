export type NormalizedError = Error & { status?: number; code?: string };

export function toNormalizedError(input: unknown, fallbackMessage = 'Request failed'): NormalizedError {
  const base: NormalizedError = (input instanceof Error ? input : new Error(String(input || fallbackMessage))) as NormalizedError;
  // Attempt to extract status/code patterns used across PostgREST/Edge handlers
  if (typeof (input as any)?.status === 'number') {
    base.status = (input as any).status;
  } else if (typeof (input as any)?.code === 'string') {
    // Map common SQLSTATE codes
    if ((input as any).code === '42501') {
      base.status = 403;
    }
  }
  return base;
}

export function isUnauthorized(error: NormalizedError | unknown): boolean {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : undefined;
  return status === 401;
}

export function isForbidden(error: NormalizedError | unknown): boolean {
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : undefined;
  return status === 403;
}


