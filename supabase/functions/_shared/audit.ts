import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";

export type AuditLogger = {
  warn?: (message: string, context?: Record<string, unknown>) => void;
  error?: (message: string, context?: Record<string, unknown>) => void;
};

export interface SessionAuditEvent {
  readonly sessionId: string;
  readonly eventType: string;
  readonly actorId?: string | null;
  readonly payload?: Record<string, unknown> | null;
  readonly logger?: AuditLogger;
}

export async function recordSessionAuditEvent(
  client: SupabaseClient,
  event: SessionAuditEvent,
): Promise<void> {
  try {
    const { error } = await client.rpc("record_session_audit", {
      p_session_id: event.sessionId,
      p_event_type: event.eventType,
      p_actor_id: event.actorId ?? null,
      p_event_payload: event.payload ?? {},
    });

    if (error) {
      event.logger?.warn?.("audit.event.persist_failed", {
        eventType: event.eventType,
        sessionId: event.sessionId,
        error: error.message ?? "unknown",
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    event.logger?.error?.("audit.event.exception", {
      eventType: event.eventType,
      sessionId: event.sessionId,
      error: message,
    });
  }
}
