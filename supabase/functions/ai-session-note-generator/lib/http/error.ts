import { z } from 'npm:zod@3.23.8';

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ErrorClassification = {
  category: string;
  severity: ErrorSeverity;
  retryable: boolean;
  httpStatus: number;
};

export interface ErrorEnvelopeArgs {
  requestId: string;
  code: string;
  message: string;
  status?: number;
  headers?: Record<string, string>;
}

const ERROR_TAXONOMY: Record<string, ErrorClassification> = {
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

export const getErrorClassification = (code: string): ErrorClassification => (
  ERROR_TAXONOMY[code] ?? ERROR_TAXONOMY.internal_error
);

export function errorEnvelope({ requestId, code, message, status, headers = {} }: ErrorEnvelopeArgs): Response {
  const classification = getErrorClassification(code);
  const resolvedStatus = status ?? classification.httpStatus ?? 400;
  const body = { requestId, code, message, classification };
  return new Response(JSON.stringify(body), {
    status: resolvedStatus,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function getRequestId(req: Request): string {
  return req.headers.get('x-request-id') || crypto.randomUUID();
}

// Simple in-memory rate limiter (best-effort, per instance)
const rateState = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateState.get(key);
  if (!entry || now > entry.resetAt) {
    rateState.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (entry.count < limit) {
    entry.count += 1;
    return { allowed: true };
  }
  return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
}

// Common schemas
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);


