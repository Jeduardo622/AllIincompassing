export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ErrorClassification = {
  category: string;
  severity: ErrorSeverity;
  retryable: boolean;
  httpStatus: number;
};

export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'upstream_timeout'
  | 'upstream_unavailable'
  | 'upstream_error'
  | 'internal_error';

const ERROR_TAXONOMY: Record<ErrorCode, ErrorClassification> = {
  validation_error: { category: 'validation', severity: 'low', retryable: false, httpStatus: 400 },
  unauthorized: { category: 'auth', severity: 'medium', retryable: false, httpStatus: 401 },
  forbidden: { category: 'auth', severity: 'medium', retryable: false, httpStatus: 403 },
  not_found: { category: 'request', severity: 'low', retryable: false, httpStatus: 404 },
  rate_limited: { category: 'rate_limit', severity: 'high', retryable: true, httpStatus: 429 },
  upstream_timeout: { category: 'upstream', severity: 'high', retryable: true, httpStatus: 504 },
  upstream_unavailable: { category: 'upstream', severity: 'high', retryable: true, httpStatus: 503 },
  upstream_error: { category: 'upstream', severity: 'medium', retryable: true, httpStatus: 502 },
  internal_error: { category: 'internal', severity: 'critical', retryable: false, httpStatus: 500 },
};

export const getErrorClassification = (code: ErrorCode | string): ErrorClassification => (
  ERROR_TAXONOMY[(code as ErrorCode)] ?? ERROR_TAXONOMY.internal_error
);

export const isRetryableStatus = (status: number): boolean => (
  status === 429 || status === 502 || status === 503 || status === 504
);
