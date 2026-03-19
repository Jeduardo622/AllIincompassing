export type ApiErrorShape = {
  error?: string;
  message?: string;
  code?: string;
  hint?: string;
  retryAfter?: string | null;
  retryAfterSeconds?: number | null;
  orchestration?: Record<string, unknown> | null;
};

export type NormalizedApiError = Error & {
  status?: number;
  code?: string;
  hint?: string;
  retryAfter?: string | null;
  retryAfterSeconds?: number | null;
  orchestration?: Record<string, unknown> | null;
};

export const toNormalizedApiError = (
  payload: ApiErrorShape | null,
  status: number,
  fallbackMessage: string,
): NormalizedApiError => {
  const message = payload?.error ?? payload?.message ?? fallbackMessage;
  const error = new Error(message) as NormalizedApiError;
  error.status = status;
  error.code = payload?.code;
  error.hint = payload?.hint;
  error.retryAfter = typeof payload?.retryAfter === "string" ? payload.retryAfter : null;
  error.retryAfterSeconds = typeof payload?.retryAfterSeconds === "number" ? payload.retryAfterSeconds : null;
  error.orchestration = payload?.orchestration ?? null;
  return error;
};

