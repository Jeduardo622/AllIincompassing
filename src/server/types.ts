import type { Session } from "../types";
import type { HoldResponse } from "../lib/sessionHolds";

export interface BookingOverrides {
  cptCode?: string;
  modifiers?: string[];
}

export type RequiredSessionFields = Pick<
  Session,
  "therapist_id" | "client_id" | "start_time" | "end_time"
>;

export type BookableSession = RequiredSessionFields &
  Partial<Omit<Session, keyof RequiredSessionFields>>;

export interface BookSessionRequest {
  session: BookableSession;
  startTimeOffsetMinutes: number;
  endTimeOffsetMinutes: number;
  timeZone: string;
  holdSeconds?: number;
  idempotencyKey?: string;
  overrides?: BookingOverrides;
  accessToken: string;
}

export interface DerivedCpt {
  code: string;
  description: string;
  modifiers: string[];
  source: "override" | "session_type" | "fallback";
  durationMinutes: number | null;
}

export interface BookSessionResult {
  session: Session;
  hold: HoldResponse;
  cpt: DerivedCpt;
}

export type BookSessionApiRequestBody = Omit<BookSessionRequest, "idempotencyKey" | "accessToken">;

export interface BookSessionApiResponse {
  success: boolean;
  data?: BookSessionResult;
  error?: string;
  code?: string;
}
