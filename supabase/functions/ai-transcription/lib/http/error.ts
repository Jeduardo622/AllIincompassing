import { z } from 'npm:zod@3.23.8';

export interface ErrorEnvelopeArgs {
  requestId: string;
  code: string;
  message: string;
  status?: number;
  headers?: Record<string, string>;
}

export function errorEnvelope({ requestId, code, message, status = 400, headers = {} }: ErrorEnvelopeArgs): Response {
  const body = { requestId, code, message };
  return new Response(JSON.stringify(body), {
    status,
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


