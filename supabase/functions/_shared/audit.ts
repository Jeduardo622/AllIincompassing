import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { increment } from "./metrics.ts";

export type AuditLogger = {
  warn?: (message: string, context?: Record<string, unknown>) => void;
  error?: (message: string, context?: Record<string, unknown>) => void;
};

export interface SessionAuditEvent {
  readonly sessionId: string;
  readonly eventType: string;
  readonly actorId?: string | null;
  readonly payload?: Record<string, unknown> | null;
  readonly required?: boolean;
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
      increment("session_audit_failure_total", {
        eventType: event.eventType,
        required: Boolean(event.required),
        failureType: "rpc_error",
      });
      event.logger?.warn?.("audit.event.persist_failed", {
        eventType: event.eventType,
        sessionId: event.sessionId,
        error: error.message ?? "unknown",
      });
      if (event.required) {
        throw new Error(`Audit write failed for ${event.eventType}: ${error.message ?? "unknown"}`);
      }
    }
  } catch (error) {
    increment("session_audit_failure_total", {
      eventType: event.eventType,
      required: Boolean(event.required),
      failureType: "exception",
    });
    const message = error instanceof Error ? error.message : "unknown";
    event.logger?.error?.("audit.event.exception", {
      eventType: event.eventType,
      sessionId: event.sessionId,
      error: message,
    });
    if (event.required) {
      throw error;
    }
  }
}
