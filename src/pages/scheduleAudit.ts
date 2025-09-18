import type { Session } from "../types";

export function sanitizeAuditActorId(candidate: unknown): string | null {
  if (typeof candidate !== "string") {
    return null;
  }
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function stampAuditMetadata(
  session: Partial<Session>,
  actorId: string | null,
  timestamp: Date = new Date(),
): Partial<Session> {
  const isoTimestamp = timestamp.toISOString();
  const sanitizedActor = sanitizeAuditActorId(actorId);
  const sanitizedCreatedBy = sanitizeAuditActorId(session.created_by);
  const sanitizedUpdatedBy = sanitizeAuditActorId(session.updated_by);

  return {
    ...session,
    created_at: session.created_at ?? isoTimestamp,
    created_by: sanitizedCreatedBy ?? sanitizedActor ?? null,
    updated_at: isoTimestamp,
    updated_by: sanitizedActor ?? sanitizedUpdatedBy ?? null,
  };
}
