const MODAL_MODE_QUERY_KEY = "scheduleModal";
const MODAL_START_QUERY_KEY = "scheduleStart";
const MODAL_SESSION_QUERY_KEY = "scheduleSessionId";
const MODAL_EXPIRY_QUERY_KEY = "scheduleExp";

export const SCHEDULE_MODAL_URL_TTL_MS = 30 * 60 * 1000;

export type ScheduleModalUrlState =
  | {
      mode: "create";
      startTimeIso: string;
      expiresAtMs: number;
    }
  | {
      mode: "edit";
      sessionId: string;
      expiresAtMs: number;
    };

export type ParsedScheduleModalUrlState =
  | {
      kind: "none";
    }
  | {
      kind: "expired";
    }
  | {
      kind: "invalid";
    }
  | {
      kind: "ready";
      state: ScheduleModalUrlState;
      key: string;
    };

export function clearScheduleModalSearchParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(MODAL_MODE_QUERY_KEY);
  next.delete(MODAL_START_QUERY_KEY);
  next.delete(MODAL_SESSION_QUERY_KEY);
  next.delete(MODAL_EXPIRY_QUERY_KEY);
  return next;
}

export function applyScheduleModalSearchParams(
  params: URLSearchParams,
  state: ScheduleModalUrlState,
): URLSearchParams {
  const next = clearScheduleModalSearchParams(params);
  next.set(MODAL_MODE_QUERY_KEY, state.mode);
  next.set(MODAL_EXPIRY_QUERY_KEY, String(state.expiresAtMs));

  if (state.mode === "create") {
    next.set(MODAL_START_QUERY_KEY, state.startTimeIso);
  } else {
    next.set(MODAL_SESSION_QUERY_KEY, state.sessionId);
  }

  return next;
}

function normalizeExpiresAt(raw: string | null): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
}

function isValidIsoDate(value: string | null): value is string {
  if (!value) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function toModalKey(state: ScheduleModalUrlState): string {
  return state.mode === "create"
    ? `create|${state.startTimeIso}|${state.expiresAtMs}`
    : `edit|${state.sessionId}|${state.expiresAtMs}`;
}

export function parseScheduleModalSearchParams(
  params: URLSearchParams,
  nowMs: number = Date.now(),
): ParsedScheduleModalUrlState {
  const mode = params.get(MODAL_MODE_QUERY_KEY);
  if (!mode) {
    return { kind: "none" };
  }

  if (mode !== "create" && mode !== "edit") {
    return { kind: "invalid" };
  }

  const expiresAtMs = normalizeExpiresAt(params.get(MODAL_EXPIRY_QUERY_KEY));
  if (expiresAtMs === null) {
    return { kind: "invalid" };
  }
  if (expiresAtMs <= nowMs) {
    return { kind: "expired" };
  }

  if (mode === "create") {
    const startTimeIso = params.get(MODAL_START_QUERY_KEY);
    if (!isValidIsoDate(startTimeIso)) {
      return { kind: "invalid" };
    }
    const state: ScheduleModalUrlState = { mode, startTimeIso, expiresAtMs };
    return { kind: "ready", state, key: toModalKey(state) };
  }

  const sessionId = params.get(MODAL_SESSION_QUERY_KEY);
  if (!sessionId || sessionId.trim().length === 0) {
    return { kind: "invalid" };
  }

  const state: ScheduleModalUrlState = {
    mode,
    sessionId,
    expiresAtMs,
  };
  return { kind: "ready", state, key: toModalKey(state) };
}
