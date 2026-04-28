import { z } from "zod";

/** Matches `sessionSchema` / `recurrenceSchema` datetime rules in `src/server/types.ts`. */
const isoDateTimeWithOffset = z.string().datetime({ offset: true });

function isValidOffsetDateTime(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && isoDateTimeWithOffset.safeParse(trimmed).success;
}

function normalizeRecurrenceRecord(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const rec = { ...(value as Record<string, unknown>) };

  if ("until" in rec) {
    const until = rec.until;
    if (until !== undefined && until !== null && !isValidOffsetDateTime(until)) {
      delete rec.until;
    }
  }

  if (Array.isArray(rec.exceptions)) {
    const filtered = rec.exceptions.filter((entry) => isValidOffsetDateTime(entry));
    if (filtered.length > 0) {
      rec.exceptions = filtered;
    } else {
      delete rec.exceptions;
    }
  }

  return rec;
}

export function normalizeSessionPayloadSubtree(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const session = { ...(value as Record<string, unknown>) };

  for (const key of ["created_at", "updated_at"] as const) {
    if (key in session) {
      const v = session[key];
      if (v !== undefined && v !== null && !isValidOffsetDateTime(v)) {
        delete session[key];
      }
    }
  }

  if (session.recurrence !== undefined && session.recurrence !== null) {
    session.recurrence = normalizeRecurrenceRecord(session.recurrence);
  }

  return session;
}

/**
 * Strips or relaxes booking JSON fields that commonly fail Zod `datetime({ offset: true })`
 * when upstream RPCs return Postgres timestamps without explicit offsets.
 */
export function normalizeBookRequestBodyForZod(rawBody: unknown): unknown {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return rawBody;
  }

  const body = { ...(rawBody as Record<string, unknown>) };

  if ("session" in body) {
    body.session = normalizeSessionPayloadSubtree(body.session);
  }

  if ("recurrence" in body && body.recurrence !== undefined && body.recurrence !== null) {
    body.recurrence = normalizeRecurrenceRecord(body.recurrence);
  }

  return body;
}
