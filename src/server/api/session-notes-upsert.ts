import { z } from "zod";
import type { GoalTargetProgressionResult, SessionGoalMeasurementEntry, SessionNote } from "../../types";
import { mergeUniqueGoalIds, normalizeGoalMeasurementEntry } from "../../lib/goal-measurements";
import { isAdhocSessionTargetId, isValidSessionNoteGoalKey } from "../../lib/session-adhoc-targets";
import { getOptionalServerEnv } from "../env";
import {
  corsHeadersForRequest,
  currentUserCanCaptureTrialEvent,
  errorResponse,
  fetchAuthenticatedUserIdWithStatus,
  fetchJson,
  getAccessToken,
  getSupabaseConfig,
  isDisallowedOriginRequest,
  jsonForRequest,
  resolveOrgAndRoleWithStatus,
} from "./shared";
import { resolveSessionCaptureStrictBillingPolicy } from "../sessionCaptureBillingGate";

type SessionNoteRow = {
  id: string;
  authorization_id: string;
  client_id: string;
  created_at: string;
  end_time: string;
  goal_ids: string[] | null;
  goal_measurements: Record<string, unknown> | null;
  goal_notes: Record<string, string> | null;
  goals_addressed: string[] | null;
  is_locked: boolean;
  narrative: string;
  organization_id: string;
  service_code: string;
  session_date: string;
  session_duration: number | null;
  session_id: string | null;
  signed_at: string | null;
  start_time: string;
  therapist_id: string;
  updated_at: string;
  therapists?: {
    full_name: string | null;
    title: string | null;
  } | null;
};

const baseSelectColumns = [
  "id",
  "authorization_id",
  "client_id",
  "created_at",
  "end_time",
  "goal_ids",
  "goal_notes",
  "goals_addressed",
  "is_locked",
  "narrative",
  "organization_id",
  "service_code",
  "session_date",
  "session_duration",
  "session_id",
  "signed_at",
  "start_time",
  "therapist_id",
  "updated_at",
  "therapists:therapist_id(full_name,title)",
];

const selectColumns = [...baseSelectColumns, "goal_measurements"].join(",");
const fallbackSelectColumns = baseSelectColumns.join(",");

const upsertSchema = z.object({
  noteId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid(),
  authorizationId: z.string().uuid(),
  therapistId: z.string().uuid(),
  serviceCode: z.string().min(1),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  goalIds: z.array(z.string().min(1).refine((id) => isValidSessionNoteGoalKey(id))).default([]),
  goalsAddressed: z.array(z.string()).optional(),
  goalNotes: z.record(z.string()).default({}),
  goalMeasurements: z.record(z.unknown()).nullable().optional(),
  narrative: z.string().default(""),
  isLocked: z.boolean().default(false),
  /** When updating an existing note, only these goal keys read `goalNotes` / `goalMeasurements` from the request; other goals keep server values. */
  captureMergeGoalIds: z
    .array(z.string().min(1).refine((id) => isValidSessionNoteGoalKey(id)))
    .max(200)
    .optional(),
  trialEvents: z
    .array(z.object({
      target_id: z.string().uuid(),
      trial_number: z.number().int().positive(),
      response: z.enum([
        "correct",
        "incorrect",
        "noResponse",
        "independent",
        "prompted",
        "notObserved",
      ]).optional().nullable(),
      prompt_type: z.string().trim().optional().nullable(),
      prompt_level: z.string().trim().optional().nullable(),
      value: z.number().nonnegative().optional().nullable(),
      timestamp: z.string().datetime().optional(),
      metadata: z.record(z.unknown()).optional(),
      expected_progression_version: z.number().int().nonnegative().optional(),
    }))
    .max(500)
    .optional()
    .default([]),
});

type SessionCaptureTrialEventInput = z.infer<typeof upsertSchema>["trialEvents"][number];

export type ExpectedTargetVersion = { target_id: string; progression_version: number };

export function validateFinalizationTargetVersions(
  events: readonly { target_id: string; expected_progression_version?: number | null }[],
): ExpectedTargetVersion[] | null {
  const versions = new Map<string, number>();
  for (const event of events) {
    const version = event.expected_progression_version;
    if (typeof version !== "number" || !Number.isFinite(version) || !Number.isInteger(version) || version < 0) return null;
    const existing = versions.get(event.target_id);
    if (existing !== undefined && existing !== version) return null;
    versions.set(event.target_id, version);
  }
  return Array.from(versions, ([target_id, progression_version]) => ({ target_id, progression_version }));
}

const loadPersistedTrialTargetVersions = async (args: {
  supabaseUrl: string;
  headers: Record<string, string>;
  organizationId: string;
  sessionId: string;
}): Promise<{ events: Array<{ target_id: string; expected_progression_version?: number }>; upstreamError: boolean }> => {
  const result = await fetchJson<Array<{ target_id: string; metadata: Record<string, unknown> | null }>>(
    `${args.supabaseUrl}/rest/v1/trial_events?select=target_id,metadata` +
      `&organization_id=eq.${encodeURIComponent(args.organizationId)}` +
      `&session_id=eq.${encodeURIComponent(args.sessionId)}`,
    { method: "GET", headers: args.headers },
  );
  if (!result.ok || !Array.isArray(result.data)) return { events: [], upstreamError: true };
  return {
    events: result.data.map((row) => ({
      target_id: row.target_id,
      expected_progression_version:
        typeof row.metadata?.progression_version_at_capture === "number"
          ? row.metadata.progression_version_at_capture
          : undefined,
    })),
    upstreamError: false,
  };
};

type GoalTargetScope = {
  id: string;
  organization_id: string;
  client_id: string;
  goal_id: string;
  measurement_type: string;
};

type SessionScope = {
  id: string;
  organization_id: string;
  client_id: string;
  therapist_id: string;
};

const responseRequiredMeasurementTypes = new Set(["correctIncorrect", "taskAnalysis"]);
const valueRequiredMeasurementTypes = new Set(["frequency", "rate", "duration", "timeSample", "latency", "IRT"]);

const buildServiceRoleHeaders = (): Record<string, string> | null => {
  const serviceRoleKey = getOptionalServerEnv("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!serviceRoleKey) {
    return null;
  }
  return {
    "Content-Type": "application/json",
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
};

const normalizeTime = (value: string): string => {
  if (!value) {
    return "00:00:00";
  }
  if (value.length === 5) {
    return `${value}:00`;
  }
  return value;
};

const calculateSessionDurationMinutes = (startTime: string, endTime: string): number => {
  const start = Date.parse(`1970-01-01T${normalizeTime(startTime)}Z`);
  const end = Date.parse(`1970-01-01T${normalizeTime(endTime)}Z`);

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return 0;
  }

  return Math.round((end - start) / 60000);
};

const trimGoalNotes = (goalNotes: Record<string, string>): Record<string, string> | null => {
  const cleaned = Object.fromEntries(
    Object.entries(goalNotes)
      .map(([goalId, noteText]) => [goalId, noteText.trim()])
      .filter(([goalId, noteText]) => isValidSessionNoteGoalKey(goalId) && noteText.length > 0),
  );

  return Object.keys(cleaned).length > 0 ? cleaned : null;
};

const mergeScopedGoalCaptureFromExisting = (args: {
  captureMergeGoalIds: readonly string[];
  existingRow: SessionNoteRow;
  incomingGoalNotes: Record<string, string>;
  incomingGoalMeasurements: Record<string, unknown> | null | undefined;
}): {
  goalNotes: Record<string, string>;
  goalMeasurements: Record<string, unknown> | null;
} => {
  const existingNotes = { ...((args.existingRow.goal_notes as Record<string, string> | null) ?? {}) };
  const existingMeasNormalized = normalizeGoalMeasurements(args.existingRow.goal_measurements) ?? {};
  const mergedMeasPlain: Record<string, unknown> = Object.fromEntries(
    Object.entries(existingMeasNormalized).map(([id, entry]) => [id, entry as unknown]),
  );
  const mergedNotes = { ...existingNotes };

  for (const id of args.captureMergeGoalIds) {
    if (!isValidSessionNoteGoalKey(id)) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(args.incomingGoalNotes, id)) {
      const raw = args.incomingGoalNotes[id];
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (trimmed.length > 0) {
        mergedNotes[id] = trimmed;
      } else {
        delete mergedNotes[id];
      }
    }

    const incomingMap = args.incomingGoalMeasurements;
    if (incomingMap && typeof incomingMap === "object" && Object.prototype.hasOwnProperty.call(incomingMap, id)) {
      const normalized = normalizeGoalMeasurementEntry(
        incomingMap[id as keyof typeof incomingMap],
        undefined,
        { fallbackMetricUnit: null },
      );
      if (normalized) {
        mergedMeasPlain[id] = normalized;
      } else {
        delete mergedMeasPlain[id];
      }
    }
  }

  return {
    goalNotes: mergedNotes,
    goalMeasurements: Object.keys(mergedMeasPlain).length > 0 ? mergedMeasPlain : null,
  };
};

const normalizeGoalMeasurements = (
  rawMeasurements: Record<string, unknown> | null | undefined,
): Record<string, SessionGoalMeasurementEntry> | null => {
  if (!rawMeasurements || typeof rawMeasurements !== "object") {
    return null;
  }

  const entries = Object.entries(rawMeasurements)
    .map(([goalId, value]) => {
      if (!isValidSessionNoteGoalKey(goalId)) {
        return null;
      }
      const normalized = normalizeGoalMeasurementEntry(value, undefined, { fallbackMetricUnit: null });
      return normalized ? ([goalId, normalized] as const) : null;
    })
    .filter((entry): entry is readonly [string, SessionGoalMeasurementEntry] => Boolean(entry));

  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

const hasSuccessesBeyondOpportunities = (
  metricValue: number | null | undefined,
  opportunities: number | null | undefined,
): boolean =>
  typeof metricValue === "number" &&
  Number.isFinite(metricValue) &&
  typeof opportunities === "number" &&
  Number.isFinite(opportunities) &&
  metricValue > opportunities;

const normalizeMeasurementMetadata = (value: string | null | undefined): string =>
  value?.trim().toLowerCase() ?? "";

const isCountTrialMeasurement = (entry: SessionGoalMeasurementEntry): boolean => {
  const metadata = [
    normalizeMeasurementMetadata(entry.data.measurement_type),
    normalizeMeasurementMetadata(entry.data.metric_label),
    normalizeMeasurementMetadata(entry.data.metric_unit),
  ].filter((value) => value.length > 0);

  if (
    metadata.some((value) =>
      value.includes("percent") ||
      value.includes("%") ||
      value.includes("accuracy") ||
      value.includes("fidelity") ||
      value.includes("duration") ||
      value.includes("minute") ||
      value.includes("time") ||
      value.includes("rate") ||
      value.includes("per hour")
    )
  ) {
    return false;
  }

  return metadata.some((value) =>
    value.includes("count") ||
    value.includes("correct") ||
    value.includes("incorrect") ||
    value.includes("trial") ||
    value.includes("response") ||
    value.includes("task analysis") ||
    value.includes("taskanalysis") ||
    value.includes("occurrence")
  );
};

const validateGoalMeasurementOpportunityBounds = (
  measurements: Record<string, SessionGoalMeasurementEntry> | null,
): string | null => {
  if (!measurements) {
    return null;
  }

  for (const entry of Object.values(measurements)) {
    if (!isCountTrialMeasurement(entry)) {
      continue;
    }

    if (hasSuccessesBeyondOpportunities(entry.data.metric_value, entry.data.opportunities)) {
      return "Correct trials cannot exceed opportunities.";
    }

    for (const trial of entry.data.target_trials ?? []) {
      if (hasSuccessesBeyondOpportunities(trial.metric_value, trial.opportunities)) {
        return "Correct trials cannot exceed opportunities.";
      }
    }
  }

  return null;
};

/**
 * Keeps `goal_ids` and `goals_addressed` aligned with trimmed `goal_notes` / normalized `goal_measurements`
 * (same merge semantics as SessionModal / AddSessionNoteModal): any goal key present only in maps is
 * appended to `goal_ids`, and `goals_addressed` gains stable labels for new ids.
 */
const alignSessionNoteGoalPayload = (input: {
  goalIds: readonly string[];
  goalsAddressed: readonly string[] | undefined;
  goalNotes: Record<string, string> | null;
  goalMeasurements: Record<string, SessionGoalMeasurementEntry> | null;
}): {
  goalIds: string[];
  goalsAddressed: string[];
  goalNotes: Record<string, string> | null;
  goalMeasurements: Record<string, SessionGoalMeasurementEntry> | null;
} => {
  const notes = input.goalNotes ?? {};
  const measurements = input.goalMeasurements ?? {};
  const mergedGoalIds = mergeUniqueGoalIds(
    [...input.goalIds],
    Object.keys(notes),
    Object.keys(measurements),
  ).filter((id) => isValidSessionNoteGoalKey(id));

  const addressedById = new Map<string, string>();
  input.goalIds.forEach((rawId, index) => {
    const id = rawId.trim();
    const label = input.goalsAddressed?.[index]?.trim() ?? "";
    if (label.length > 0) {
      addressedById.set(id, label);
    }
  });

  const goalsAddressed = mergedGoalIds.map((id) => {
    const prior = addressedById.get(id);
    if (prior && prior.length > 0) {
      return prior;
    }
    if (isAdhocSessionTargetId(id)) {
      return "Session target";
    }
    return id;
  });

  const goalNotes: Record<string, string> = {};
  for (const id of mergedGoalIds) {
    const text = notes[id]?.trim() ?? "";
    if (text.length > 0) {
      goalNotes[id] = text;
    }
  }

  const goalMeasurements: Record<string, SessionGoalMeasurementEntry> = {};
  for (const id of mergedGoalIds) {
    const row = measurements[id];
    if (row) {
      goalMeasurements[id] = row;
    }
  }

  return {
    goalIds: mergedGoalIds,
    goalsAddressed,
    goalNotes: Object.keys(goalNotes).length > 0 ? goalNotes : null,
    goalMeasurements: Object.keys(goalMeasurements).length > 0 ? goalMeasurements : null,
  };
};

const mapRowToSessionNote = (row: SessionNoteRow): SessionNote => ({
  id: row.id,
  date: row.session_date,
  start_time: row.start_time,
  end_time: row.end_time,
  service_code: row.service_code,
  therapist_id: row.therapist_id,
  therapist_name: row.therapists?.full_name ?? "Unknown Therapist",
  goals_addressed: row.goals_addressed ?? [],
  goal_ids: row.goal_ids ?? [],
  goal_measurements: normalizeGoalMeasurements(row.goal_measurements),
  goal_notes: (row.goal_notes as Record<string, string> | null) ?? null,
  session_id: row.session_id,
  narrative: row.narrative,
  is_locked: row.is_locked,
  client_id: row.client_id,
  authorization_id: row.authorization_id,
  organization_id: row.organization_id,
  session_duration: row.session_duration ?? 0,
  signed_at: row.signed_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const toDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

type PostgrestErrorPayload = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isMissingGoalMeasurementsError = (payload: unknown): boolean => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const maybeError = payload as PostgrestErrorPayload;
  const code = typeof maybeError.code === "string" ? maybeError.code : "";
  if (code === "PGRST204") {
    return true;
  }
  if (code.length > 0 && code !== "42703") {
    return false;
  }
  const text = [maybeError.message, maybeError.details, maybeError.hint]
    .filter((part): part is string => typeof part === "string")
    .join(" ");

  if (code === "42703" && /goal_measurements/i.test(text)) {
    return true;
  }

  return /goal_measurements/i.test(text) && /column|does not exist|schema cache/i.test(text);
};

const isLegacyGoalIdsTypeError = (payload: unknown): boolean => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const maybeError = payload as PostgrestErrorPayload;
  const code = typeof maybeError.code === "string" ? maybeError.code : "";
  const text = [maybeError.message, maybeError.details, maybeError.hint]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  if (code === "22P02" && /uuid/i.test(text)) {
    return true;
  }
  return /goal_ids/i.test(text) && /uuid|invalid input syntax/i.test(text);
};

const buildCompatRetryWritePayload = <TPayload extends Record<string, unknown>>(
  payload: TPayload,
  upstreamErrorPayload: unknown,
): TPayload | null => {
  let nextPayload: Record<string, unknown> | null = null;

  if (
    isMissingGoalMeasurementsError(upstreamErrorPayload) &&
    Object.prototype.hasOwnProperty.call(payload, "goal_measurements")
  ) {
    nextPayload = { ...payload };
    delete nextPayload.goal_measurements;
  }

  if (
    isLegacyGoalIdsTypeError(upstreamErrorPayload) &&
    Array.isArray(payload.goal_ids)
  ) {
    const goalIds = payload.goal_ids;
    const goalsAddressed = Array.isArray(payload.goals_addressed)
      ? payload.goals_addressed
      : [];
    const narrowedGoalIds: string[] = [];
    const narrowedGoalsAddressed: string[] = [];

    for (let index = 0; index < goalIds.length; index += 1) {
      const candidate = goalIds[index];
      if (typeof candidate !== "string" || !UUID_PATTERN.test(candidate)) {
        continue;
      }
      narrowedGoalIds.push(candidate);
      const label = goalsAddressed[index];
      if (typeof label === "string") {
        narrowedGoalsAddressed.push(label);
      }
    }

    nextPayload = {
      ...(nextPayload ?? payload),
      goal_ids: narrowedGoalIds.length > 0 ? narrowedGoalIds : null,
      goals_addressed: narrowedGoalIds.length > 0 ? narrowedGoalsAddressed : [],
    };
  }

  return nextPayload ? (nextPayload as TPayload) : null;
};

const fetchExistingNote = async (
  supabaseUrl: string,
  headers: Record<string, string>,
  organizationId: string,
  options: { noteId?: string; sessionId?: string | null },
): Promise<{ id: string; is_locked: boolean } | null> => {
  if (options.noteId) {
    const url =
      `${supabaseUrl}/rest/v1/client_session_notes?select=id,is_locked` +
      `&organization_id=eq.${encodeURIComponent(organizationId)}` +
      `&id=eq.${encodeURIComponent(options.noteId)}&limit=1`;
    const result = await fetchJson<Array<{ id: string; is_locked: boolean }>>(url, {
      method: "GET",
      headers,
    });
    return result.ok && result.data && result.data.length > 0 ? result.data[0] : null;
  }

  if (options.sessionId) {
    const url =
      `${supabaseUrl}/rest/v1/client_session_notes?select=id,is_locked` +
      `&organization_id=eq.${encodeURIComponent(organizationId)}` +
      `&session_id=eq.${encodeURIComponent(options.sessionId)}&limit=1`;
    const result = await fetchJson<Array<{ id: string; is_locked: boolean }>>(url, {
      method: "GET",
      headers,
    });
    return result.ok && result.data && result.data.length > 0 ? result.data[0] : null;
  }

  return null;
};

const fetchSessionNoteById = async (
  supabaseUrl: string,
  headers: Record<string, string>,
  organizationId: string,
  noteId: string,
): Promise<SessionNoteRow | null> => {
  const url =
    `${supabaseUrl}/rest/v1/client_session_notes?select=${encodeURIComponent(selectColumns)}` +
    `&organization_id=eq.${encodeURIComponent(organizationId)}` +
    `&id=eq.${encodeURIComponent(noteId)}&limit=1`;
  const result = await fetchJson<unknown>(url, { method: "GET", headers });
  if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
    return result.data[0] as SessionNoteRow;
  }

  if (!result.ok && isMissingGoalMeasurementsError(result.data)) {
    const fallbackUrl =
      `${supabaseUrl}/rest/v1/client_session_notes?select=${encodeURIComponent(fallbackSelectColumns)}` +
      `&organization_id=eq.${encodeURIComponent(organizationId)}` +
      `&id=eq.${encodeURIComponent(noteId)}&limit=1`;
    const fallback = await fetchJson<unknown>(fallbackUrl, { method: "GET", headers });
    if (fallback.ok && Array.isArray(fallback.data) && fallback.data.length > 0) {
      const rowWithoutGoalMeasurements = fallback.data[0] as Omit<SessionNoteRow, "goal_measurements">;
      return {
        ...rowWithoutGoalMeasurements,
        goal_measurements: null,
      };
    }
  }

  return null;
};

const validateTrialEventMeasurementPayload = (
  measurementType: string,
  event: SessionCaptureTrialEventInput,
): string | null => {
  if (responseRequiredMeasurementTypes.has(measurementType)) {
    if (!event.response) {
      return "response is required for this target measurement type";
    }
    if (typeof event.value === "number") {
      return "value is not allowed for this target measurement type";
    }
    return null;
  }

  if (valueRequiredMeasurementTypes.has(measurementType)) {
    if (typeof event.value !== "number") {
      return "value is required for this target measurement type";
    }
    if (event.response) {
      return "response is not allowed for this target measurement type";
    }
  }

  return null;
};

const buildSessionTrialEventRows = async (args: {
  request: Request;
  supabaseUrl: string;
  headers: Record<string, string>;
  organizationId: string;
  accessToken: string;
  clientId: string;
  sessionId: string | null | undefined;
  therapistId: string;
  actorUserId: string;
  goalIds: readonly string[];
  captureMergeGoalIds: readonly string[];
  trialEvents: readonly SessionCaptureTrialEventInput[];
}): Promise<{ rows: Array<Record<string, unknown>>; response: Response | null }> => {
  if (args.trialEvents.length === 0) {
    return { rows: [], response: null };
  }

  if (!args.sessionId) {
    return {
      rows: [],
      response: errorResponse(args.request, "validation_error", "sessionId is required when saving trial events."),
    };
  }

  const sessionUrl =
    `${args.supabaseUrl}/rest/v1/sessions?select=id,organization_id,client_id,therapist_id` +
    `&id=eq.${encodeURIComponent(args.sessionId)}` +
    `&organization_id=eq.${encodeURIComponent(args.organizationId)}&limit=1`;
  const sessionResult = await fetchJson<SessionScope[]>(sessionUrl, {
    method: "GET",
    headers: args.headers,
  });
  if (!sessionResult.ok) {
    return {
      rows: [],
      response: errorResponse(args.request, "upstream_error", "Unable to validate trial-event session access", {
        status: sessionResult.status || 502,
      }),
    };
  }
  const session = Array.isArray(sessionResult.data) ? sessionResult.data[0] ?? null : null;
  if (!session) {
    return {
      rows: [],
      response: errorResponse(args.request, "forbidden", "sessionId is not in scope for this organization.", { status: 403 }),
    };
  }
  if (session.client_id !== args.clientId) {
    return {
      rows: [],
      response: errorResponse(args.request, "validation_error", "Session does not match the selected client."),
    };
  }
  if (session.therapist_id !== args.therapistId) {
    return {
      rows: [],
      response: errorResponse(args.request, "validation_error", "Session does not match the selected therapist."),
    };
  }

  const canCapture = await currentUserCanCaptureTrialEvent(args.accessToken, args.organizationId, session.client_id);
  if (canCapture.upstreamError) {
    return {
      rows: [],
      response: errorResponse(args.request, "upstream_error", "Unable to validate trial-event capture access", {
        status: 502,
      }),
    };
  }
  if (!canCapture.allowed) {
    return {
      rows: [],
      response: errorResponse(args.request, "forbidden", "Forbidden", { status: 403 }),
    };
  }

  const targetIds = Array.from(new Set(args.trialEvents.map((event) => event.target_id)));
  const targetFilter = targetIds.map((id) => encodeURIComponent(id)).join(",");
  const targetUrl =
    `${args.supabaseUrl}/rest/v1/goal_targets?select=id,organization_id,client_id,goal_id,measurement_type` +
    `&id=in.(${targetFilter})` +
    `&organization_id=eq.${encodeURIComponent(args.organizationId)}`;
  const targetResult = await fetchJson<GoalTargetScope[]>(targetUrl, {
    method: "GET",
    headers: args.headers,
  });
  if (!targetResult.ok) {
    return {
      rows: [],
      response: errorResponse(args.request, "upstream_error", "Unable to validate trial-event target access", {
        status: targetResult.status || 502,
      }),
    };
  }

  const targetsById = new Map(
    (Array.isArray(targetResult.data) ? targetResult.data : []).map((target) => [target.id, target]),
  );
  const submittedGoalIds = new Set(args.goalIds.filter((id) => id.trim().length > 0));
  const scopedCaptureGoalIds = new Set(args.captureMergeGoalIds.filter((id) => id.trim().length > 0));
  const allowedRawTrialGoalIds = scopedCaptureGoalIds.size > 0 ? scopedCaptureGoalIds : submittedGoalIds;
  for (const event of args.trialEvents) {
    const target = targetsById.get(event.target_id);
    if (!target) {
      return {
        rows: [],
        response: errorResponse(args.request, "forbidden", "target_id is not in scope for this organization.", { status: 403 }),
      };
    }
    if (target.client_id !== args.clientId || target.client_id !== session.client_id) {
      return {
        rows: [],
        response: errorResponse(args.request, "validation_error", "Trial-event target does not match the selected client."),
      };
    }
    if (!allowedRawTrialGoalIds.has(target.goal_id)) {
      return {
        rows: [],
        response: errorResponse(args.request, "validation_error", "Trial-event target is outside the saved goal scope."),
      };
    }
    const measurementPayloadError = validateTrialEventMeasurementPayload(target.measurement_type, event);
    if (measurementPayloadError) {
      return {
        rows: [],
        response: errorResponse(args.request, "validation_error", measurementPayloadError),
      };
    }
  }

  const now = new Date().toISOString();
  const rows = args.trialEvents.map((event) => {
    const target = targetsById.get(event.target_id);
    return {
      organization_id: args.organizationId,
      client_id: session.client_id,
      session_id: session.id,
      target_id: event.target_id,
      goal_id: target?.goal_id ?? null,
      therapist_id: session.therapist_id,
      trial_number: event.trial_number,
      response: event.response ?? null,
      prompt_type: event.prompt_type ?? null,
      prompt_level: event.prompt_level ?? null,
      value: typeof event.value === "number" ? event.value : null,
      event_timestamp: event.timestamp ?? now,
      metadata: {
        ...(event.metadata ?? {}),
        ...(Number.isInteger(event.expected_progression_version) && (event.expected_progression_version ?? -1) >= 0
          ? { progression_version_at_capture: event.expected_progression_version }
          : {}),
      },
      created_by: args.actorUserId,
    };
  });

  return { rows, response: null };
};

const writeSessionTrialEventRows = async (args: {
  request: Request;
  supabaseUrl: string;
  headers: Record<string, string>;
  rows: readonly Record<string, unknown>[];
}): Promise<Response | null> => {
  if (args.rows.length === 0) {
    return null;
  }

  const writeResult = await fetchJson(`${args.supabaseUrl}/rest/v1/trial_events`, {
    method: "POST",
    headers: { ...args.headers, Prefer: "return=minimal" },
    body: JSON.stringify(args.rows),
  });
  if (!writeResult.ok) {
    return errorResponse(args.request, "upstream_error", "Unable to save trial events", {
      status: writeResult.status || 502,
    });
  }

  return null;
};

const trialEventRowKey = (row: { target_id: unknown; trial_number: unknown }): string =>
  `${String(row.target_id ?? "")}:${String(row.trial_number ?? "")}`;

const findDuplicateTrialEventRowKey = (rows: readonly Record<string, unknown>[]): string | null => {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = trialEventRowKey(row);
    if (seen.has(key)) {
      return key;
    }
    seen.add(key);
  }
  return null;
};

const fetchExistingSessionTrialEventKeys = async (args: {
  request: Request;
  supabaseUrl: string;
  headers: Record<string, string>;
  organizationId: string;
  rows: readonly Record<string, unknown>[];
}): Promise<{ keys: Set<string>; response: Response | null }> => {
  if (args.rows.length === 0) {
    return { keys: new Set(), response: null };
  }

  const sessionId = String(args.rows[0]?.session_id ?? "");
  const targetIds = Array.from(new Set(args.rows.map((row) => String(row.target_id ?? "")).filter(Boolean)));
  const trialNumbers = Array.from(new Set(args.rows.map((row) => Number(row.trial_number)).filter(Number.isFinite)));
  if (!sessionId || targetIds.length === 0 || trialNumbers.length === 0) {
    return { keys: new Set(), response: null };
  }

  const result = await fetchJson<Array<{ target_id: string; trial_number: number }>>(
    `${args.supabaseUrl}/rest/v1/trial_events?select=target_id,trial_number` +
      `&organization_id=eq.${encodeURIComponent(args.organizationId)}` +
      `&session_id=eq.${encodeURIComponent(sessionId)}` +
      `&target_id=in.(${targetIds.map(encodeURIComponent).join(",")})` +
      `&trial_number=in.(${trialNumbers.map((value) => encodeURIComponent(String(value))).join(",")})`,
    {
      method: "GET",
      headers: args.headers,
    },
  );
  if (!result.ok) {
    return {
      keys: new Set(),
      response: errorResponse(args.request, "upstream_error", "Unable to validate existing trial events", {
        status: result.status || 502,
      }),
    };
  }

  return {
    keys: new Set((result.data ?? []).map((row) => trialEventRowKey(row))),
    response: null,
  };
};

const rollbackSessionTrialEventRows = async (args: {
  supabaseUrl: string;
  headers: Record<string, string>;
  organizationId: string;
  rows: readonly Record<string, unknown>[];
}): Promise<void> => {
  if (args.rows.length === 0) {
    return;
  }

  const sessionId = String(args.rows[0]?.session_id ?? "");
  if (!sessionId) {
    return;
  }

  const predicates = args.rows
    .map((row) => {
      const targetId = String(row.target_id ?? "");
      const trialNumber = Number(row.trial_number);
      if (!targetId || !Number.isFinite(trialNumber)) {
        return null;
      }
      return `and(target_id.eq.${encodeURIComponent(targetId)},trial_number.eq.${encodeURIComponent(String(trialNumber))})`;
    })
    .filter((predicate): predicate is string => Boolean(predicate));

  if (predicates.length === 0) {
    return;
  }

  await fetchJson(
    `${args.supabaseUrl}/rest/v1/trial_events` +
      `?organization_id=eq.${encodeURIComponent(args.organizationId)}` +
      `&session_id=eq.${encodeURIComponent(sessionId)}` +
      `&or=(${predicates.join(",")})`,
    {
      method: "DELETE",
      headers: { ...args.headers, Prefer: "return=minimal" },
    },
  );
};

export async function sessionNotesUpsertHandler(request: Request): Promise<Response> {
  if (isDisallowedOriginRequest(request)) {
    return errorResponse(request, "forbidden", "Origin not allowed", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersForRequest(request) });
  }

  if (request.method !== "POST") {
    return errorResponse(request, "validation_error", "Method not allowed", { status: 405 });
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return errorResponse(request, "unauthorized", "Missing authorization token", {
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  const { organizationId, isTherapist, isAdmin, isOrgMember, isSuperAdmin, upstreamError: roleUpstreamError } =
    await resolveOrgAndRoleWithStatus(accessToken);
  if (roleUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate organization access", { status: 502 });
  }
  if (!organizationId || (!isTherapist && !isAdmin && !isSuperAdmin && !isOrgMember)) {
    return errorResponse(request, "forbidden", "Forbidden");
  }

  const { userId: actorUserId, upstreamError: actorUpstreamError } = await fetchAuthenticatedUserIdWithStatus(accessToken);
  if (actorUpstreamError) {
    return errorResponse(request, "upstream_error", "Unable to validate authenticated user", { status: 502 });
  }
  if (!actorUserId) {
    return errorResponse(request, "forbidden", "Forbidden");
  }

  let payload: z.infer<typeof upsertSchema>;
  try {
    const body = await request.json();
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(request, "validation_error", "Invalid request body");
    }
    payload = parsed.data;
  } catch {
    return errorResponse(request, "validation_error", "Invalid JSON body");
  }

  const sessionDuration = calculateSessionDurationMinutes(payload.startTime, payload.endTime);
  if (sessionDuration <= 0) {
    return errorResponse(request, "validation_error", "End time must be later than start time.");
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  const billingPolicy = await resolveSessionCaptureStrictBillingPolicy(accessToken, organizationId);
  if (billingPolicy.upstreamError) {
    return errorResponse(request, "upstream_error", "Unable to resolve session capture policy", { status: 502 });
  }
  const captureBillingRelaxed = !billingPolicy.strict;

  const authorizationUrl =
    `${supabaseUrl}/rest/v1/authorizations?select=` +
    encodeURIComponent(
      "id,organization_id,client_id,status,start_date,end_date,services:authorization_services(service_code,approved_units)",
    ) +
    `&id=eq.${encodeURIComponent(payload.authorizationId)}&limit=1`;
  const authorizationResult = await fetchJson<Array<{
    id: string;
    organization_id: string;
    client_id: string;
    status: string;
    start_date: string;
    end_date: string;
    services: Array<{ service_code: string; approved_units: number | null }> | null;
  }>>(authorizationUrl, { method: "GET", headers });

  if (!authorizationResult.ok || !authorizationResult.data || authorizationResult.data.length === 0) {
    return errorResponse(request, "not_found", "Authorization not found");
  }

  const authorization = authorizationResult.data[0];
  if (authorization.organization_id !== organizationId) {
    return errorResponse(request, "forbidden", "Authorization does not belong to the active organization.");
  }
  if (authorization.client_id !== payload.clientId) {
    return errorResponse(request, "validation_error", "Client does not match the selected authorization.");
  }

  if (!captureBillingRelaxed) {
    if (authorization.status !== "approved") {
      return errorResponse(request, "validation_error", "Authorization must be approved before saving session notes.");
    }

    const sessionDateStrict = toDate(payload.sessionDate);
    if (
      sessionDateStrict < toDate(authorization.start_date) ||
      sessionDateStrict > toDate(authorization.end_date)
    ) {
      return errorResponse(request, "validation_error", "Session date must be within the authorization date range.");
    }

    const hasAuthorizedServiceStrict = (authorization.services ?? []).some(
      (service) => service.service_code === payload.serviceCode,
    );
    if (!hasAuthorizedServiceStrict) {
      return errorResponse(request, "validation_error", "Selected service code is not part of this authorization.");
    }
  }

  const services = authorization.services ?? [];
  const hasAuthorizedService = services.some((service) => service.service_code === payload.serviceCode);
  const firstListedServiceCode =
    services.map((service) => service.service_code?.trim()).find((code): code is string => Boolean(code)) ?? "";
  const effectiveServiceCode =
    captureBillingRelaxed && !hasAuthorizedService
      ? firstListedServiceCode || "UNSPECIFIED"
      : payload.serviceCode;

  const existingNote = await fetchExistingNote(supabaseUrl, headers, organizationId, {
    noteId: payload.noteId,
    sessionId: payload.noteId ? null : payload.sessionId,
  });

  if (payload.noteId && !existingNote) {
    return errorResponse(request, "not_found", "Session note not found.");
  }

  if (existingNote?.is_locked && !payload.isLocked) {
    return errorResponse(request, "conflict", "Session note is locked and cannot be edited.", { status: 409 });
  }

  const mergeGoalIds = payload.captureMergeGoalIds ?? [];
  const shouldMergeScopedCapture = Boolean(existingNote) && mergeGoalIds.length > 0;

  let goalNotesForNormalize = payload.goalNotes;
  let goalMeasurementsForNormalize: Record<string, unknown> | null | undefined = payload.goalMeasurements ?? null;

  if (shouldMergeScopedCapture && existingNote) {
    const existingRowFull = await fetchSessionNoteById(supabaseUrl, headers, organizationId, existingNote.id);
    if (!existingRowFull) {
      return errorResponse(request, "upstream_error", "Unable to load existing session note for merge", {
        status: 502,
      });
    }
    const merged = mergeScopedGoalCaptureFromExisting({
      captureMergeGoalIds: mergeGoalIds,
      existingRow: existingRowFull,
      incomingGoalNotes: payload.goalNotes,
      incomingGoalMeasurements: payload.goalMeasurements ?? null,
    });
    goalNotesForNormalize = merged.goalNotes;
    goalMeasurementsForNormalize = merged.goalMeasurements;
  }

  const normalizedGoalNotes = trimGoalNotes(goalNotesForNormalize);
  const normalizedGoalMeasurements = normalizeGoalMeasurements(goalMeasurementsForNormalize ?? null);
  const measurementBoundsError = validateGoalMeasurementOpportunityBounds(normalizedGoalMeasurements);
  if (measurementBoundsError) {
    return errorResponse(request, "validation_error", measurementBoundsError);
  }

  const alignedGoals = alignSessionNoteGoalPayload({
    goalIds: payload.goalIds,
    goalsAddressed: payload.goalsAddressed,
    goalNotes: normalizedGoalNotes,
    goalMeasurements: normalizedGoalMeasurements,
  });

  const trialEventBuild = await buildSessionTrialEventRows({
    request,
    supabaseUrl,
    headers,
    organizationId,
    accessToken,
    clientId: payload.clientId,
    sessionId: payload.sessionId,
    therapistId: payload.therapistId,
    actorUserId,
    goalIds: alignedGoals.goalIds,
    captureMergeGoalIds: mergeGoalIds,
    trialEvents: payload.trialEvents,
  });
  if (trialEventBuild.response) {
    return trialEventBuild.response;
  }
  const duplicateTrialEventRowKey = findDuplicateTrialEventRowKey(trialEventBuild.rows);
  if (duplicateTrialEventRowKey) {
    return errorResponse(request, "conflict", "Duplicate trial event submitted for this session target and trial number.", {
      status: 409,
    });
  }

  const writePayload = {
    authorization_id: payload.authorizationId,
    client_id: payload.clientId,
    therapist_id: payload.therapistId,
    organization_id: organizationId,
    service_code: effectiveServiceCode,
    session_date: payload.sessionDate,
    start_time: payload.startTime,
    end_time: payload.endTime,
    session_duration: sessionDuration,
    goals_addressed: alignedGoals.goalsAddressed,
    goal_ids: alignedGoals.goalIds.length > 0 ? alignedGoals.goalIds : null,
    goal_measurements: alignedGoals.goalMeasurements,
    goal_notes: alignedGoals.goalNotes,
    narrative: payload.narrative.trim(),
    is_locked: payload.isLocked,
    signed_at: payload.isLocked ? new Date().toISOString() : null,
    session_id: payload.sessionId ?? null,
  };

  let persistedTrialVersionEvents: Array<{ target_id: string; expected_progression_version?: number }> = [];
  if (payload.isLocked && !existingNote?.is_locked && payload.sessionId) {
    const persistedVersions = await loadPersistedTrialTargetVersions({
      supabaseUrl, headers, organizationId, sessionId: payload.sessionId,
    });
    if (persistedVersions.upstreamError) {
      return errorResponse(request, "upstream_error", "Unable to validate persisted trial target versions", { status: 502 });
    }
    persistedTrialVersionEvents = persistedVersions.events;
  }
  const expectedTargetVersions = validateFinalizationTargetVersions([
    ...payload.trialEvents,
    ...persistedTrialVersionEvents,
  ]);
  if (payload.isLocked && !existingNote?.is_locked && expectedTargetVersions === null) {
    return errorResponse(request, "validation_error", "A current target version is required to finalize trial data.");
  }

  if (payload.isLocked) {
    if (!payload.sessionId) {
      return errorResponse(request, "validation_error", "A session is required to finalize a session note.");
    }

    // Scope and actor fields are intentionally absent. The SECURITY DEFINER RPC
    // derives them from auth.uid() and the persisted session/target records.
    const finalizationResult = await fetchJson<Array<{
      note: SessionNoteRow;
      progression_results: GoalTargetProgressionResult[];
    }>>(`${supabaseUrl}/rest/v1/rpc/finalize_session_note_with_progression`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        target_session_id: payload.sessionId,
        target_note_id: existingNote?.id ?? payload.noteId ?? null,
        note_payload: {
          authorization_id: payload.authorizationId,
          requested_service_code: payload.serviceCode,
          goals_addressed: alignedGoals.goalsAddressed,
          goal_ids: alignedGoals.goalIds.length > 0 ? alignedGoals.goalIds : null,
          goal_measurements: alignedGoals.goalMeasurements,
          goal_notes: alignedGoals.goalNotes,
          narrative: payload.narrative.trim(),
        },
        trial_events: trialEventBuild.rows.map(({ organization_id: _organizationId, client_id: _clientId,
          goal_id: _goalId, therapist_id: _therapistId, created_by: _createdBy, updated_by: _updatedBy, ...event }) => event),
        expected_target_versions: expectedTargetVersions ?? [],
      }),
    });

    if (!finalizationResult.ok || !finalizationResult.data?.[0]) {
      const serializedErrorOriginal = JSON.stringify(finalizationResult.data ?? {});
      const serializedError = serializedErrorOriginal.toLowerCase();
      if (finalizationResult.status === 409 || serializedError.includes("stale_target") || serializedError.includes("no longer current")) {
        const conflictMatch = serializedErrorOriginal.match(/stale_target:\s*([^|"}]+)\|([^|"}]*)\|([^|"}]*)\|([^"}]*)/i);
        return jsonForRequest(request, {
          error: "conflict",
          message: "The selected target is no longer current.",
          conflict: conflictMatch ? {
            stale_target_id: conflictMatch[1],
            current_target_id: conflictMatch[2],
            current_target_name: conflictMatch[3],
            current_phase: conflictMatch[4],
          } : undefined,
        }, 409);
      }
      if (finalizationResult.status === 400 || serializedError.includes("22023")) {
        return errorResponse(request, "validation_error", "Unable to finalize session note.", { status: 400 });
      }
      if (finalizationResult.status === 401 || finalizationResult.status === 403 || serializedError.includes("42501")) {
        return errorResponse(request, "forbidden", "Forbidden", { status: 403 });
      }
      return errorResponse(request, "upstream_error", "Unable to finalize session note", {
        status: finalizationResult.status >= 500 ? finalizationResult.status : 502,
      });
    }

    const finalized = finalizationResult.data[0];
    const progressionResults = finalized.progression_results ?? [];
    return jsonForRequest(request, {
      ...mapRowToSessionNote(finalized.note),
      progression_results: progressionResults,
      progression_warnings: progressionResults
        .map((result) => result.warning)
        .filter((warning): warning is string => Boolean(warning)),
    });
  }
  const existingTrialEventKeyBuild = await fetchExistingSessionTrialEventKeys({
    request,
    supabaseUrl,
    headers,
    organizationId,
    rows: trialEventBuild.rows,
  });
  if (existingTrialEventKeyBuild.response) {
    return existingTrialEventKeyBuild.response;
  }
  if (existingTrialEventKeyBuild.keys.size > 0) {
    return errorResponse(request, "conflict", "Trial event already exists for this session target and trial number.", {
      status: 409,
    });
  }
  const rollbackHeaders = trialEventBuild.rows.length > 0 ? buildServiceRoleHeaders() : null;
  if (trialEventBuild.rows.length > 0 && !rollbackHeaders) {
    return errorResponse(request, "upstream_error", "Trial event rollback is not configured", { status: 500 });
  }

  const trialEventError = await writeSessionTrialEventRows({
    request,
    supabaseUrl,
    headers,
    rows: trialEventBuild.rows,
  });
  if (trialEventError) {
    return trialEventError;
  }

  let noteId = existingNote?.id ?? null;
  if (!noteId) {
    let insertBody: Record<string, unknown> = {
      ...writePayload,
      created_by: actorUserId,
    };
    let insertResult = await fetchJson<Array<{ id: string }>>(
      `${supabaseUrl}/rest/v1/client_session_notes`,
      {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(insertBody),
      },
    );
    if (!insertResult.ok) {
      const retryBody = buildCompatRetryWritePayload(insertBody, insertResult.data);
      if (retryBody) {
        insertBody = retryBody;
        insertResult = await fetchJson<Array<{ id: string }>>(
          `${supabaseUrl}/rest/v1/client_session_notes`,
          {
            method: "POST",
            headers: { ...headers, Prefer: "return=representation" },
            body: JSON.stringify(insertBody),
          },
        );
      }
    }
    if (!insertResult.ok || !insertResult.data || insertResult.data.length === 0) {
      await rollbackSessionTrialEventRows({
        supabaseUrl,
        headers: rollbackHeaders ?? headers,
        organizationId,
        rows: trialEventBuild.rows,
      });
      return errorResponse(request, "upstream_error", "Unable to create session note", {
        status: insertResult.status || 502,
      });
    }
    noteId = insertResult.data[0].id;
  } else {
    const updateUrl =
      `${supabaseUrl}/rest/v1/client_session_notes?id=eq.${encodeURIComponent(noteId)}` +
      `&organization_id=eq.${encodeURIComponent(organizationId)}`;
    let updateBody: Record<string, unknown> = writePayload;
    let updateResult = await fetchJson<Array<{ id: string }>>(updateUrl, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(updateBody),
    });
    if (!updateResult.ok) {
      const retryBody = buildCompatRetryWritePayload(updateBody, updateResult.data);
      if (retryBody) {
        updateBody = retryBody;
        updateResult = await fetchJson<Array<{ id: string }>>(updateUrl, {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify(updateBody),
        });
      }
    }
    if (!updateResult.ok || !updateResult.data || updateResult.data.length === 0) {
      await rollbackSessionTrialEventRows({
        supabaseUrl,
        headers: rollbackHeaders ?? headers,
        organizationId,
        rows: trialEventBuild.rows,
      });
      return errorResponse(request, "upstream_error", "Unable to update session note", {
        status: updateResult.status || 502,
      });
    }
  }

  const savedRow = await fetchSessionNoteById(supabaseUrl, headers, organizationId, noteId);
  if (!savedRow) {
    await rollbackSessionTrialEventRows({
      supabaseUrl,
      headers: rollbackHeaders ?? headers,
      organizationId,
      rows: trialEventBuild.rows,
    });
    return errorResponse(request, "upstream_error", "Unable to load saved session note", { status: 502 });
  }

  return jsonForRequest(request, mapRowToSessionNote(savedRow));
}
