import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2, Pencil, Plus, Trash2, UploadCloud, X } from "lucide-react";
import type { Client, Goal, GoalDomain, GoalTarget, Program, ProgramNote, TargetMeasurementType, TrialEvent } from "../../types";
import { callApi, callEdgeFunctionHttp } from "../../lib/api";
import { showError, showInfo, showSuccess } from "../../lib/toast";
import { useActiveOrganizationId } from "../../lib/organization";
import { useAuth } from "../../lib/authContext";
import {
  registerAssessmentDocument,
  type AssessmentDocumentRecord,
  type AssessmentTemplateType,
} from "../../lib/assessment-documents";
import { supabase } from "../../lib/supabase";
import { IehpFbaLayoutReview } from "./IehpFbaLayoutReview";
import {
  EMPTY_ASSESSMENT_DOCUMENTS,
  EMPTY_ASSESSMENT_DRAFTS,
  EMPTY_CHECKLIST_RESPONSE,
  ENABLE_CHECKLIST_MAPPING_UI,
  ENABLE_PROGRAMS_GOALS_AI_PROPOSALS,
  TARGET_MEASUREMENT_TYPE_LABELS,
  TARGET_MEASUREMENT_TYPES,
  buildTargetsByGoalId,
  formatGoalTimelineCriteria,
  parseApiErrorMessage,
  parseGoalTimelineCriteria,
  parseJson,
  parseObjectiveDataPointsInput,
  statusToneByAssessment,
  TEMPLATE_LABELS,
  type AssessmentChecklistItem,
  type AssessmentChecklistResponse,
  type AssessmentStructuredSection,
  type AssessmentDraftGoal,
  type AssessmentDraftProgram,
  type AssessmentDraftResponse,
  type AssessmentPlanPdfResponse,
  type GoalTimelineFields,
} from "./ProgramsGoalsTab.helpers";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_ASSESSMENT_FILE_EXTENSIONS = [".pdf", ".docx"] as const;
const PROGRAMS_REQUEST_TIMEOUT_MS = 12_000;
const GOALS_REQUEST_TIMEOUT_MS = 12_000;
const PROGRAM_NOTES_REQUEST_TIMEOUT_MS = 12_000;
const PROGRAM_CREATE_REQUEST_TIMEOUT_MS = 12_000;
const GOAL_CREATE_REQUEST_TIMEOUT_MS = 12_000;
const PROGRAM_NOTE_CREATE_REQUEST_TIMEOUT_MS = 12_000;
const TAB_QUERY_STALE_TIME_MS = 30_000;
const ASSESSMENT_DOCUMENT_POLL_INTERVAL_MS = 3_000;
const ACTIVE_ASSESSMENT_POLL_STATUSES: ReadonlySet<AssessmentDocumentRecord["status"]> = new Set([
  "uploaded",
  "extracting",
  "extraction_running",
]);
const TRIAL_EVENT_GRAPH_POINT_LIMIT = 6;
const TRIAL_EVENTS_REQUEST_TIMEOUT_MS = 8_000;
const CREATE_NEW_DOMAIN_VALUE = "__create_new_domain__";

const detectAssessmentTemplateTypeFromFileName = (fileName: string): AssessmentTemplateType | null => {
  const normalized = fileName.toLowerCase();
  const hasIehp = /(?:^|[^a-z0-9])iehp(?:[^a-z0-9]|$)/.test(normalized);
  const hasCalOptima = /(?:^|[^a-z0-9])caloptima(?:[^a-z0-9]|$)/.test(normalized);
  const hasFba = /(?:^|[^a-z0-9])fba(?:[^a-z0-9]|$)/.test(normalized);
  if (hasIehp && hasFba) return "iehp_fba";
  if (hasCalOptima && hasFba) return "caloptima_fba";
  return null;
};

const buildAssessmentTemplateMismatchError = (detectedTemplateType: AssessmentTemplateType): Error =>
  new Error(
    `The selected file appears to be ${TEMPLATE_LABELS[detectedTemplateType]}. Select ${TEMPLATE_LABELS[detectedTemplateType]} before uploading.`,
  );

const isStructuredChildGoalSection = (section: AssessmentStructuredSection): boolean =>
  section.field_key === "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS" ||
  section.field_key === "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS" ||
  section.payload?.goal_type === "child";

const isStructuredParentGoalSection = (section: AssessmentStructuredSection): boolean =>
  section.field_key === "CALOPTIMA_FBA_PARENT_GOALS" || section.payload?.goal_type === "parent";

const STRUCTURED_SECTION_LABELS: Record<string, string> = {
  CALOPTIMA_FBA_LIVING_ARRANGEMENTS: "Living arrangements",
  CALOPTIMA_FBA_SIGNIFICANT_MEDICAL_HISTORY: "Significant medical history",
  CALOPTIMA_FBA_FUNCTIONAL_COMMUNICATION_SKILLS: "Functional communication skills",
  CALOPTIMA_FBA_SELF_CARE_ADL_SKILLS: "Self-care and daily living skills",
  CALOPTIMA_FBA_SOCIAL_PLAY_SKILLS: "Social and play skills",
  CALOPTIMA_FBA_MOBILITY_FUNCTIONING_RESTRICTIONS: "Mobility functioning and restrictions",
  CALOPTIMA_FBA_IEP_SERVICES_TABLE: "IEP/equivalent services",
  CALOPTIMA_FBA_MEDIATOR_ANALYSIS: "Mediator analysis",
  CALOPTIMA_FBA_REINFORCER_ASSESSMENT: "Reinforcer assessment",
  CALOPTIMA_FBA_GENERALIZATION_MAINTENANCE_PLAN: "Generalization and maintenance plan",
  CALOPTIMA_FBA_TRANSITION_PLAN: "Transition and exit criteria",
  CALOPTIMA_FBA_CRISIS_PLAN: "Crisis plan",
  CALOPTIMA_FBA_SUMMARY_RECOMMENDATIONS: "Summary and recommendations",
  CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS: "HCPCS recommendation rows",
  CALOPTIMA_FBA_SIGNATURES: "Signatures",
  IEHP_FBA_SIGNATURE_BLOCK: "Signature block",
};

const humanizeStructuredSectionLabel = (section: AssessmentStructuredSection): string =>
  STRUCTURED_SECTION_LABELS[section.field_key] ??
  section.field_key
    .replace(/^(CALOPTIMA|IEHP)_FBA_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatPayloadValue = (value: unknown): string => {
  if (value == null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const IEHP_REQUIRED_PAYLOAD_FIELDS: Record<string, string[]> = {
  IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES: ["measure_name", "date_administered", "interviewer", "respondent"],
  IEHP_FBA_SIGNATURE_BLOCK: ["completed_by", "report_completed_date", "credentials", "agency"],
};
const IEHP_OPTIONAL_FINAL_OUTPUT_KEYS = new Set([
  "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
  "IEHP_FBA_ASSESSOR_PHONE",
  "IEHP_FBA_REFERRING_PROVIDER",
]);
const IEHP_REQUIRED_GOAL_FIELDS = [
  "program_name",
  "target_criteria",
  "baseline_data",
  "mastery_criteria",
  "measurement_type",
];
const IEHP_GOAL_SECTION_KEYS = new Set([
  "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS",
  "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
]);
const IEHP_STRUCTURED_METADATA_KEYS = new Set([
  "field_key",
  "label",
  "page_number",
  "section_key",
  "field_type",
  "mode",
  "required",
  "source",
  "layout_json",
  "template_placeholder",
  "entered_value_present",
]);

const isBlankTransferredValue = (value: unknown): boolean => {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
};

const hasNonBlankPayloadValue = (payload: Record<string, unknown>, key: string): boolean =>
  !isBlankTransferredValue(payload[key]);

const hasMeaningfulRawText = (payload: Record<string, unknown>): boolean =>
  typeof payload.raw_text === "string" && payload.raw_text.trim().length > 0;

const hasMeaningfulAdaptiveBlocks = (payload: Record<string, unknown>): boolean => {
  const blocks = Array.isArray(payload.assessment_blocks) ? payload.assessment_blocks : [];
  return blocks.some((block) => {
    const record = block && typeof block === "object" ? block as Record<string, unknown> : {};
    return (
      typeof record.raw_text === "string" &&
      record.raw_text.trim().length > 0 &&
      record.manual_review_required !== true
    );
  });
};

const responseGraphScores: Record<NonNullable<TrialEvent["response"]>, number> = {
  correct: 1,
  independent: 1,
  prompted: 0.5,
  incorrect: 0,
  noResponse: 0,
  notObserved: 0,
};

const formatTrialEventValue = (event: TrialEvent): string => {
  if (typeof event.value === "number") {
    return Number.isInteger(event.value) ? String(event.value) : event.value.toFixed(2);
  }
  return event.response ? event.response.replace(/([A-Z])/g, " $1").toLowerCase() : "not scored";
};

const trialEventGraphScore = (event: TrialEvent): number => {
  if (typeof event.value === "number") {
    return event.value;
  }
  return event.response ? responseGraphScores[event.response] ?? 0 : 0;
};

const sortTrialEvents = (events: TrialEvent[]): TrialEvent[] =>
  [...events].sort((left, right) => {
    const timestampComparison = left.event_timestamp.localeCompare(right.event_timestamp);
    return timestampComparison === 0 ? left.trial_number - right.trial_number : timestampComparison;
  });

const latestTrialEventsForGraph = (events: TrialEvent[]): TrialEvent[] =>
  events.slice(Math.max(0, events.length - TRIAL_EVENT_GRAPH_POINT_LIMIT));

const formatReadableToken = (value: string): string =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatGoalSource = (source: Goal["source"]): string =>
  source === "fba_extraction" ? "FBA extraction" : source ? formatReadableToken(source) : "Source not set";

const formatGoalClinicalType = (goal: Goal): string => {
  if (goal.clinical_goal_type === "behavior") return "Behavior";
  if (goal.clinical_goal_type === "skill") return "Skill";
  return "Unspecified";
};

const buildGoalDomainLookup = (domains: GoalDomain[]): Record<string, GoalDomain> =>
  domains.reduce<Record<string, GoalDomain>>((lookup, domain) => {
    lookup[domain.id] = domain;
    return lookup;
  }, {});

const formatDomainLabel = (
  domainId: string | null | undefined,
  domainsById: Record<string, GoalDomain>,
): string => {
  const normalizedDomainId = domainId?.trim();
  if (!normalizedDomainId) return "No domain assigned";
  return domainsById[normalizedDomainId]?.name ?? "Unknown domain";
};

const formatTrialTimestamp = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
};

const formatPromptSummary = (event: TrialEvent): string => {
  const parts = [event.prompt_type, event.prompt_level].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" / ") : "None recorded";
};

type GoalDisplaySection = {
  key: "behavior" | "skill" | "other";
  title: string;
  description: string;
  domainGroups: Array<{
    key: string;
    title: string;
    goals: Goal[];
  }>;
};

const buildGoalDisplaySections = (
  goals: Goal[],
  domainsById: Record<string, GoalDomain>,
): GoalDisplaySection[] => {
  const sections: GoalDisplaySection[] = [
    {
      key: "behavior",
      title: "Behavior Reduction",
      description: "Behavior goals and replacement targets from the care plan.",
      domainGroups: [],
    },
    {
      key: "skill",
      title: "Skill Acquisition",
      description: "Skill-building goals and teaching targets from the care plan.",
      domainGroups: [],
    },
    {
      key: "other",
      title: "Needs Review",
      description: "Goals that need clinical type or domain review.",
      domainGroups: [],
    },
  ];
  const byKey = new Map(sections.map((section) => [section.key, section]));
  const domainGroupsBySection = new Map<string, Map<string, GoalDisplaySection["domainGroups"][number]>>();

  goals.forEach((goal) => {
    const sectionKey =
      goal.clinical_goal_type === "behavior" || goal.clinical_goal_type === "skill"
        ? goal.clinical_goal_type
        : "other";
    const section = byKey.get(sectionKey);
    if (!section) return;
    const domainKey = goal.domain_id?.trim() || "unassigned";
    const groupKey = `${sectionKey}:${domainKey}`;
    let sectionDomainGroups = domainGroupsBySection.get(sectionKey);
    if (!sectionDomainGroups) {
      sectionDomainGroups = new Map();
      domainGroupsBySection.set(sectionKey, sectionDomainGroups);
    }
    let domainGroup = sectionDomainGroups.get(groupKey);
    if (!domainGroup) {
      domainGroup = {
        key: groupKey,
        title: formatDomainLabel(goal.domain_id, domainsById),
        goals: [],
      };
      sectionDomainGroups.set(groupKey, domainGroup);
      section.domainGroups.push(domainGroup);
    }
    domainGroup.goals.push(goal);
  });

  return sections
    .map((section) => ({
      ...section,
      domainGroups: [...section.domainGroups].sort((left, right) => left.title.localeCompare(right.title)),
    }))
    .filter((section) => section.domainGroups.length > 0);
};

const hasLegacySignaturePayload = (payload: Record<string, unknown>): boolean => {
  const hasTransferSignatureFields = ["report_completed_date", "credentials", "agency"].some((key) =>
    Object.prototype.hasOwnProperty.call(payload, key)
  );
  return !hasTransferSignatureFields && hasNonBlankPayloadValue(payload, "completed_by");
};

const hasMeaningfulStructuredValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 && normalized !== "unknown";
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value === true;
  if (Array.isArray(value)) return value.some(hasMeaningfulStructuredValue);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, nestedValue]) =>
      !IEHP_STRUCTURED_METADATA_KEYS.has(key) && hasMeaningfulStructuredValue(nestedValue)
    );
  }
  return false;
};

const hasDefaultRequiredStructuredValue = (payload: Record<string, unknown>): boolean => {
  return Object.entries(payload).some(([key, value]) =>
    !IEHP_STRUCTURED_METADATA_KEYS.has(key) && hasMeaningfulStructuredValue(value)
  );
};

const countIehpStructuredDataQualityIssues = (sections: AssessmentStructuredSection[]): number =>
  sections.filter((section) => {
    if (!section.required || section.status !== "approved") {
      return false;
    }
    const payload = section.payload && typeof section.payload === "object" ? section.payload : null;
    if (!payload) {
      return true;
    }
    const requiredFields = IEHP_REQUIRED_PAYLOAD_FIELDS[section.field_key] ?? (
      IEHP_GOAL_SECTION_KEYS.has(section.field_key) ? IEHP_REQUIRED_GOAL_FIELDS : []
    );
    const hasMissingRequiredFields = requiredFields.some((field) => !hasNonBlankPayloadValue(payload, field));
    if (
      section.field_key === "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES" &&
      hasMissingRequiredFields &&
      hasMeaningfulAdaptiveBlocks(payload)
    ) {
      return false;
    }
    if (IEHP_GOAL_SECTION_KEYS.has(section.field_key) && hasMissingRequiredFields && hasMeaningfulRawText(payload)) {
      return false;
    }
    if (section.field_key === "IEHP_FBA_SIGNATURE_BLOCK" && hasMissingRequiredFields && hasLegacySignaturePayload(payload)) {
      return false;
    }
    if (requiredFields.length === 0 && !hasDefaultRequiredStructuredValue(payload)) {
      return true;
    }
    if (hasMissingRequiredFields) {
      return true;
    }
    if (section.field_key !== "IEHP_FBA_RECOMMENDATIONS_HCPCS_ROWS") {
      return false;
    }
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    return rows.length === 0 || rows.some((entry) => {
      const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      return (
        isBlankTransferredValue(row.hcpcs_code ?? row.cpt) ||
        isBlankTransferredValue(row.description) ||
        isBlankTransferredValue(row.units_requested)
      );
    });
  }).length;

const isRequiredForAssessmentExport = (fieldKey: string, required: boolean, isIehp: boolean): boolean =>
  required && !(isIehp && IEHP_OPTIONAL_FINAL_OUTPUT_KEYS.has(fieldKey));

const buildStructuredPayloadPreview = (payload: Record<string, unknown>): string[] => {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (rows.length > 0) {
    return rows.slice(0, 4).map((row, index) => {
      const rowRecord = row && typeof row === "object" ? row as Record<string, unknown> : { value: row };
      const rowText = typeof rowRecord.raw_text === "string"
        ? rowRecord.raw_text
        : Object.entries(rowRecord)
            .map(([key, value]) => `${key}: ${formatPayloadValue(value)}`)
            .join("; ");
      return `Row ${index + 1}: ${rowText}`;
    });
  }

  const orderedKeys = [
    "title",
    "program_name",
    "goal_type",
    "raw_text",
    "original_text",
    "written_by",
    "reviewed_by",
    "report_completed_date",
  ];
  const preview = orderedKeys
    .filter((key) => payload[key] != null && formatPayloadValue(payload[key]).trim().length > 0)
    .map((key) => `${key.replace(/_/g, " ")}: ${formatPayloadValue(payload[key])}`);

  if (preview.length > 0) {
    return preview.slice(0, 5);
  }

  return Object.entries(payload)
    .slice(0, 5)
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${formatPayloadValue(value)}`);
};

const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const PROGRAMS_EDGE_PATH = "programs";
const GOALS_EDGE_PATH = "goals";
const PROGRAM_NOTES_EDGE_PATH = "program-notes";
const GOAL_TARGETS_EDGE_PATH = "goal-targets";
const TRIAL_EVENTS_EDGE_PATH = "trial-events";

const buildProgramsQueryPath = (clientId: string): string =>
  `${PROGRAMS_EDGE_PATH}?client_id=${encodeURIComponent(clientId)}`;

const buildClientProgramsQueryKey = (clientId: string, organizationId?: string | null) =>
  ["client-programs", clientId, organizationId ?? "MISSING_ORG"] as const;

const GOAL_TIMELINE_INPUTS: ReadonlyArray<{
  key: keyof GoalTimelineFields;
  placeholder: string;
}> = [
  { key: "shortTermGoal", placeholder: "Short-term goal" },
  { key: "intermediateGoal", placeholder: "Intermediate goal" },
  { key: "longTermGoal", placeholder: "Long-term goal" },
];

const buildProgramGoalsQueryKey = (programId: string | null, organizationId?: string | null) =>
  ["program-goals", programId, organizationId ?? "MISSING_ORG"] as const;

const buildGoalDomainsQueryKey = (organizationId?: string | null) =>
  ["goal-domains", organizationId ?? "MISSING_ORG"] as const;

const buildProgramNotesQueryKey = (programId: string | null, organizationId?: string | null) =>
  ["program-notes", programId, organizationId ?? "MISSING_ORG"] as const;

const buildGoalTargetsQueryKey = (
  clientId: string,
  goalIds: ReadonlyArray<string>,
  organizationId?: string | null,
) => ["goal-targets", clientId, organizationId ?? "MISSING_ORG", goalIds.join(",")] as const;

const buildGoalTargetGraphConfig = (measurementType: TargetMeasurementType): Record<string, unknown> => ({
  defaultChart: "line",
  source: "trial_events",
  aggregation: measurementType === "frequency" ? "sum" : "session_summary",
});

const normalizeGoalTargetGraphConfig = (
  measurementType: TargetMeasurementType,
  graphConfig: Record<string, unknown> | undefined,
): Record<string, unknown> => ({
  ...buildGoalTargetGraphConfig(measurementType),
  ...(graphConfig ?? {}),
});

const GRAPH_CHART_TYPES = ["line", "bar"] as const;
const GRAPH_SOURCES = ["trial_events", "session_notes"] as const;
const GRAPH_AGGREGATIONS = ["session_summary", "sum", "average", "count"] as const;

const upsertById = <T extends { id: string }>(current: T[] | undefined, nextItem: T): T[] => {
  const existingItems = Array.isArray(current) ? current : [];
  const existingIndex = existingItems.findIndex((item) => item.id === nextItem.id);
  if (existingIndex >= 0) {
    const nextItems = [...existingItems];
    nextItems[existingIndex] = nextItem;
    return nextItems;
  }
  return [nextItem, ...existingItems];
};

const mapById = <T extends { id: string }>(
  current: T[] | undefined,
  id: string,
  mapItem: (item: T) => T,
): T[] => {
  const existingItems = Array.isArray(current) ? current : [];
  return existingItems.map((item) => (item.id === id ? mapItem(item) : item));
};

const shouldFallbackToApi = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("timed out") || message.includes("failed to fetch") || message.includes("networkerror");
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });

const callEdgeWithSupabaseFallback = async (params: {
  edgePath: string;
  fallback: () => Promise<Response>;
  init?: RequestInit;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<Response> => {
  const { edgePath, fallback, init, timeoutMs, timeoutMessage } = params;
  try {
    return await withTimeout(callEdgeFunctionHttp(edgePath, init), timeoutMs, timeoutMessage);
  } catch (error) {
    if (!shouldFallbackToApi(error)) {
      throw error;
    }
    return fallback();
  }
};

const isSupportedAssessmentFile = (file: File): boolean => {
  const lowerFileName = file.name.trim().toLowerCase();
  return SUPPORTED_ASSESSMENT_FILE_EXTENSIONS.some((extension) => lowerFileName.endsWith(extension));
};

const formatStructuredSectionPayload = (payload: unknown): string => {
  if (payload == null) {
    return "{}";
  }

  if (typeof payload === "string") {
    return payload.trim() ? payload : "{}";
  }

  try {
    const serialized = JSON.stringify(payload, null, 2);
    return serialized && serialized.trim().length > 0 ? serialized : "{}";
  } catch {
    return "{}";
  }
};

interface ProgramsGoalsTabProps {
  client: Client;
}

interface AssessmentPromoteResponse {
  created_program_count: number;
  created_goal_count: number;
  promoted_program_count?: number;
  promoted_goal_count?: number;
  completion_mode?: "assessment_only" | "live_program_goals";
}

interface TargetTrialEventGraphProps {
  clientId: string;
  organizationId: string | null;
  target: GoalTarget;
}

function TargetProgressPanel({ clientId, organizationId, target }: TargetTrialEventGraphProps) {
  const {
    data: trialEvents = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["trial-events", clientId, organizationId ?? "no-org", target.id] as const,
    queryFn: async () => {
      const response = await withTimeout(
        callEdgeFunctionHttp(`${TRIAL_EVENTS_EDGE_PATH}?target_id=${encodeURIComponent(target.id)}`),
        TRIAL_EVENTS_REQUEST_TIMEOUT_MS,
        "Trial-event graph request timed out. Please retry.",
      );
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to load trial events."));
      }
      return sortTrialEvents(await parseJson<TrialEvent[]>(response));
    },
    enabled: Boolean(organizationId && target.id),
    retry: false,
    staleTime: TAB_QUERY_STALE_TIME_MS,
    refetchOnReconnect: true,
  });
  const graphEvents = latestTrialEventsForGraph(trialEvents);
  const maxGraphScore = Math.max(1, ...graphEvents.map(trialEventGraphScore));

  return (
    <div
      className="mt-3 rounded-md border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40"
      role="region"
      aria-label={`Trial-event progress for ${target.name}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-slate-700 dark:text-slate-200">Target progress</span>
        <span className="rounded-full bg-white px-2 py-0.5 text-slate-500 dark:bg-dark">
          {trialEvents.length} trial{trialEvents.length === 1 ? "" : "s"}
        </span>
      </div>
      {error instanceof Error ? (
        <p className="text-amber-700 dark:text-amber-300">
          Could not load trial-level data: {error.message}
        </p>
      ) : isLoading ? (
        <p className="text-slate-500">Loading trial-level data...</p>
      ) : graphEvents.length === 0 ? (
        <p className="text-slate-500">No trial-level data yet.</p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1" aria-label={`Recent graph points for ${target.name}`}>
            {graphEvents.map((event) => {
              const score = trialEventGraphScore(event);
              const widthPercent = Math.max(8, Math.round((score / maxGraphScore) * 100));
              return (
                <div key={event.id} className="grid grid-cols-[5rem_minmax(0,1fr)_5rem] items-center gap-2">
                  <span className="text-slate-500">Trial {event.trial_number}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${widthPercent}%` }}
                    />
                  </div>
                  <span className="text-right text-slate-600 dark:text-slate-300">
                    {formatTrialEventValue(event)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-dark">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs dark:divide-slate-700">
              <caption className="sr-only">Raw trial events for {target.name}</caption>
              <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/50 dark:text-slate-300">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">Trial</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Date</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Result</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Prompt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {trialEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-700 dark:text-slate-200">
                      {event.trial_number}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                      {formatTrialTimestamp(event.event_timestamp)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-700 dark:text-slate-200">
                      {formatTrialEventValue(event)}
                    </td>
                    <td className="min-w-[9rem] px-2 py-1.5 text-slate-500">
                      {formatPromptSummary(event)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function GoalFieldList({
  domainsById,
  goal,
}: {
  domainsById: Record<string, GoalDomain>;
  goal: Goal;
}) {
  const objectiveCount = Array.isArray(goal.objective_data_points) ? goal.objective_data_points.length : 0;
  const fields = [
    { label: "Goal", value: goal.description },
    { label: "Baseline", value: goal.baseline ?? goal.baseline_data },
    { label: "Operational definition", value: goal.operational_definition },
    { label: "Teaching strategies", value: goal.teaching_strategies },
    { label: "Target criteria", value: goal.target_criteria },
    { label: "Mastery criteria", value: goal.mastery_criteria },
    { label: "Generalization criteria", value: goal.generalization_criteria },
    { label: "Maintenance criteria", value: goal.maintenance_criteria },
  ].filter((field) => typeof field.value === "string" && field.value.trim().length > 0);

  return (
    <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
      <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/30">
        <dt className="font-medium uppercase text-slate-500">Type / domain</dt>
        <dd className="mt-1 text-slate-800 dark:text-slate-100">
          {formatGoalClinicalType(goal)} · {formatDomainLabel(goal.domain_id, domainsById)}
        </dd>
      </div>
      <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/30">
        <dt className="font-medium uppercase text-slate-500">Source / measurement</dt>
        <dd className="mt-1 text-slate-800 dark:text-slate-100">
          {formatGoalSource(goal.source)} · {goal.measurement_type || "Measurement not set"}
        </dd>
      </div>
      {fields.map((field) => (
        <div
          key={field.label}
          className="rounded border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/30"
        >
          <dt className="font-medium uppercase text-slate-500">{field.label}</dt>
          <dd className="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-100">{field.value}</dd>
        </div>
      ))}
      <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/30">
        <dt className="font-medium uppercase text-slate-500">Targets</dt>
        <dd className="mt-1 text-slate-800 dark:text-slate-100">
          {objectiveCount} objective data point{objectiveCount === 1 ? "" : "s"}
        </dd>
      </div>
    </dl>
  );
}

function GoalTargetCard({
  canDelete,
  clientId,
  deleteGoalTarget,
  deletingTargetId,
  goalTargetsLoading,
  lifecycleTargetId,
  organizationId,
  setGoalTargetArchiveState,
  target,
  updateGoalTarget,
  updatingTargetId,
}: {
  canDelete: boolean;
  clientId: string;
  deleteGoalTarget: {
    isLoading: boolean;
    mutate: (target: GoalTarget) => void;
  };
  deletingTargetId: string | null;
  goalTargetsLoading: boolean;
  lifecycleTargetId: string | null;
  organizationId: string | null;
  setGoalTargetArchiveState: {
    isLoading: boolean;
    mutate: (input: { target: GoalTarget; status: "active" | "archived" }) => void;
  } | null;
  target: GoalTarget;
  updateGoalTarget: {
    isLoading: boolean;
    mutate: (input: {
      target: GoalTarget;
      name: string;
      measurement_type: TargetMeasurementType;
      status: GoalTarget["status"];
      graph_config?: Record<string, unknown>;
    }) => void;
  } | null;
  updatingTargetId: string | null;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const normalizedGraphConfig = normalizeGoalTargetGraphConfig(target.measurement_type, target.graph_config);
  const [editName, setEditName] = useState(target.name);
  const [editMeasurementType, setEditMeasurementType] = useState<TargetMeasurementType>(target.measurement_type);
  const [editStatus, setEditStatus] = useState<GoalTarget["status"]>(target.status);
  const [editGraphChart, setEditGraphChart] = useState(String(normalizedGraphConfig.defaultChart));
  const [editGraphSource, setEditGraphSource] = useState(String(normalizedGraphConfig.source));
  const [editGraphAggregation, setEditGraphAggregation] = useState(String(normalizedGraphConfig.aggregation));
  const editNameValue = editName.trim();
  const editedGraphConfig = {
    defaultChart: editGraphChart,
    source: editGraphSource,
    aggregation: editGraphAggregation,
  };
  const graphConfigChanged =
    editedGraphConfig.defaultChart !== String(normalizedGraphConfig.defaultChart) ||
    editedGraphConfig.source !== String(normalizedGraphConfig.source) ||
    editedGraphConfig.aggregation !== String(normalizedGraphConfig.aggregation);
  const graphConfigIncomplete =
    !target.graph_config ||
    target.graph_config.defaultChart === undefined ||
    target.graph_config.source === undefined ||
    target.graph_config.aggregation === undefined;
  const measurementTypeChanged = editMeasurementType !== target.measurement_type;
  const shouldPersistGraphConfig = graphConfigChanged || graphConfigIncomplete || measurementTypeChanged;
  const isSaving = updatingTargetId === target.id && updateGoalTarget?.isLoading === true;
  const isLifecyclePending = lifecycleTargetId === target.id && setGoalTargetArchiveState?.isLoading === true;
  const isDeleting = deletingTargetId === target.id && deleteGoalTarget.isLoading;
  const lifecycleActionsBusy = lifecycleTargetId !== null || deletingTargetId !== null;

  useEffect(() => {
    if (isEditing) return;
    const nextGraphConfig = normalizeGoalTargetGraphConfig(target.measurement_type, target.graph_config);
    setEditName(target.name);
    setEditMeasurementType(target.measurement_type);
    setEditStatus(target.status);
    setEditGraphChart(String(nextGraphConfig.defaultChart));
    setEditGraphSource(String(nextGraphConfig.source));
    setEditGraphAggregation(String(nextGraphConfig.aggregation));
  }, [isEditing, target.graph_config, target.measurement_type, target.name, target.status]);

  const resetEditor = () => {
    const nextGraphConfig = normalizeGoalTargetGraphConfig(target.measurement_type, target.graph_config);
    setEditName(target.name);
    setEditMeasurementType(target.measurement_type);
    setEditStatus(target.status);
    setEditGraphChart(String(nextGraphConfig.defaultChart));
    setEditGraphSource(String(nextGraphConfig.source));
    setEditGraphAggregation(String(nextGraphConfig.aggregation));
  };
  const handleMeasurementTypeChange = (measurementType: TargetMeasurementType) => {
    setEditMeasurementType(measurementType);
    setEditGraphAggregation(String(buildGoalTargetGraphConfig(measurementType).aggregation));
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-3 text-xs dark:border-slate-700 dark:bg-dark">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-slate-800 dark:text-slate-100">{target.name}</span>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            {target.status}
          </span>
          {updateGoalTarget && target.status !== "archived" && (
            <button
              type="button"
              aria-label={isEditing ? `Cancel editing target ${target.name}` : `Edit target ${target.name}`}
              title={isEditing ? "Cancel target edit" : "Edit target"}
              onClick={() => {
                if (isEditing) {
                  resetEditor();
                  setIsEditing(false);
                  return;
                }
                setIsEditing(true);
              }}
              disabled={isSaving}
              className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {isEditing ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : <Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          )}
          {setGoalTargetArchiveState && (
            <button
              type="button"
              aria-label={`${target.status === "archived" ? "Restore" : "Archive"} target ${target.name}`}
              onClick={() => setGoalTargetArchiveState.mutate({
                target,
                status: target.status === "archived" ? "active" : "archived",
              })}
              disabled={lifecycleActionsBusy}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {isLifecyclePending ? "Saving..." : target.status === "archived" ? "Restore" : "Archive"}
            </button>
          )}
          {canDelete && target.status === "archived" && (
            <button
              type="button"
              aria-label={`Delete target ${target.name}`}
              onClick={() => {
                const confirmed = typeof window === "undefined" || window.confirm(
                  `Delete target "${target.name}"? This action is irreversible.`,
                );
                if (confirmed) deleteGoalTarget.mutate(target);
              }}
              disabled={lifecycleActionsBusy}
              className="rounded-md border border-rose-200 px-2 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-900/30 disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          )}
        </div>
      </div>
      {isEditing && (
        <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 p-3 dark:border-blue-900/60 dark:bg-blue-900/20">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              Name
              <input
                type="text"
                aria-label={`Target name for ${target.name}`}
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                className="mt-1 w-full rounded-md border-slate-300 bg-white text-sm shadow-sm dark:border-slate-600 dark:bg-dark"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              Measurement
              <select
                aria-label={`Measurement type for ${target.name}`}
                value={editMeasurementType}
                onChange={(event) => handleMeasurementTypeChange(event.target.value as TargetMeasurementType)}
                className="mt-1 w-full rounded-md border-slate-300 bg-white text-sm shadow-sm dark:border-slate-600 dark:bg-dark"
              >
                {TARGET_MEASUREMENT_TYPES.map((measurementType) => (
                  <option key={measurementType} value={measurementType}>
                    {TARGET_MEASUREMENT_TYPE_LABELS[measurementType]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              Status
              <select
                aria-label={`Target status for ${target.name}`}
                value={editStatus}
                onChange={(event) => setEditStatus(event.target.value as GoalTarget["status"])}
                className="mt-1 w-full rounded-md border-slate-300 bg-white text-sm shadow-sm dark:border-slate-600 dark:bg-dark"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="mastered">Mastered</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              Chart
              <select
                aria-label={`Graph chart for ${target.name}`}
                value={editGraphChart}
                onChange={(event) => setEditGraphChart(event.target.value)}
                className="mt-1 w-full rounded-md border-slate-300 bg-white text-sm shadow-sm dark:border-slate-600 dark:bg-dark"
              >
                {GRAPH_CHART_TYPES.map((chartType) => (
                  <option key={chartType} value={chartType}>
                    {chartType}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              Source
              <select
                aria-label={`Graph source for ${target.name}`}
                value={editGraphSource}
                onChange={(event) => setEditGraphSource(event.target.value)}
                className="mt-1 w-full rounded-md border-slate-300 bg-white text-sm shadow-sm dark:border-slate-600 dark:bg-dark"
              >
                {GRAPH_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
              Aggregation
              <select
                aria-label={`Graph aggregation for ${target.name}`}
                value={editGraphAggregation}
                onChange={(event) => setEditGraphAggregation(event.target.value)}
                className="mt-1 w-full rounded-md border-slate-300 bg-white text-sm shadow-sm dark:border-slate-600 dark:bg-dark"
              >
                {GRAPH_AGGREGATIONS.map((aggregation) => (
                  <option key={aggregation} value={aggregation}>
                    {aggregation}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                resetEditor();
                setIsEditing(false);
              }}
              disabled={isSaving}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              aria-label={`Save target ${target.name}`}
              onClick={() => {
                updateGoalTarget?.mutate({
                  target,
                  name: editNameValue,
                  measurement_type: editMeasurementType,
                  status: editStatus,
                  ...(shouldPersistGraphConfig ? { graph_config: editedGraphConfig } : {}),
                });
                setIsEditing(false);
              }}
              disabled={!editNameValue || isSaving}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-slate-500">
        <span>
          Measurement: {TARGET_MEASUREMENT_TYPE_LABELS[target.measurement_type] ?? target.measurement_type}
        </span>
        <span>
          Graph: {String(target.graph_config?.defaultChart ?? "line")} from{" "}
          {String(target.graph_config?.source ?? "trial_events")}
          {target.graph_config?.aggregation ? ` (${String(target.graph_config.aggregation)})` : ""}
        </span>
      </div>
      {goalTargetsLoading ? (
        <p className="mt-3 text-slate-500">Loading target progress...</p>
      ) : (
        <TargetProgressPanel clientId={clientId} organizationId={organizationId} target={target} />
      )}
    </div>
  );
}

function GoalCard({
  archivingGoalId,
  archiveGoal,
  canDeleteGoalTargets,
  clientId,
  deleteGoalTarget,
  deletingTargetId,
  domainsById,
  goal,
  goalTargetsForGoal,
  goalTargetsLoading,
  lifecycleTargetId,
  organizationId,
  setGoalTargetArchiveState,
  updateGoalTarget,
  updatingTargetId,
}: {
  archivingGoalId: string | null;
  archiveGoal: {
    isLoading: boolean;
    mutate: (goal: Goal) => void;
  };
  canDeleteGoalTargets: boolean;
  clientId: string;
  deleteGoalTarget: {
    isLoading: boolean;
    mutate: (target: GoalTarget) => void;
  };
  deletingTargetId: string | null;
  domainsById: Record<string, GoalDomain>;
  goal: Goal;
  goalTargetsForGoal: GoalTarget[];
  goalTargetsLoading: boolean;
  lifecycleTargetId: string | null;
  organizationId: string | null;
  setGoalTargetArchiveState: {
    isLoading: boolean;
    mutate: (input: { target: GoalTarget; status: "active" | "archived" }) => void;
  } | null;
  updateGoalTarget: {
    isLoading: boolean;
    mutate: (input: {
      target: GoalTarget;
      name: string;
      measurement_type: TargetMeasurementType;
      status: GoalTarget["status"];
      graph_config?: Record<string, unknown>;
    }) => void;
  } | null;
  updatingTargetId: string | null;
}) {
  const [showArchivedTargets, setShowArchivedTargets] = useState(false);
  const activeTargets = goalTargetsForGoal.filter((target) => target.status !== "archived");
  const archivedTargets = goalTargetsForGoal.filter((target) => target.status === "archived");
  const renderTargetCard = (target: GoalTarget) => (
    <GoalTargetCard
      key={target.id}
      canDelete={canDeleteGoalTargets}
      clientId={clientId}
      deleteGoalTarget={deleteGoalTarget}
      deletingTargetId={deletingTargetId}
      goalTargetsLoading={goalTargetsLoading}
      lifecycleTargetId={lifecycleTargetId}
      organizationId={organizationId}
      setGoalTargetArchiveState={setGoalTargetArchiveState}
      target={target}
      updateGoalTarget={updateGoalTarget}
      updatingTargetId={updatingTargetId}
    />
  );

  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-dark-lighter/30">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium text-gray-800 dark:text-gray-200">{goal.title}</div>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs uppercase text-gray-500 dark:bg-gray-800">
              {goal.status}
            </span>
          </div>
          {goal.original_text && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-300">
              Original: {goal.original_text}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={`Remove ${goal.title}`}
          title="Remove from active care plan"
          onClick={() => {
            if (typeof window !== "undefined") {
              const confirmed = window.confirm(
                `Remove goal "${goal.title}" from the active care plan?`,
              );
              if (!confirmed) {
                return;
              }
            }
            archiveGoal.mutate(goal);
          }}
          disabled={archivingGoalId === goal.id && archiveGoal.isLoading}
          className="shrink-0 rounded-md border border-transparent p-1.5 text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-900/30 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <GoalFieldList domainsById={domainsById} goal={goal} />
      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/30">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Targets
          </p>
          <span className="text-xs text-slate-500">{goalTargetsForGoal.length} configured</span>
        </div>
        {goalTargetsLoading ? (
          <p className="text-xs text-slate-500">Loading targets...</p>
        ) : goalTargetsForGoal.length === 0 ? (
          <p className="text-xs text-slate-500">No target-level measurement definitions yet.</p>
        ) : (
          <div className="space-y-3">
            {activeTargets.length === 0 && !showArchivedTargets && (
              <p className="text-xs text-slate-500">No active targets.</p>
            )}
            {activeTargets.map(renderTargetCard)}
            {archivedTargets.length > 0 && (
              <button
                type="button"
                aria-expanded={showArchivedTargets}
                onClick={() => setShowArchivedTargets((current) => !current)}
                className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {showArchivedTargets ? "Hide archived targets" : `Show archived targets (${archivedTargets.length})`}
              </button>
            )}
            {showArchivedTargets && archivedTargets.length > 0 && (
              <section aria-label="Archived targets" className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Archived targets</p>
                {archivedTargets.map(renderTargetCard)}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProgramsGoalsTab({ client }: ProgramsGoalsTabProps) {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();
  const { hasCapability, session } = useAuth();
  const canManageProgramsGoals = hasCapability("manageProgramsGoals");
  const canDeleteGoalTargets = hasCapability("deleteGoalTargets");
  const publishSectionRef = useRef<HTMLDivElement | null>(null);
  const assessmentDocumentsQueryKey = ["assessment-documents", client.id, organizationId ?? "MISSING_ORG"] as const;
  const clientProgramsQueryKey = buildClientProgramsQueryKey(client.id, organizationId);
  const goalDomainsQueryKey = buildGoalDomainsQueryKey(organizationId);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | null>(null);
  const [assessmentFile, setAssessmentFile] = useState<File | null>(null);
  const [assessmentTemplateType, setAssessmentTemplateType] = useState<AssessmentTemplateType>("caloptima_fba");
  const [programName, setProgramName] = useState("");
  const [programDescription, setProgramDescription] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [goalOriginalText, setGoalOriginalText] = useState("");
  const [goalMeasurementType, setGoalMeasurementType] = useState("");
  const [goalClinicalGoalType, setGoalClinicalGoalType] = useState<Goal["clinical_goal_type"]>("skill");
  const [goalDomainId, setGoalDomainId] = useState("");
  const [newGoalDomainName, setNewGoalDomainName] = useState("");
  const [goalSource, setGoalSource] = useState<NonNullable<Goal["source"]>>("manual");
  const [goalBaselineData, setGoalBaselineData] = useState("");
  const [goalTeachingStrategies, setGoalTeachingStrategies] = useState("");
  const [goalOperationalDefinition, setGoalOperationalDefinition] = useState("");
  const [goalShortTermGoal, setGoalShortTermGoal] = useState("");
  const [goalIntermediateGoal, setGoalIntermediateGoal] = useState("");
  const [goalLongTermGoal, setGoalLongTermGoal] = useState("");
  const [goalMasteryCriteria, setGoalMasteryCriteria] = useState("");
  const [goalMaintenanceCriteria, setGoalMaintenanceCriteria] = useState("");
  const [goalGeneralizationCriteria, setGoalGeneralizationCriteria] = useState("");
  const [goalObjectiveDataPoints, setGoalObjectiveDataPoints] = useState("[]");
  const [targetGoalId, setTargetGoalId] = useState("");
  const [targetName, setTargetName] = useState("");
  const [targetMeasurementType, setTargetMeasurementType] = useState<TargetMeasurementType>("correctIncorrect");
  const [targetStatus, setTargetStatus] = useState<GoalTarget["status"]>("active");
  const [checklistEdits, setChecklistEdits] = useState<
    Record<string, { status: AssessmentChecklistItem["status"]; reviewNotes: string; valueText: string }>
  >({});
  const [structuredSectionEdits, setStructuredSectionEdits] = useState<
    Record<string, { status: AssessmentStructuredSection["status"]; reviewNotes: string; payload: string }>
  >({});
  const [draftProgramEdits, setDraftProgramEdits] = useState<
    Record<string, { acceptState: AssessmentDraftProgram["accept_state"]; reviewNotes: string; name: string; description: string }>
  >({});
  const [draftGoalEdits, setDraftGoalEdits] = useState<
    Record<
      string,
      {
        acceptState: AssessmentDraftGoal["accept_state"];
        reviewNotes: string;
        title: string;
        description: string;
        originalText: string;
        goalType: AssessmentDraftGoal["goal_type"];
        measurementType: string;
        baselineData: string;
        shortTermGoal: string;
        intermediateGoal: string;
        longTermGoal: string;
        masteryCriteria: string;
        maintenanceCriteria: string;
        generalizationCriteria: string;
        objectiveDataPoints: string;
      }
    >
  >({});
  const [noteType, setNoteType] = useState<ProgramNote["note_type"]>("plan_update");
  const [noteContent, setNoteContent] = useState("");
  const [deletingAssessmentId, setDeletingAssessmentId] = useState<string | null>(null);
  const [archivingProgramId, setArchivingProgramId] = useState<string | null>(null);
  const [archivingGoalId, setArchivingGoalId] = useState<string | null>(null);
  const [updatingTargetId, setUpdatingTargetId] = useState<string | null>(null);
  const [lifecycleTargetId, setLifecycleTargetId] = useState<string | null>(null);
  const [deletingTargetId, setDeletingTargetId] = useState<string | null>(null);
  const [isUploadProcessing, setIsUploadProcessing] = useState(false);
  const [assessmentDocumentsNeedsRetry, setAssessmentDocumentsNeedsRetry] = useState(false);

  const {
    data: programs = [],
    isLoading: programsLoading,
    error: programsQueryError,
  } = useQuery({
    queryKey: clientProgramsQueryKey,
    queryFn: async () => {
      if (!organizationId) {
        throw new Error("Organization context is required to load programs.");
      }
      const response = await callEdgeWithSupabaseFallback({
        edgePath: buildProgramsQueryPath(client.id),
        fallback: async () => {
          const { data, error } = await supabase
            .from("programs")
            .select("id,organization_id,client_id,name,description,status,start_date,end_date,created_at,updated_at")
            .eq("organization_id", organizationId)
            .eq("client_id", client.id)
            .order("created_at", { ascending: false });
          if (error) {
            return jsonResponse({ error: error.message }, 500);
          }
          return jsonResponse(data ?? []);
        },
        timeoutMs: PROGRAMS_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Programs request timed out. Please retry.",
      });
      if (!response.ok) {
        throw new Error("Failed to load programs");
      }
      return parseJson<Program[]>(response);
    },
    enabled: Boolean(client.id && organizationId),
    retry: false,
    staleTime: TAB_QUERY_STALE_TIME_MS,
    refetchOnReconnect: true,
  });

  const {
    data: goalDomains = [],
    isLoading: goalDomainsLoading,
    error: goalDomainsQueryError,
  } = useQuery({
    queryKey: goalDomainsQueryKey,
    queryFn: async () => {
      if (!organizationId) {
        throw new Error("Organization context is required to load goal domains.");
      }
      const { data, error } = await supabase
        .from("goal_domains")
        .select("id,organization_id,name,description,status,created_at,updated_at")
        .eq("organization_id", organizationId)
        .order("name", { ascending: true });
      if (error) {
        throw new Error(error.message);
      }
      return (data ?? []) as GoalDomain[];
    },
    enabled: Boolean(organizationId),
    retry: false,
    staleTime: TAB_QUERY_STALE_TIME_MS,
    refetchOnReconnect: true,
  });

  const goalDomainsById = useMemo(() => buildGoalDomainLookup(goalDomains), [goalDomains]);
  const activeGoalDomains = useMemo(
    () => goalDomains.filter((domain) => domain.status === "active"),
    [goalDomains],
  );

  const livePrograms = useMemo(
    () => programs.filter((program) => program.status !== "archived"),
    [programs],
  );

  const resolvedProgramId = useMemo(() => {
    if (selectedProgramId && livePrograms.some((program) => program.id === selectedProgramId)) {
      return selectedProgramId;
    }
    return livePrograms.find((program) => program.status === "active")?.id ?? livePrograms[0]?.id ?? null;
  }, [livePrograms, selectedProgramId]);
  const programNameValue = programName.trim();
  const goalTitleValue = goalTitle.trim();
  const goalDescriptionValue = goalDescription.trim();
  const goalOriginalTextValue = goalOriginalText.trim();
  const newGoalDomainNameValue = newGoalDomainName.trim();
  const hasResolvedProgram = Boolean(resolvedProgramId);
  const noProgramHelperText = programsLoading
    ? "Programs are still loading. You can create one now, or wait for an existing program before adding goals or notes."
    : "Create a program or select an existing one before adding goals or notes.";
  const createGoalDisabledReason = !hasResolvedProgram
    ? noProgramHelperText
    : !goalTitleValue
      ? "Goal title is required."
      : !goalDescriptionValue
        ? "Goal description is required."
        : !goalOriginalTextValue
          ? "Original clinical wording is required."
          : goalDomainId === CREATE_NEW_DOMAIN_VALUE
            ? "Create or select a domain before creating the goal."
            : null;
  const noteContentValue = noteContent.trim();
  const createNoteDisabledReason = !hasResolvedProgram
    ? noProgramHelperText
    : !noteContentValue
      ? "Program note is required."
      : null;
  const programGoalsQueryKey = buildProgramGoalsQueryKey(resolvedProgramId, organizationId);
  const programNotesQueryKey = buildProgramNotesQueryKey(resolvedProgramId, organizationId);

  const {
    data: goals = [],
    isLoading: goalsLoading,
    error: goalsQueryError,
  } = useQuery({
    queryKey: programGoalsQueryKey,
    queryFn: async () => {
      if (!resolvedProgramId) return [];
      const response = await callEdgeWithSupabaseFallback({
        edgePath: `${GOALS_EDGE_PATH}?program_id=${encodeURIComponent(resolvedProgramId)}`,
        fallback: async () => {
          const { data, error } = await supabase
            .from("goals")
            .select(
              "id,organization_id,client_id,program_id,domain_id,title,description,target_behavior,measurement_type,original_text,goal_type,clinical_goal_type,clinical_context,baseline_data,baseline,target_criteria,mastery_criteria,maintenance_criteria,generalization_criteria,teaching_strategies,operational_definition,objective_data_points,source,status,created_at,updated_at",
            )
            .eq("organization_id", organizationId ?? "")
            .eq("program_id", resolvedProgramId)
            .order("created_at", { ascending: false });
          if (error) {
            return jsonResponse({ error: error.message }, 500);
          }
          return jsonResponse(data ?? []);
        },
        timeoutMs: GOALS_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Goals request timed out. Please retry.",
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to load goals."));
      }
      return parseJson<Goal[]>(response);
    },
    enabled: Boolean(resolvedProgramId),
    retry: false,
    staleTime: TAB_QUERY_STALE_TIME_MS,
    refetchOnReconnect: true,
  });

  const liveGoals = useMemo(
    () => goals.filter((goal) => goal.status !== "archived"),
    [goals],
  );
  const targetNameValue = targetName.trim();
  const createTargetDisabledReason = liveGoals.length === 0
    ? "Create a goal before adding targets."
    : !targetGoalId
      ? "Select a goal before adding a target."
      : !targetNameValue
        ? "Target name is required."
        : null;

  const goalIdsForTargets = useMemo(() => liveGoals.map((goal) => goal.id).sort(), [liveGoals]);
  const goalTargetsQueryKey = buildGoalTargetsQueryKey(client.id, goalIdsForTargets, organizationId);

  const {
    data: goalTargets = [],
    isLoading: goalTargetsLoading,
    error: goalTargetsQueryError,
  } = useQuery({
    queryKey: goalTargetsQueryKey,
    queryFn: async () => {
      if (goalIdsForTargets.length === 0) {
        return [];
      }
      const targetSets = await Promise.all(
        goalIdsForTargets.map(async (goalId) => {
          const response = await callEdgeFunctionHttp(`${GOAL_TARGETS_EDGE_PATH}?goal_id=${encodeURIComponent(goalId)}`);
          if (!response.ok) {
            throw new Error(await parseApiErrorMessage(response, "Failed to load goal targets."));
          }
          return parseJson<GoalTarget[]>(response);
        }),
      );
      return targetSets.flat();
    },
    enabled: Boolean(organizationId && goalIdsForTargets.length > 0),
    retry: false,
    staleTime: TAB_QUERY_STALE_TIME_MS,
    refetchOnReconnect: true,
  });

  const targetsByGoalId = useMemo(() => buildTargetsByGoalId(goalTargets), [goalTargets]);
  const goalDisplaySections = useMemo(
    () => buildGoalDisplaySections(liveGoals, goalDomainsById),
    [goalDomainsById, liveGoals],
  );
  useEffect(() => {
    if (targetGoalId && goalIdsForTargets.includes(targetGoalId)) {
      return;
    }
    setTargetGoalId(goalIdsForTargets[0] ?? "");
  }, [goalIdsForTargets, targetGoalId]);

  const { data: programNotes = [] } = useQuery({
    queryKey: programNotesQueryKey,
    queryFn: async () => {
      if (!resolvedProgramId) return [];
      const response = await callEdgeWithSupabaseFallback({
        edgePath: `${PROGRAM_NOTES_EDGE_PATH}?program_id=${encodeURIComponent(resolvedProgramId)}`,
        fallback: async () => {
          const { data, error } = await supabase
            .from("program_notes")
            .select("id,organization_id,program_id,author_id,note_type,content,created_at,updated_at")
            .eq("organization_id", organizationId ?? "")
            .eq("program_id", resolvedProgramId)
            .order("created_at", { ascending: false });
          if (error) {
            return jsonResponse({ error: error.message }, 500);
          }
          return jsonResponse(data ?? []);
        },
        timeoutMs: PROGRAM_NOTES_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Program notes request timed out. Please retry.",
      });
      if (!response.ok) {
        throw new Error("Failed to load program notes");
      }
      return parseJson<ProgramNote[]>(response);
    },
    enabled: Boolean(resolvedProgramId),
    retry: false,
    staleTime: TAB_QUERY_STALE_TIME_MS,
    refetchOnReconnect: true,
  });

  const {
    data: assessmentDocuments = EMPTY_ASSESSMENT_DOCUMENTS,
    isLoading: assessmentLoading,
    refetch: refetchAssessmentDocuments,
  } = useQuery({
    queryKey: assessmentDocumentsQueryKey,
    queryFn: async () => {
      const response = await callApi(`/api/assessment-documents?client_id=${encodeURIComponent(client.id)}`);
      if (!response.ok) {
        setAssessmentDocumentsNeedsRetry(true);
        const cachedDocuments = queryClient.getQueryData<AssessmentDocumentRecord[]>(assessmentDocumentsQueryKey);
        return cachedDocuments ?? EMPTY_ASSESSMENT_DOCUMENTS;
      }
      setAssessmentDocumentsNeedsRetry(false);
      return parseJson<AssessmentDocumentRecord[]>(response);
    },
    enabled: Boolean(client.id && organizationId),
    staleTime: TAB_QUERY_STALE_TIME_MS,
  });
  const shouldPollAssessmentDocuments =
    isUploadProcessing ||
    assessmentDocumentsNeedsRetry ||
    assessmentDocuments.some((document) => ACTIVE_ASSESSMENT_POLL_STATUSES.has(document.status));
  const selectedAssessmentIdIsValid = Boolean(selectedAssessmentId && UUID_PATTERN.test(selectedAssessmentId));
  const selectedAssessmentInQueue = Boolean(
    selectedAssessmentId && assessmentDocuments.some((document) => document.id === selectedAssessmentId),
  );
  const canQuerySelectedAssessment = selectedAssessmentIdIsValid && selectedAssessmentInQueue;

  useEffect(() => {
    if (!shouldPollAssessmentDocuments) {
      return undefined;
    }

    const pollHandle = window.setInterval(() => {
      void refetchAssessmentDocuments();
    }, ASSESSMENT_DOCUMENT_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(pollHandle);
    };
  }, [refetchAssessmentDocuments, shouldPollAssessmentDocuments]);

  const {
    data: checklistReview = EMPTY_CHECKLIST_RESPONSE,
    isError: checklistItemsError,
    isLoading: checklistItemsLoading,
  } = useQuery({
    queryKey: ["assessment-checklist", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
    queryFn: async () => {
      if (!selectedAssessmentId) return EMPTY_CHECKLIST_RESPONSE;
      const response = await callApi(
        `/api/assessment-checklist?assessment_document_id=${encodeURIComponent(selectedAssessmentId)}`,
      );
      if (!response.ok) {
        throw new Error("Failed to load checklist");
      }
      const parsed = await parseJson<AssessmentChecklistItem[] | AssessmentChecklistResponse>(response);
      return Array.isArray(parsed)
        ? { items: parsed, structured_sections: [] }
        : {
            items: Array.isArray(parsed.items) ? parsed.items : [],
            structured_sections: Array.isArray(parsed.structured_sections) ? parsed.structured_sections : [],
          };
    },
    enabled: canQuerySelectedAssessment && ENABLE_CHECKLIST_MAPPING_UI,
  });
  const checklistItems = checklistReview.items;
  const structuredSections = checklistReview.structured_sections;

  const { data: assessmentDrafts } = useQuery({
    queryKey: ["assessment-drafts", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
    queryFn: async () => {
      if (!selectedAssessmentId) return EMPTY_ASSESSMENT_DRAFTS;
      const response = await callApi(`/api/assessment-drafts?assessment_document_id=${encodeURIComponent(selectedAssessmentId)}`);
      if (!response.ok) {
        return EMPTY_ASSESSMENT_DRAFTS;
      }
      return parseJson<AssessmentDraftResponse>(response);
    },
    enabled: canQuerySelectedAssessment,
  });

  const checklistBySection = useMemo(() => {
    const grouped = new Map<string, AssessmentChecklistItem[]>();
    checklistItems.forEach((item) => {
      const existing = grouped.get(item.section_key) ?? [];
      existing.push(item);
      grouped.set(item.section_key, existing);
    });
    return Array.from(grouped.entries());
  }, [checklistItems]);
  const structuredSectionsBySection = useMemo(() => {
    const grouped = new Map<string, AssessmentStructuredSection[]>();
    structuredSections.forEach((section) => {
      const existing = grouped.get(section.section_key) ?? [];
      existing.push(section);
      grouped.set(section.section_key, existing);
    });
    return Array.from(grouped.entries());
  }, [structuredSections]);

  const selectedAssessmentDocument = useMemo(
    () => assessmentDocuments.find((document) => document.id === selectedAssessmentId) ?? null,
    [assessmentDocuments, selectedAssessmentId],
  );
  const selectedAssessmentTemplateLabel = selectedAssessmentDocument
    ? TEMPLATE_LABELS[selectedAssessmentDocument.template_type]
    : TEMPLATE_LABELS[assessmentTemplateType];
  const uploadAssessmentTemplateLabel = TEMPLATE_LABELS[assessmentTemplateType];
  const selectedAssessmentIsIehp = selectedAssessmentDocument?.template_type === "iehp_fba";
  const exportAssessmentPdfLabel = selectedAssessmentIsIehp
    ? "Generate completed IEHP DOCX"
    : `Optional: Export Completed ${selectedAssessmentTemplateLabel} PDF`;
  useEffect(() => {
    if (!selectedAssessmentId || selectedAssessmentDocument?.status !== "drafted") {
      return;
    }
    queryClient.invalidateQueries({
      queryKey: ["assessment-drafts", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
    });
    queryClient.invalidateQueries({
      queryKey: ["assessment-checklist", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
    });
  }, [organizationId, queryClient, selectedAssessmentDocument?.status, selectedAssessmentId]);
  const selectedAssessmentAlreadyPublished = selectedAssessmentDocument
    ? selectedAssessmentDocument.status === "approved" || String(selectedAssessmentDocument.status) === "promoted"
    : false;
  const checklistReviewUnavailable =
    ENABLE_CHECKLIST_MAPPING_UI && canQuerySelectedAssessment && (checklistItemsLoading || checklistItemsError);
  const hasPendingRequiredChecklistItems =
    ENABLE_CHECKLIST_MAPPING_UI &&
    (checklistReviewUnavailable ||
      checklistItems.some((item) => item.required && item.status !== "approved") ||
      structuredSections.some((section) => section.required && section.status !== "approved"));
  const hasPendingRequiredExportItems =
    ENABLE_CHECKLIST_MAPPING_UI &&
    (checklistReviewUnavailable ||
      checklistItems.some((item) =>
        isRequiredForAssessmentExport(item.placeholder_key, item.required, selectedAssessmentIsIehp) &&
        item.status !== "approved"
      ) ||
      structuredSections.some((section) =>
        isRequiredForAssessmentExport(section.field_key, section.required, selectedAssessmentIsIehp) &&
        section.status !== "approved"
      ));
  const hasExistingDrafts = (assessmentDrafts?.programs?.length ?? 0) > 0 || (assessmentDrafts?.goals?.length ?? 0) > 0;
  const acceptedDraftProgramCount = (assessmentDrafts?.programs ?? []).filter(
    (program) => program.accept_state === "accepted" || program.accept_state === "edited",
  ).length;
  const acceptedDraftGoalCount = (assessmentDrafts?.goals ?? []).filter(
    (goal) => goal.accept_state === "accepted" || goal.accept_state === "edited",
  ).length;
  const pendingDraftProgramCount = (assessmentDrafts?.programs ?? []).filter((program) => program.accept_state === "pending").length;
  const pendingDraftGoalCount = (assessmentDrafts?.goals ?? []).filter((goal) => goal.accept_state === "pending").length;
  const showDraftReviewPanel =
    ENABLE_PROGRAMS_GOALS_AI_PROPOSALS && !selectedAssessmentAlreadyPublished && !selectedAssessmentIsIehp;
  const extractedChecklistValueCount = checklistItems.filter((item) => item.value_text?.trim()).length;
  const structuredChildGoalCount = structuredSections.filter(isStructuredChildGoalSection).length;
  const structuredParentGoalCount = structuredSections.filter(isStructuredParentGoalSection).length;
  const hasStagedDraftChanges = hasExistingDrafts && !selectedAssessmentAlreadyPublished;
  const hasDraftsButNoLivePrograms = hasExistingDrafts && livePrograms.length === 0 && !selectedAssessmentAlreadyPublished;
  const draftSaveHelperText = selectedAssessmentAlreadyPublished
    ? "Draft retained for audit after approval. Live records are already published."
    : "Saves to draft only. Not visible in live records until published.";
  const unresolvedRequiredCount = ENABLE_CHECKLIST_MAPPING_UI
    ? checklistItems.filter((item) => item.required && item.status !== "approved").length +
      structuredSections.filter((section) => section.required && section.status !== "approved").length
    : 0;
  const blankApprovedIehpChecklistValueCount = selectedAssessmentIsIehp
    ? checklistItems.filter((item) =>
        item.required &&
        item.status === "approved" &&
        isBlankTransferredValue(item.value_text) &&
        isBlankTransferredValue(item.value_json)
      ).length
    : 0;
  const malformedApprovedIehpStructuredCount = selectedAssessmentIsIehp
    ? countIehpStructuredDataQualityIssues(structuredSections)
    : 0;
  const iehpDataQualityIssueCount = blankApprovedIehpChecklistValueCount + malformedApprovedIehpStructuredCount;
  const promoteDisabledReason = !selectedAssessmentId
    ? "Select an assessment before publishing."
    : selectedAssessmentAlreadyPublished
      ? "This assessment has already been approved and published."
      : hasPendingRequiredChecklistItems
        ? `${unresolvedRequiredCount} required checklist or structured row${unresolvedRequiredCount === 1 ? "" : "s"} must be approved before publishing.`
        : acceptedDraftProgramCount === 0
          ? "At least one draft program must be accepted or edited before publishing."
          : acceptedDraftGoalCount === 0
            ? "At least one draft goal must be accepted or edited before publishing."
            : null;
  const iehpPublishDisabledReason = !selectedAssessmentId
    ? "Select an assessment before publishing."
    : selectedAssessmentAlreadyPublished
      ? "This assessment has already been approved and published."
      : hasPendingRequiredChecklistItems
        ? `${unresolvedRequiredCount} required checklist or structured row${unresolvedRequiredCount === 1 ? "" : "s"} must be approved before publishing.`
        : iehpDataQualityIssueCount > 0
          ? `${iehpDataQualityIssueCount} approved IEHP data value${iehpDataQualityIssueCount === 1 ? "" : "s"} must be completed before publishing.`
        : null;

  useEffect(() => {
    const firstAssessmentId = assessmentDocuments[0]?.id ?? null;
    if (!firstAssessmentId) {
      if (assessmentLoading) {
        return;
      }
      if (selectedAssessmentId !== null) {
        showInfo("Assessment selection was cleared because no assessments are available for this client.");
        setSelectedAssessmentId(null);
      }
      return;
    }
    if (!selectedAssessmentId || !assessmentDocuments.some((document) => document.id === selectedAssessmentId)) {
      if (selectedAssessmentId && selectedAssessmentId !== firstAssessmentId) {
        showInfo("Assessment selection was updated to match this client's available queue.");
      }
      setSelectedAssessmentId(firstAssessmentId);
    }
  }, [assessmentDocuments, selectedAssessmentId, assessmentLoading]);

  useEffect(() => {
    const next: Record<string, { status: AssessmentChecklistItem["status"]; reviewNotes: string; valueText: string }> = {};
    checklistItems.forEach((item) => {
      next[item.id] = {
        status: item.status,
        reviewNotes: item.review_notes ?? "",
        valueText: item.value_text ?? "",
      };
    });
    setChecklistEdits(next);
  }, [checklistItems]);

  useEffect(() => {
    const next: Record<string, { status: AssessmentStructuredSection["status"]; reviewNotes: string; payload: string }> = {};
    structuredSections.forEach((section) => {
      next[section.id] = {
        status: section.status,
        reviewNotes: section.review_notes ?? "",
        payload: formatStructuredSectionPayload(section.payload),
      };
    });
    setStructuredSectionEdits(next);
  }, [structuredSections]);

  useEffect(() => {
    const nextPrograms: Record<
      string,
      { acceptState: AssessmentDraftProgram["accept_state"]; reviewNotes: string; name: string; description: string }
    > = {};
    (assessmentDrafts?.programs ?? []).forEach((program) => {
      nextPrograms[program.id] = {
        acceptState: program.accept_state,
        reviewNotes: program.review_notes ?? "",
        name: program.name,
        description: program.description ?? "",
      };
    });
    setDraftProgramEdits(nextPrograms);

    const nextGoals: Record<
      string,
      {
        acceptState: AssessmentDraftGoal["accept_state"];
        reviewNotes: string;
        title: string;
        description: string;
        originalText: string;
        goalType: AssessmentDraftGoal["goal_type"];
        measurementType: string;
        baselineData: string;
        shortTermGoal: string;
        intermediateGoal: string;
        longTermGoal: string;
        masteryCriteria: string;
        maintenanceCriteria: string;
        generalizationCriteria: string;
        objectiveDataPoints: string;
      }
    > = {};
    (assessmentDrafts?.goals ?? []).forEach((goal) => {
      const parsedTargetCriteria = parseGoalTimelineCriteria(goal.target_criteria);
      nextGoals[goal.id] = {
        acceptState: goal.accept_state,
        reviewNotes: goal.review_notes ?? "",
        title: goal.title,
        description: goal.description,
        originalText: goal.original_text,
        goalType: goal.goal_type,
        measurementType: goal.measurement_type ?? "",
        baselineData: goal.baseline_data ?? "",
        shortTermGoal: parsedTargetCriteria.shortTermGoal,
        intermediateGoal: parsedTargetCriteria.intermediateGoal,
        longTermGoal: parsedTargetCriteria.longTermGoal,
        masteryCriteria: goal.mastery_criteria ?? "",
        maintenanceCriteria: goal.maintenance_criteria ?? "",
        generalizationCriteria: goal.generalization_criteria ?? "",
        objectiveDataPoints: JSON.stringify(goal.objective_data_points ?? [], null, 2),
      };
    });
    setDraftGoalEdits(nextGoals);
  }, [assessmentDrafts?.goals, assessmentDrafts?.programs]);

  const uploadAssessment = useMutation({
    mutationFn: async () => {
      if (!assessmentFile) {
        throw new Error("Select a file before uploading.");
      }
      if (!isSupportedAssessmentFile(assessmentFile)) {
        throw new Error("Unsupported file type. Upload a .pdf or .docx assessment.");
      }
      const detectedTemplateType = detectAssessmentTemplateTypeFromFileName(assessmentFile.name);
      if (detectedTemplateType && detectedTemplateType !== assessmentTemplateType) {
        throw buildAssessmentTemplateMismatchError(detectedTemplateType);
      }
      const filePath = `clients/${client.id}/assessments/${Date.now()}-${assessmentFile.name.replace(/\s+/g, "-")}`;
      const { error: uploadError } = await supabase.storage.from("client-documents").upload(filePath, assessmentFile);
      if (uploadError) {
        throw uploadError;
      }
      return registerAssessmentDocument({
        client_id: client.id,
        file_name: assessmentFile.name,
        mime_type: assessmentFile.type || "application/octet-stream",
        file_size: assessmentFile.size,
        bucket_id: "client-documents",
        object_path: filePath,
        template_type: assessmentTemplateType,
      });
    },
    onSuccess: (created) => {
      const createdTemplateLabel = TEMPLATE_LABELS[created.template_type];
      setAssessmentFile(null);
      setSelectedAssessmentId(created.id);
      queryClient.setQueryData<AssessmentDocumentRecord[]>(assessmentDocumentsQueryKey, (current) => {
        const currentRecords = Array.isArray(current) ? current : [];
        const withoutCreated = currentRecords.filter((record) => record.id !== created.id);
        return [{ ...created }, ...withoutCreated];
      });
      showSuccess(`${createdTemplateLabel} uploaded and checklist initialized.`);
    },
    onError: showError,
  });

  const handleUploadAssessment = async () => {
    if (!assessmentFile || isUploadProcessing) {
      return;
    }
    const detectedTemplateType = detectAssessmentTemplateTypeFromFileName(assessmentFile.name);
    if (detectedTemplateType && detectedTemplateType !== assessmentTemplateType) {
      showError(buildAssessmentTemplateMismatchError(detectedTemplateType));
      return;
    }
    setIsUploadProcessing(true);
    try {
      await uploadAssessment.mutateAsync();
    } finally {
      setIsUploadProcessing(false);
    }
  };

  const handleAssessmentFileChange = (file: File | null) => {
    setAssessmentFile(file);
    const detectedTemplateType = file ? detectAssessmentTemplateTypeFromFileName(file.name) : null;
    if (detectedTemplateType) {
      setAssessmentTemplateType(detectedTemplateType);
    }
  };

  const updateChecklistItem = useMutation({
    mutationFn: async (itemId: string) => {
      const edit = checklistEdits[itemId];
      if (!edit) {
        throw new Error("Checklist row edit state not found.");
      }
      const response = await callApi("/api/assessment-checklist", {
        method: "PATCH",
        body: JSON.stringify({
          item_id: itemId,
          status: edit.status,
          review_notes: edit.reviewNotes,
          value_text: edit.valueText,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to update checklist row"));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["assessment-checklist", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
      });
      showSuccess("Checklist row updated.");
    },
    onError: showError,
  });

  const updateStructuredSection = useMutation({
    mutationFn: async (sectionId: string) => {
      const edit = structuredSectionEdits[sectionId];
      if (!edit) {
        throw new Error("Structured section edit state not found.");
      }
      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(edit.payload);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Structured section payload must be a JSON object.");
        }
        payload = parsed as Record<string, unknown>;
      } catch (error) {
        throw error instanceof Error ? error : new Error("Structured section payload must be valid JSON.");
      }

      const response = await callApi("/api/assessment-checklist", {
        method: "PATCH",
        body: JSON.stringify({
          structured_section_id: sectionId,
          status: edit.status,
          review_notes: edit.reviewNotes,
          payload,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to update structured section"));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["assessment-checklist", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
      });
      showSuccess("Structured section updated.");
    },
    onError: showError,
  });

  const deleteAssessmentDocument = useMutation({
    mutationFn: async (document: AssessmentDocumentRecord) => {
      const { error: storageError } = await supabase.storage.from(document.bucket_id).remove([document.object_path]);
      if (storageError) {
        // Storage cleanup can fail on already-deleted objects; continue with database cleanup.
        showInfo("Storage object was already removed; continuing with assessment cleanup.");
      }

      const response = await callApi(
        `/api/assessment-documents?assessment_document_id=${encodeURIComponent(document.id)}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to delete assessment document."));
      }
    },
    onMutate: (document) => {
      setDeletingAssessmentId(document.id);
      if (selectedAssessmentId === document.id) {
        setSelectedAssessmentId(null);
      }
    },
    onSuccess: (_, document) => {
      queryClient.setQueryData<AssessmentDocumentRecord[]>(assessmentDocumentsQueryKey, (current) => {
        const currentRecords = Array.isArray(current) ? current : [];
        return currentRecords.filter((record) => record.id !== document.id);
      });
      queryClient.removeQueries({
        queryKey: ["assessment-checklist", document.id, organizationId ?? "MISSING_ORG"],
      });
      queryClient.removeQueries({
        queryKey: ["assessment-drafts", document.id, organizationId ?? "MISSING_ORG"],
      });
      queryClient.invalidateQueries({
        queryKey: ["assessment-checklist", document.id, organizationId ?? "MISSING_ORG"],
      });
      queryClient.invalidateQueries({
        queryKey: ["assessment-drafts", document.id, organizationId ?? "MISSING_ORG"],
      });
      showSuccess(`Deleted ${document.file_name}.`);
    },
    onError: showError,
    onSettled: () => {
      setDeletingAssessmentId(null);
    },
  });

  const updateDraftProgram = useMutation({
    mutationFn: async (programId: string) => {
      const edit = draftProgramEdits[programId];
      if (!edit) {
        throw new Error("Program edit state not found.");
      }
      const response = await callApi("/api/assessment-drafts", {
        method: "PATCH",
        body: JSON.stringify({
          draft_type: "program",
          id: programId,
          accept_state: edit.acceptState,
          review_notes: edit.reviewNotes,
          name: edit.name,
          description: edit.description,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to update draft program.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["assessment-drafts", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
      });
      showSuccess("Program draft saved. Not published yet.");
    },
    onError: showError,
  });

  const updateDraftGoal = useMutation({
    mutationFn: async (goalId: string) => {
      const edit = draftGoalEdits[goalId];
      if (!edit) {
        throw new Error("Goal edit state not found.");
      }
      const objectiveDataPoints = parseObjectiveDataPointsInput(edit.objectiveDataPoints);
      const targetCriteria = formatGoalTimelineCriteria({
        shortTermGoal: edit.shortTermGoal,
        intermediateGoal: edit.intermediateGoal,
        longTermGoal: edit.longTermGoal,
      });
      const response = await callApi("/api/assessment-drafts", {
        method: "PATCH",
        body: JSON.stringify({
          draft_type: "goal",
          id: goalId,
          accept_state: edit.acceptState,
          review_notes: edit.reviewNotes,
          title: edit.title,
          description: edit.description,
          original_text: edit.originalText,
          goal_type: edit.goalType,
          measurement_type: edit.measurementType || undefined,
          baseline_data: edit.baselineData || undefined,
          target_criteria: targetCriteria || undefined,
          mastery_criteria: edit.masteryCriteria || undefined,
          maintenance_criteria: edit.maintenanceCriteria || undefined,
          generalization_criteria: edit.generalizationCriteria || undefined,
          objective_data_points: objectiveDataPoints,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to update draft goal.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["assessment-drafts", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
      });
      showSuccess("Goal draft saved. Not published yet.");
    },
    onError: showError,
  });

  const promoteAssessment = useMutation({
    mutationFn: async () => {
      if (!selectedAssessmentId) {
        throw new Error("Select an assessment before publishing.");
      }
      const response = await callApi("/api/assessment-promote", {
        method: "POST",
        body: JSON.stringify({ assessment_document_id: selectedAssessmentId }),
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to publish assessment drafts."));
      }
      return parseJson<AssessmentPromoteResponse>(response);
    },
    onSuccess: (result) => {
      if (result.completion_mode === "assessment_only") {
        queryClient.invalidateQueries({ queryKey: assessmentDocumentsQueryKey });
        queryClient.invalidateQueries({
          queryKey: ["assessment-checklist", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
        });
        showSuccess("Published reviewed assessment.");
        return;
      }
      const programCount = result.promoted_program_count ?? result.created_program_count;
      const goalCount = result.promoted_goal_count ?? result.created_goal_count;
      queryClient.invalidateQueries({ queryKey: clientProgramsQueryKey });
      queryClient.invalidateQueries({ queryKey: programGoalsQueryKey });
      queryClient.invalidateQueries({ queryKey: assessmentDocumentsQueryKey });
      queryClient.invalidateQueries({
        queryKey: ["assessment-drafts", selectedAssessmentId, organizationId ?? "MISSING_ORG"],
      });
      showSuccess(
        `Published to live records. Created ${programCount} production program${programCount === 1 ? "" : "s"} and ${goalCount} goal${goalCount === 1 ? "" : "s"}.`,
      );
    },
    onError: showError,
  });

  const generateAssessmentPlanPdf = useMutation({
    mutationFn: async () => {
      if (!selectedAssessmentId) {
        throw new Error("Select an assessment first.");
      }
      const response = await callApi("/api/assessment-plan-pdf", {
        method: "POST",
        body: JSON.stringify({ assessment_document_id: selectedAssessmentId }),
      });
      const result = await parseJson<AssessmentPlanPdfResponse>(response);
      if (!response.ok) {
        const blockers = result.preflight?.blockers ?? [];
        if (blockers.length > 0) {
          const blockerText = blockers
            .map((blocker) => blocker.key ?? (typeof blocker.count === "number" ? `${blocker.code} (${blocker.count})` : blocker.code))
            .join("; ");
          throw new Error(`IEHP preflight blockers: ${blockerText}`);
        }
        throw new Error("Unable to generate completed treatment plan. Ensure required checklist rows are approved.");
      }
      return result;
    },
    onSuccess: (result) => {
      if (typeof window !== "undefined" && result.signed_url) {
        window.open(result.signed_url, "_blank", "noopener,noreferrer");
      }
      if (result.generated_file_type === "docx") {
        showSuccess("Completed IEHP DOCX generated.");
        return;
      }
      const modeLabel =
        result.fill_mode === "acroform" ? "AcroForm" : result.fill_mode === "mixed" ? "mixed AcroForm/overlay" : "overlay";
      const overflowKeys = result.overflow_keys ?? result.layout_warnings?.map((warning) => warning.placeholder_key) ?? [];
      if (overflowKeys.length > 0) {
        showInfo(
          `Completed CalOptima PDF generated (${modeLabel} mode) with ${overflowKeys.length} layout warning(s). Review before sending.`,
        );
        return;
      }
      showSuccess(`Completed CalOptima PDF generated (${modeLabel} mode).`);
    },
    onError: showError,
  });

  const createProgram = useMutation({
    mutationFn: async () => {
      const payload = JSON.stringify({
        client_id: client.id,
        name: programNameValue,
        description: programDescription.trim() || undefined,
      });
      const response = await callEdgeWithSupabaseFallback({
        edgePath: PROGRAMS_EDGE_PATH,
        fallback: async () => {
          if (!organizationId) {
            return jsonResponse({ error: "Organization context is required." }, 400);
          }
          const { data, error } = await supabase
            .from("programs")
            .insert([
              {
                organization_id: organizationId,
                client_id: client.id,
                name: programNameValue,
                description: programDescription.trim() || null,
              },
            ])
            .select("id,organization_id,client_id,name,description,status,start_date,end_date,created_at,updated_at")
            .single();
          if (error) {
            return jsonResponse({ error: error.message }, 500);
          }
          return jsonResponse(data, 201);
        },
        init: {
          method: "POST",
          body: payload,
        },
        timeoutMs: PROGRAM_CREATE_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Create program request timed out. Please retry.",
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to create program."));
      }
      return parseJson<Program>(response);
    },
    onSuccess: (created) => {
      showSuccess("Program created");
      setProgramName("");
      setProgramDescription("");
      setSelectedProgramId(created.id);
      queryClient.setQueryData<Program[]>(clientProgramsQueryKey, (current) => upsertById(current, created));
    },
    onError: showError,
  });

  const createGoalDomain = useMutation({
    mutationFn: async () => {
      if (!organizationId) {
        throw new Error("Organization context is required to create a goal domain.");
      }
      if (!newGoalDomainNameValue) {
        throw new Error("New domain name is required.");
      }
      const { data, error } = await supabase
        .from("goal_domains")
        .insert([
          {
            organization_id: organizationId,
            name: newGoalDomainNameValue,
            status: "active",
          },
        ])
        .select("id,organization_id,name,description,status,created_at,updated_at")
        .single();
      if (error) {
        throw new Error(error.message);
      }
      return data as GoalDomain;
    },
    onSuccess: (createdDomain) => {
      queryClient.setQueryData<GoalDomain[]>(goalDomainsQueryKey, (current) =>
        upsertById(current, createdDomain).sort((left, right) => left.name.localeCompare(right.name)),
      );
      setGoalDomainId(createdDomain.id);
      setNewGoalDomainName("");
      showSuccess("Goal domain created");
    },
    onError: showError,
  });

  const createGoal = useMutation({
    mutationFn: async () => {
      if (!resolvedProgramId) {
        throw new Error("Select a program first");
      }
      const objectiveDataPoints = parseObjectiveDataPointsInput(goalObjectiveDataPoints);
      const targetCriteria = formatGoalTimelineCriteria({
        shortTermGoal: goalShortTermGoal,
        intermediateGoal: goalIntermediateGoal,
        longTermGoal: goalLongTermGoal,
      });
      const resolvedDomainId = goalDomainId.trim() || undefined;
      const payload = JSON.stringify({
        client_id: client.id,
        program_id: resolvedProgramId,
        title: goalTitleValue,
        description: goalDescriptionValue,
        original_text: goalOriginalTextValue,
        measurement_type: goalMeasurementType || undefined,
        clinical_goal_type: goalClinicalGoalType || undefined,
        domain_id: resolvedDomainId,
        source: goalSource,
        baseline_data: goalBaselineData || undefined,
        baseline: goalBaselineData || undefined,
        teaching_strategies: goalTeachingStrategies || undefined,
        operational_definition: goalOperationalDefinition || undefined,
        target_criteria: targetCriteria || undefined,
        mastery_criteria: goalMasteryCriteria || undefined,
        maintenance_criteria: goalMaintenanceCriteria || undefined,
        generalization_criteria: goalGeneralizationCriteria || undefined,
        objective_data_points: objectiveDataPoints,
      });
      const response = await callEdgeWithSupabaseFallback({
        edgePath: GOALS_EDGE_PATH,
        fallback: async () => {
          if (!organizationId) {
            return jsonResponse({ error: "Organization context is required." }, 400);
          }
          const { data, error } = await supabase
            .from("goals")
            .insert([
              {
                organization_id: organizationId,
                client_id: client.id,
                program_id: resolvedProgramId,
                title: goalTitleValue,
                description: goalDescriptionValue,
                original_text: goalOriginalTextValue,
                measurement_type: goalMeasurementType || null,
                clinical_goal_type: goalClinicalGoalType || null,
                domain_id: resolvedDomainId ?? null,
                source: goalSource,
                baseline_data: goalBaselineData || null,
                baseline: goalBaselineData || null,
                teaching_strategies: goalTeachingStrategies || null,
                operational_definition: goalOperationalDefinition || null,
                target_criteria: targetCriteria || null,
                mastery_criteria: goalMasteryCriteria || null,
                maintenance_criteria: goalMaintenanceCriteria || null,
                generalization_criteria: goalGeneralizationCriteria || null,
                objective_data_points: objectiveDataPoints,
              },
            ])
            .select(
              "id,organization_id,client_id,program_id,domain_id,title,description,target_behavior,measurement_type,original_text,goal_type,clinical_goal_type,clinical_context,baseline_data,baseline,target_criteria,mastery_criteria,maintenance_criteria,generalization_criteria,teaching_strategies,operational_definition,objective_data_points,source,status,created_at,updated_at",
            )
            .single();
          if (error) {
            return jsonResponse({ error: error.message }, 500);
          }
          return jsonResponse(data, 201);
        },
        init: {
          method: "POST",
          body: payload,
        },
        timeoutMs: GOAL_CREATE_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Create goal request timed out. Please retry.",
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to create goal."));
      }
      return parseJson<Goal>(response);
    },
    onSuccess: (created) => {
      showSuccess("Goal created");
      setGoalTitle("");
      setGoalDescription("");
      setGoalOriginalText("");
      setGoalMeasurementType("");
      setGoalClinicalGoalType("skill");
      setGoalDomainId("");
      setNewGoalDomainName("");
      setGoalSource("manual");
      setGoalBaselineData("");
      setGoalTeachingStrategies("");
      setGoalOperationalDefinition("");
      setGoalShortTermGoal("");
      setGoalIntermediateGoal("");
      setGoalLongTermGoal("");
      setGoalMasteryCriteria("");
      setGoalMaintenanceCriteria("");
      setGoalGeneralizationCriteria("");
      setGoalObjectiveDataPoints("[]");
      queryClient.setQueryData<Goal[]>(buildProgramGoalsQueryKey(created.program_id, organizationId), (current) =>
        upsertById(current, created),
      );
    },
    onError: showError,
  });

  const createGoalTarget = useMutation({
    mutationFn: async () => {
      const response = await callEdgeFunctionHttp(GOAL_TARGETS_EDGE_PATH, {
        method: "POST",
        body: JSON.stringify({
          goal_id: targetGoalId,
          name: targetNameValue,
          measurement_type: targetMeasurementType,
          status: targetStatus,
          graph_config: buildGoalTargetGraphConfig(targetMeasurementType),
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to create target."));
      }
      return parseJson<GoalTarget>(response);
    },
    onSuccess: (created) => {
      showSuccess("Target created");
      setTargetName("");
      setTargetMeasurementType("correctIncorrect");
      setTargetStatus("active");
      queryClient.setQueryData<GoalTarget[]>(goalTargetsQueryKey, (current) => upsertById(current, created));
      queryClient.invalidateQueries({ queryKey: goalTargetsQueryKey });
    },
    onError: showError,
  });

  const updateGoalTarget = useMutation({
    mutationFn: async ({
      target,
      name,
      measurement_type,
      status,
      graph_config,
    }: {
      target: GoalTarget;
      name: string;
      measurement_type: TargetMeasurementType;
      status: GoalTarget["status"];
      graph_config?: Record<string, unknown>;
    }) => {
      const response = await callEdgeFunctionHttp(`${GOAL_TARGETS_EDGE_PATH}?target_id=${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          measurement_type,
          status,
          ...(graph_config ? { graph_config } : {}),
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to update target."));
      }
      return parseJson<GoalTarget>(response);
    },
    onMutate: ({ target }) => {
      setUpdatingTargetId(target.id);
    },
    onSuccess: (updated) => {
      showSuccess("Target updated");
      queryClient.setQueryData<GoalTarget[]>(goalTargetsQueryKey, (current) =>
        mapById(current, updated.id, (currentTarget) => ({ ...currentTarget, ...updated })),
      );
      queryClient.invalidateQueries({ queryKey: goalTargetsQueryKey });
    },
    onError: showError,
    onSettled: () => {
      setUpdatingTargetId(null);
    },
  });

  const setGoalTargetArchiveState = useMutation({
    mutationFn: async ({
      target,
      status,
    }: {
      target: GoalTarget;
      status: "active" | "archived";
    }) => {
      const response = await callEdgeFunctionHttp(
        `${GOAL_TARGETS_EDGE_PATH}?target_id=${encodeURIComponent(target.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        },
      );
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, `Failed to ${status === "archived" ? "archive" : "restore"} target.`));
      }
      return parseJson<GoalTarget>(response);
    },
    onMutate: ({ target }) => {
      setLifecycleTargetId(target.id);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<GoalTarget[]>(goalTargetsQueryKey, (current) =>
        mapById(current, updated.id, (currentTarget) => ({ ...currentTarget, ...updated })),
      );
      showSuccess(updated.status === "archived" ? "Target archived" : "Target restored");
    },
    onError: showError,
    onSettled: () => {
      setLifecycleTargetId(null);
    },
  });

  const deleteGoalTarget = useMutation({
    mutationFn: async (target: GoalTarget) => {
      const response = await callEdgeFunctionHttp(
        `${GOAL_TARGETS_EDGE_PATH}?target_id=${encodeURIComponent(target.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to delete target."));
      }
      return target;
    },
    onMutate: (target) => {
      setDeletingTargetId(target.id);
    },
    onSuccess: (deleted) => {
      queryClient.setQueryData<GoalTarget[]>(goalTargetsQueryKey, (current) =>
        (current ?? []).filter((target) => target.id !== deleted.id),
      );
      showSuccess(`Target "${deleted.name}" deleted`);
    },
    onError: showError,
    onSettled: () => {
      setDeletingTargetId(null);
    },
  });

  const archiveProgram = useMutation({
    mutationFn: async (program: Program) => {
      const response = await callEdgeWithSupabaseFallback({
        edgePath: `${PROGRAMS_EDGE_PATH}?program_id=${encodeURIComponent(program.id)}`,
        fallback: async () => {
          if (!organizationId) {
            return jsonResponse({ error: "Organization context is required." }, 400);
          }
          const { error } = await supabase
            .from("programs")
            .update({ status: "archived" })
            .eq("id", program.id)
            .eq("organization_id", organizationId);
          if (error) {
            return jsonResponse({ error: error.message }, 500);
          }
          return jsonResponse({ ok: true });
        },
        init: {
          method: "PATCH",
          body: JSON.stringify({ status: "archived" }),
        },
        timeoutMs: PROGRAM_CREATE_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Archive program request timed out. Please retry.",
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to remove program."));
      }
    },
    onMutate: (program) => {
      setArchivingProgramId(program.id);
    },
    onSuccess: (_, program) => {
      showSuccess(`Program "${program.name}" removed from active care plan.`);
      if (selectedProgramId === program.id) {
        setSelectedProgramId(null);
      }
      queryClient.setQueryData<Program[]>(clientProgramsQueryKey, (current) =>
        mapById(current, program.id, (currentProgram) => ({ ...currentProgram, status: "archived" })),
      );
    },
    onError: showError,
    onSettled: () => {
      setArchivingProgramId(null);
    },
  });

  const archiveGoal = useMutation({
    mutationFn: async (goal: Goal) => {
      const response = await callEdgeWithSupabaseFallback({
        edgePath: `${GOALS_EDGE_PATH}?goal_id=${encodeURIComponent(goal.id)}`,
        fallback: async () => {
          if (!organizationId) {
            return jsonResponse({ error: "Organization context is required." }, 400);
          }
          const { error } = await supabase
            .from("goals")
            .update({ status: "archived" })
            .eq("id", goal.id)
            .eq("organization_id", organizationId);
          if (error) {
            return jsonResponse({ error: error.message }, 500);
          }
          return jsonResponse({ ok: true });
        },
        init: {
          method: "PATCH",
          body: JSON.stringify({ status: "archived" }),
        },
        timeoutMs: GOAL_CREATE_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Archive goal request timed out. Please retry.",
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to remove goal."));
      }
    },
    onMutate: (goal) => {
      setArchivingGoalId(goal.id);
    },
    onSuccess: (_, goal) => {
      showSuccess(`Goal "${goal.title}" removed from active care plan.`);
      queryClient.setQueryData<Goal[]>(buildProgramGoalsQueryKey(goal.program_id, organizationId), (current) =>
        mapById(current, goal.id, (currentGoal) => ({ ...currentGoal, status: "archived" })),
      );
    },
    onError: showError,
    onSettled: () => {
      setArchivingGoalId(null);
    },
  });

  const createNote = useMutation({
    mutationFn: async () => {
      if (!resolvedProgramId) {
        throw new Error("Select a program first");
      }
      const payload = JSON.stringify({
        program_id: resolvedProgramId,
        note_type: noteType,
        content: { text: noteContent },
      });
      const response = await callEdgeWithSupabaseFallback({
        edgePath: PROGRAM_NOTES_EDGE_PATH,
        fallback: async () => {
          if (!organizationId) {
            return jsonResponse({ error: "Organization context is required." }, 400);
          }
          const { data, error } = await supabase
            .from("program_notes")
            .insert([
              {
                organization_id: organizationId,
                program_id: resolvedProgramId,
                author_id: session?.user?.id ?? null,
                note_type: noteType,
                content: { text: noteContent },
              },
            ])
            .select("id,organization_id,program_id,author_id,note_type,content,created_at,updated_at")
            .single();
          if (error) {
            return jsonResponse({ error: error.message }, 500);
          }
          return jsonResponse(data, 201);
        },
        init: {
          method: "POST",
          body: payload,
        },
        timeoutMs: PROGRAM_NOTE_CREATE_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Program note request timed out. Please retry.",
      });
      if (!response.ok) {
        throw new Error("Failed to add program note");
      }
      return parseJson<ProgramNote>(response);
    },
    onSuccess: (created) => {
      showSuccess("Program note added");
      setNoteContent("");
      queryClient.setQueryData<ProgramNote[]>(buildProgramNotesQueryKey(created.program_id, organizationId), (current) =>
        upsertById(current, created),
      );
    },
    onError: showError,
  });

  if (!organizationId) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100">
        Organization context is required to manage programs and goals.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-sky-900 dark:border-sky-700/60 dark:bg-sky-900/20 dark:text-sky-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            Live care plan: <span className="font-semibold">{livePrograms.length}</span> program(s) and{" "}
            <span className="font-semibold">{liveGoals.length}</span> active goal(s) in the selected program.
          </p>
          {showDraftReviewPanel && hasDraftsButNoLivePrograms && (
            <button
              type="button"
              onClick={() => publishSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="rounded-md border border-sky-300 bg-white px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:bg-sky-900/50"
            >
              Review and publish drafts
            </button>
          )}
        </div>
        {showDraftReviewPanel && hasDraftsButNoLivePrograms && (
          <p className="mt-2 text-xs text-sky-800/90 dark:text-sky-100/90">
            Uploaded assessments and draft proposals stay in review until you publish them to live Programs & Goals.
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div ref={publishSectionRef} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
              <UploadCloud className="w-4 h-4" />
              {uploadAssessmentTemplateLabel} Upload Workflow
            </h3>
            <div className="space-y-3">
              <label htmlFor="programs-goals-fba-template" className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                FBA template
              </label>
              <select
                id="programs-goals-fba-template"
                value={assessmentTemplateType}
                onChange={(event) => setAssessmentTemplateType(event.target.value as AssessmentTemplateType)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              >
                <option value="caloptima_fba">CalOptima FBA</option>
                <option value="iehp_fba">IEHP FBA</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-300">
                Select the assessment template that matches the uploaded source document.
              </p>
              <label htmlFor="programs-goals-fba-file-upload" className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                FBA file (PDF or DOCX)
              </label>
              <input
                id="programs-goals-fba-file-upload"
                type="file"
                accept=".pdf,.docx"
                onChange={(event) => handleAssessmentFileChange(event.target.files?.[0] ?? null)}
                className="w-full text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  void handleUploadAssessment();
                }}
                disabled={!assessmentFile || isUploadProcessing}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {isUploadProcessing ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Uploading and processing...
                  </span>
                ) : (
                  `Upload ${uploadAssessmentTemplateLabel}`
                )}
              </button>
              {isUploadProcessing && (
                <p className="text-xs text-gray-500 dark:text-gray-300" role="status" aria-live="polite">
                  Uploading and processing your FBA. This can take a moment.
                </p>
              )}
              <div className="rounded-md border border-gray-200 dark:border-gray-700 p-2 max-h-48 overflow-auto">
                {assessmentLoading ? (
                  <p className="text-xs text-gray-500">Loading assessment queue...</p>
                ) : assessmentDocuments.length === 0 ? (
                  <p className="text-xs text-gray-500">No uploaded assessments yet.</p>
                ) : (
                  <div className="space-y-2">
                    {assessmentDocuments.map((doc) => (
                      <div
                        key={doc.id}
                        className={`w-full rounded border text-xs ${
                          selectedAssessmentId === doc.id
                            ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
                            : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
                        } ${
                          doc.status === "extracting" || doc.status === "extraction_running"
                            ? "border-amber-300 bg-amber-50/40 dark:border-amber-700/60 dark:bg-amber-900/20"
                            : ""
                        }`}
                      >
                        <button type="button" onClick={() => setSelectedAssessmentId(doc.id)} className="w-full text-left px-2 pt-2">
                          <div className="font-medium">{doc.file_name}</div>
                          <div className="mt-1 flex items-center gap-1 text-[11px] opacity-90">
                            <span>{TEMPLATE_LABELS[doc.template_type]} •</span>
                            <span className={`rounded px-1.5 py-0.5 font-semibold ${statusToneByAssessment[doc.status].className}`}>
                              {statusToneByAssessment[doc.status].label}
                            </span>
                            <span>• {new Date(doc.created_at).toLocaleDateString()}</span>
                          </div>
                          {(doc.status === "extracting" || doc.status === "extraction_running") && (
                            <div
                              className="mt-1 inline-flex animate-pulse items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300"
                              role="status"
                              aria-live="polite"
                            >
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                              Extracting fields from uploaded file...
                            </div>
                          )}
                          {doc.status === "extraction_failed" && (
                            <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                              {doc.extraction_error ?? "Extraction failed. Review checklist manually."}
                            </div>
                          )}
                          {doc.status !== "extraction_failed" && doc.extraction_error && (
                            <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                              {doc.extraction_error}
                            </div>
                          )}
                        </button>
                        <div className="px-2 pb-2 pt-1 flex justify-end">
                          <button
                            type="button"
                            aria-label={`Delete ${doc.file_name}`}
                            title={`Delete ${doc.file_name}`}
                            onClick={() => {
                              if (typeof window !== "undefined") {
                                const confirmed = window.confirm(`Delete ${doc.file_name}? This cannot be undone.`);
                                if (!confirmed) {
                                  return;
                                }
                              }
                              deleteAssessmentDocument.mutate(doc);
                            }}
                            disabled={deletingAssessmentId === doc.id && deleteAssessmentDocument.isLoading}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 dark:text-rose-300 dark:hover:bg-rose-900/30 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {deletingAssessmentId === doc.id && deleteAssessmentDocument.isLoading ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => generateAssessmentPlanPdf.mutate()}
                disabled={!canQuerySelectedAssessment || hasPendingRequiredExportItems || generateAssessmentPlanPdf.isLoading}
                title={
                  hasPendingRequiredExportItems
                      ? "Approve all required checklist and structured fields before export."
                      : undefined
                }
                className="w-full px-3 py-2 text-sm font-medium text-white bg-violet-600 rounded-md hover:bg-violet-700 disabled:opacity-50"
              >
                {generateAssessmentPlanPdf.isLoading ? "Generating..." : exportAssessmentPdfLabel}
              </button>
              </div>
            </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Programs</h3>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-300">
              Live records only. Uploaded assessments stay in structured review until you add live programs manually.
            </p>
            <div className="space-y-2">
              {programsLoading && (
                <div
                  className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-100"
                  role="status"
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Loading existing programs. You can still add a new program below.</span>
                </div>
              )}
              {livePrograms.length === 0 && (
                <p className="text-sm text-gray-500">
                  {programsLoading
                    ? "No existing programs loaded yet."
                    : "No programs yet. Create a program to unlock goals and notes for this client."}
                </p>
              )}
              {livePrograms.map((program) => (
                <div key={program.id} className="flex items-stretch gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedProgramId(program.id)}
                    className={`min-w-0 flex-1 text-left rounded-md px-3 py-2 text-sm border ${
                      resolvedProgramId === program.id
                        ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
                        : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    <div className="font-medium">{program.name}</div>
                    {program.description && (
                      <div className="text-xs text-gray-500 mt-1 line-clamp-2">{program.description}</div>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${program.name}`}
                    title="Remove from active care plan"
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        const confirmed = window.confirm(
                          `Remove "${program.name}" from the active care plan? You can add programs again later.`,
                        );
                        if (!confirmed) {
                          return;
                        }
                      }
                      archiveProgram.mutate(program);
                    }}
                    disabled={archivingProgramId === program.id && archiveProgram.isLoading}
                    className="shrink-0 rounded-md border border-transparent px-2 py-2 text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-900/30 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add Program
            </h3>
            <div className="space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-300">
                Add a program first if this client does not have one yet. Goals and notes attach to the selected program.
              </p>
              <input
                type="text"
                value={programName}
                onChange={(event) => setProgramName(event.target.value)}
                placeholder="Program name"
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <textarea
                value={programDescription}
                onChange={(event) => setProgramDescription(event.target.value)}
                placeholder="Program description"
                rows={3}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <button
                type="button"
                onClick={() => createProgram.mutate()}
                disabled={!programNameValue || createProgram.isLoading}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {createProgram.isLoading ? "Creating..." : "Create Program"}
              </button>
              {programsQueryError instanceof Error && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Could not load programs yet: {programsQueryError.message}
                </p>
              )}
              {!createProgram.isLoading && !programNameValue && (
                <p className="text-xs text-gray-500 dark:text-gray-300">Enter a program name to create a program.</p>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {ENABLE_CHECKLIST_MAPPING_UI && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
                {selectedAssessmentTemplateLabel} Checklist Review
              </h3>
              {selectedAssessmentDocument && (
                <div className="mb-3 space-y-2 text-xs text-gray-500 dark:text-gray-300">
                  <p>
                    Document status:{" "}
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${statusToneByAssessment[selectedAssessmentDocument.status].className}`}>
                      {statusToneByAssessment[selectedAssessmentDocument.status].label}
                    </span>
                    {" • "}
                    Unresolved required rows: {unresolvedRequiredCount}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded border border-gray-200 px-2 py-1 dark:border-gray-700">
                      Checklist values: <span className="font-semibold">{extractedChecklistValueCount}/{checklistItems.length}</span>
                    </div>
                    <div className="rounded border border-gray-200 px-2 py-1 dark:border-gray-700">
                      Child goals: <span className="font-semibold">{structuredChildGoalCount}</span>
                    </div>
                    <div className="rounded border border-gray-200 px-2 py-1 dark:border-gray-700">
                      Parent goals: <span className="font-semibold">{structuredParentGoalCount}</span>
                    </div>
                  </div>
                </div>
              )}
              {!selectedAssessmentId ? (
                <p className="text-sm text-gray-500">Upload and select an assessment to review checklist items.</p>
              ) : checklistItemsLoading ? (
                <p className="text-sm text-gray-500">Loading checklist review...</p>
              ) : checklistItemsError ? (
                <p className="text-sm text-rose-600 dark:text-rose-300">
                  Checklist review failed to load. Publishing stays blocked until checklist rows can be reviewed.
                </p>
              ) : selectedAssessmentIsIehp && selectedAssessmentDocument ? (
                <div className="space-y-4">
                  <IehpFbaLayoutReview
                    assessmentDocument={selectedAssessmentDocument}
                    organizationId={organizationId}
                  />
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900/60 dark:bg-emerald-950/20">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-1">
                        <p className="font-semibold text-emerald-900 dark:text-emerald-100">Publish reviewed IEHP assessment</p>
                        <p className="text-xs text-emerald-800 dark:text-emerald-200">
                          This completes the review workflow and locks the approved extraction as the published assessment record.
                        </p>
                        {iehpPublishDisabledReason && (
                          <p className="text-xs text-amber-700 dark:text-amber-200">{iehpPublishDisabledReason}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof window !== "undefined") {
                            const confirmed = window.confirm(
                              "Publish this reviewed IEHP assessment and complete the workflow?",
                            );
                            if (!confirmed) {
                              return;
                            }
                          }
                          promoteAssessment.mutate();
                        }}
                        disabled={Boolean(iehpPublishDisabledReason) || promoteAssessment.isLoading}
                        className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {promoteAssessment.isLoading ? "Publishing..." : "Publish Reviewed Assessment"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : checklistBySection.length === 0 && structuredSectionsBySection.length === 0 ? (
                <p className="text-sm text-gray-500">Checklist not available yet for this assessment.</p>
              ) : (
                <div className="space-y-4">
                  {checklistBySection.map(([section, rows]) => (
                    <div key={section} className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-2">
                        {section.replace(/_/g, " ")}
                      </h4>
                      <div className="space-y-3">
                        {rows.map((row) => {
                          const edit = checklistEdits[row.id] ?? {
                            status: row.status,
                            reviewNotes: row.review_notes ?? "",
                            valueText: row.value_text ?? "",
                          };
                          const isApprovedStatusLocked = row.status === "approved";
                          return (
                            <div key={row.id} className="rounded border border-gray-200 dark:border-gray-700 p-2">
                              <div className="text-xs font-medium text-gray-800 dark:text-gray-200">{row.label}</div>
                              <div className="text-[11px] text-gray-500 mb-2">
                                {row.placeholder_key} • {row.mode} • required: {String(row.required)}
                                {row.review_notes ? ` • ${row.review_notes}` : ""}
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                <select
                                  value={edit.status}
                                  disabled={isApprovedStatusLocked}
                                  onChange={(event) =>
                                    setChecklistEdits((current) => ({
                                      ...current,
                                      [row.id]: {
                                        ...edit,
                                        status: event.target.value as AssessmentChecklistItem["status"],
                                      },
                                    }))
                                  }
                                  className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                                >
                                  <option value="not_started">not_started</option>
                                  <option value="drafted">drafted</option>
                                  <option value="verified">verified</option>
                                  <option value="approved">approved</option>
                                </select>
                                <input
                                  value={edit.reviewNotes}
                                  onChange={(event) =>
                                    setChecklistEdits((current) => ({
                                      ...current,
                                      [row.id]: {
                                        ...edit,
                                        reviewNotes: event.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="Review notes"
                                  className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                                />
                                <input
                                  value={edit.valueText}
                                  onChange={(event) =>
                                    setChecklistEdits((current) => ({
                                      ...current,
                                      [row.id]: {
                                        ...edit,
                                        valueText: event.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="Field value"
                                  className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => updateChecklistItem.mutate(row.id)}
                                disabled={updateChecklistItem.isLoading}
                                className="mt-2 px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                              >
                                Save Checklist Row
                              </button>
                              {isApprovedStatusLocked && (
                                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-300">
                                  Approved checklist rows stay approved; update notes or field value without lowering status.
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      Structured {selectedAssessmentTemplateLabel} Sections
                    </h4>
                    {structuredSectionsBySection.length === 0 ? (
                      <p className="text-sm text-gray-500">No structured sections available yet for this assessment.</p>
                    ) : (
                      structuredSectionsBySection.map(([section, rows]) => (
                        <div key={section} className="rounded-md border border-cyan-200 dark:border-cyan-900/60 p-3">
                          <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-2">
                            {section.replace(/_/g, " ")}
                          </h5>
                          <div className="space-y-3">
                            {rows.map((row) => {
                              const edit = structuredSectionEdits[row.id] ?? {
                                status: row.status,
                                reviewNotes: row.review_notes ?? "",
                                payload: formatStructuredSectionPayload(row.payload),
                              };
                              const previewLines = buildStructuredPayloadPreview(row.payload ?? {});
                              const isApprovedStatusLocked = row.status === "approved";
                              return (
                                <div key={row.id} className="rounded border border-gray-200 dark:border-gray-700 p-2">
                                  <div className="text-xs font-medium text-gray-800 dark:text-gray-200">
                                    {humanizeStructuredSectionLabel(row)} #{row.section_index + 1}
                                  </div>
                                  <div className="text-[11px] text-gray-500 dark:text-gray-300">{row.field_key}</div>
                                  <div className="text-[11px] text-gray-500 mb-2">
                                    required: {String(row.required)}
                                    {row.review_notes ? ` • ${row.review_notes}` : ""}
                                  </div>
                                  {previewLines.length > 0 && (
                                    <div className="mb-2 rounded bg-gray-50 p-2 text-xs text-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
                                      <div className="mb-1 font-semibold">Extracted preview</div>
                                      <ul className="space-y-1">
                                        {previewLines.map((line, index) => (
                                          <li key={`${row.id}-preview-${index}`} className="break-words">
                                            {line}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  <div className="grid grid-cols-1 gap-2">
                                    <select
                                      value={edit.status}
                                      disabled={isApprovedStatusLocked}
                                      onChange={(event) =>
                                        setStructuredSectionEdits((current) => ({
                                          ...current,
                                          [row.id]: {
                                            ...edit,
                                            status: event.target.value as AssessmentStructuredSection["status"],
                                          },
                                        }))
                                      }
                                      className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                                    >
                                      <option value="not_started">not_started</option>
                                      <option value="drafted">drafted</option>
                                      <option value="verified">verified</option>
                                      <option value="approved">approved</option>
                                      <option value="rejected">rejected</option>
                                    </select>
                                    <input
                                      value={edit.reviewNotes}
                                      disabled={isApprovedStatusLocked}
                                      onChange={(event) =>
                                        setStructuredSectionEdits((current) => ({
                                          ...current,
                                          [row.id]: {
                                            ...edit,
                                            reviewNotes: event.target.value,
                                          },
                                        }))
                                      }
                                      placeholder="Review notes"
                                      className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                                    />
                                    <textarea
                                      value={edit.payload}
                                      rows={8}
                                      disabled={isApprovedStatusLocked}
                                      onChange={(event) =>
                                        setStructuredSectionEdits((current) => ({
                                          ...current,
                                          [row.id]: {
                                            ...edit,
                                            payload: event.target.value,
                                          },
                                        }))
                                      }
                                      className="font-mono rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-xs"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => updateStructuredSection.mutate(row.id)}
                                    disabled={updateStructuredSection.isLoading || isApprovedStatusLocked}
                                    className="mt-2 px-3 py-1 text-xs font-medium text-white bg-cyan-700 rounded hover:bg-cyan-800 disabled:opacity-50"
                                  >
                                    Save Structured Section
                                  </button>
                                  {isApprovedStatusLocked && (
                                    <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-300">
                                      Approved structured sections are locked to preserve reviewed document data for export.
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {showDraftReviewPanel && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
              Draft Review (Approve / Reject / Edit)
            </h3>
            <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300" role="status" aria-live="polite">
              {hasStagedDraftChanges
                ? "Draft changes pending publication."
                : selectedAssessmentAlreadyPublished
                  ? "Drafts retained after publication."
                  : "All changes published."}
            </p>
            {selectedAssessmentDocument && (
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-300">
                Selected assessment: {selectedAssessmentDocument.file_name}
              </p>
            )}
            {!selectedAssessmentId ? (
              <p className="text-sm text-gray-500">Select an assessment to review its draft program and goals.</p>
            ) : (
              <div className="space-y-4">
                {(assessmentDrafts?.programs ?? []).map((program) => {
                  const edit = draftProgramEdits[program.id] ?? {
                    acceptState: program.accept_state,
                    reviewNotes: program.review_notes ?? "",
                    name: program.name,
                    description: program.description ?? "",
                  };
                  return (
                    <div key={program.id} className="rounded border border-gray-200 dark:border-gray-700 p-3">
                      <p className="text-xs font-semibold mb-2">Draft Program</p>
                      <div className="grid grid-cols-1 gap-2">
                        <input
                          value={edit.name}
                          onChange={(event) =>
                            setDraftProgramEdits((current) => ({
                              ...current,
                              [program.id]: {
                                ...edit,
                                name: event.target.value,
                              },
                            }))
                          }
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <textarea
                          value={edit.description}
                          onChange={(event) =>
                            setDraftProgramEdits((current) => ({
                              ...current,
                              [program.id]: {
                                ...edit,
                                description: event.target.value,
                              },
                            }))
                          }
                          rows={2}
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <select
                            value={edit.acceptState}
                            onChange={(event) =>
                              setDraftProgramEdits((current) => ({
                                ...current,
                                [program.id]: {
                                  ...edit,
                                  acceptState: event.target.value as AssessmentDraftProgram["accept_state"],
                                },
                              }))
                            }
                            className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                          >
                            <option value="pending">pending</option>
                            <option value="accepted">accepted</option>
                            <option value="rejected">rejected</option>
                            <option value="edited">edited</option>
                          </select>
                          <input
                            value={edit.reviewNotes}
                            onChange={(event) =>
                              setDraftProgramEdits((current) => ({
                                ...current,
                                [program.id]: {
                                  ...edit,
                                  reviewNotes: event.target.value,
                                },
                              }))
                            }
                            placeholder="Program review notes"
                            className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateDraftProgram.mutate(program.id)}
                        disabled={updateDraftProgram.isLoading}
                        className="mt-2 px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        Save Program Draft
                      </button>
                      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-300">
                        {draftSaveHelperText}
                      </p>
                    </div>
                  );
                })}

                {(assessmentDrafts?.goals ?? []).map((goal) => {
                  const parsedTargetCriteria = parseGoalTimelineCriteria(goal.target_criteria);
                  const edit = draftGoalEdits[goal.id] ?? {
                    acceptState: goal.accept_state,
                    reviewNotes: goal.review_notes ?? "",
                    title: goal.title,
                    description: goal.description,
                    originalText: goal.original_text,
                    goalType: goal.goal_type,
                    measurementType: goal.measurement_type ?? "",
                    baselineData: goal.baseline_data ?? "",
                    shortTermGoal: parsedTargetCriteria.shortTermGoal,
                    intermediateGoal: parsedTargetCriteria.intermediateGoal,
                    longTermGoal: parsedTargetCriteria.longTermGoal,
                    masteryCriteria: goal.mastery_criteria ?? "",
                    maintenanceCriteria: goal.maintenance_criteria ?? "",
                    generalizationCriteria: goal.generalization_criteria ?? "",
                    objectiveDataPoints: JSON.stringify(goal.objective_data_points ?? [], null, 2),
                  };
                  return (
                    <div key={goal.id} className="rounded border border-gray-200 dark:border-gray-700 p-3">
                      <p className="text-xs font-semibold mb-2">Draft Goal</p>
                      <div className="grid grid-cols-1 gap-2">
                        <input
                          value={edit.title}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                title: event.target.value,
                              },
                            }))
                          }
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <textarea
                          value={edit.description}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                description: event.target.value,
                              },
                            }))
                          }
                          rows={2}
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <textarea
                          value={edit.originalText}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                originalText: event.target.value,
                              },
                            }))
                          }
                          rows={2}
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <select
                          value={edit.goalType}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                goalType: event.target.value as AssessmentDraftGoal["goal_type"],
                              },
                            }))
                          }
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        >
                          <option value="child">child goal</option>
                          <option value="parent">parent goal</option>
                        </select>
                        <input
                          value={edit.measurementType}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                measurementType: event.target.value,
                              },
                            }))
                          }
                          placeholder="Measurement type"
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <textarea
                          value={edit.baselineData}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                baselineData: event.target.value,
                              },
                            }))
                          }
                          placeholder="Baseline data"
                          rows={2}
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        {GOAL_TIMELINE_INPUTS.map(({ key, placeholder }) => (
                          <textarea
                            key={`${goal.id}-${key}`}
                            value={edit[key]}
                            onChange={(event) =>
                              setDraftGoalEdits((current) => ({
                                ...current,
                                [goal.id]: {
                                  ...edit,
                                  [key]: event.target.value,
                                },
                              }))
                            }
                            placeholder={placeholder}
                            rows={2}
                            className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                          />
                        ))}
                        <textarea
                          value={edit.masteryCriteria}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                masteryCriteria: event.target.value,
                              },
                            }))
                          }
                          placeholder="Mastery criteria"
                          rows={2}
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <textarea
                          value={edit.maintenanceCriteria}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                maintenanceCriteria: event.target.value,
                              },
                            }))
                          }
                          placeholder="Maintenance criteria"
                          rows={2}
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <textarea
                          value={edit.generalizationCriteria}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                generalizationCriteria: event.target.value,
                              },
                            }))
                          }
                          placeholder="Generalization criteria"
                          rows={2}
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                        />
                        <textarea
                          value={edit.objectiveDataPoints}
                          onChange={(event) =>
                            setDraftGoalEdits((current) => ({
                              ...current,
                              [goal.id]: {
                                ...edit,
                                objectiveDataPoints: event.target.value,
                              },
                            }))
                          }
                          placeholder="Objective data points JSON array"
                          rows={3}
                          className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm font-mono"
                        />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <select
                            value={edit.acceptState}
                            onChange={(event) =>
                              setDraftGoalEdits((current) => ({
                                ...current,
                                [goal.id]: {
                                  ...edit,
                                  acceptState: event.target.value as AssessmentDraftGoal["accept_state"],
                                },
                              }))
                            }
                            className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                          >
                            <option value="pending">pending</option>
                            <option value="accepted">accepted</option>
                            <option value="rejected">rejected</option>
                            <option value="edited">edited</option>
                          </select>
                          <input
                            value={edit.reviewNotes}
                            onChange={(event) =>
                              setDraftGoalEdits((current) => ({
                                ...current,
                                [goal.id]: {
                                  ...edit,
                                  reviewNotes: event.target.value,
                                },
                              }))
                            }
                            placeholder="Goal review notes"
                            className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-sm"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateDraftGoal.mutate(goal.id)}
                        disabled={updateDraftGoal.isLoading}
                        className="mt-2 px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        Save Goal Draft
                      </button>
                      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-300">
                        {draftSaveHelperText}
                      </p>
                    </div>
                  );
                })}

                {(assessmentDrafts?.programs?.length ?? 0) === 0 && (assessmentDrafts?.goals?.length ?? 0) === 0 && (
                  <p className="text-sm text-gray-500">No staged drafts yet. Generate then save drafts to assessment.</p>
                )}
                {selectedAssessmentId && hasExistingDrafts && (
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-900/40">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-1">
                        <p className="font-semibold text-gray-800 dark:text-gray-100">Publish accepted drafts to live Programs & Goals</p>
                        <p className="text-xs text-gray-600 dark:text-gray-300">
                          Accepted drafts: {acceptedDraftProgramCount} program(s), {acceptedDraftGoalCount} goal(s). Pending drafts:{" "}
                          {pendingDraftProgramCount} program(s), {pendingDraftGoalCount} goal(s).
                        </p>
                        {promoteDisabledReason && (
                          <p className="text-xs text-amber-700 dark:text-amber-200">{promoteDisabledReason}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof window !== "undefined") {
                            const confirmed = window.confirm(
                              "Publish accepted assessment drafts to this client's live Programs & Goals?",
                            );
                            if (!confirmed) {
                              return;
                            }
                          }
                          promoteAssessment.mutate();
                        }}
                        disabled={Boolean(promoteDisabledReason) || promoteAssessment.isLoading}
                        className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {promoteAssessment.isLoading ? "Publishing..." : "Publish to Live Programs + Goals"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          )}

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              Goals
            </h3>
            {goalsLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              </div>
            ) : goalsQueryError instanceof Error ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100">
                Could not load goals: {goalsQueryError.message}
              </div>
            ) : (
              <div className="space-y-3">
                {liveGoals.length === 0 && (
                  <p className="text-sm text-gray-500">No goals in this program yet.</p>
                )}
                {goalDisplaySections.map((section) => (
                  <section
                    key={section.key}
                    className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-dark-lighter/20"
                    aria-labelledby={`goal-section-${section.key}`}
                  >
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4
                          id={`goal-section-${section.key}`}
                          className="text-sm font-semibold text-gray-800 dark:text-gray-100"
                        >
                          {section.title}
                        </h4>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-300">{section.description}</p>
                      </div>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500 dark:bg-dark">
                        {section.domainGroups.reduce((count, group) => count + group.goals.length, 0)} goal
                        {section.domainGroups.reduce((count, group) => count + group.goals.length, 0) === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {section.domainGroups.map((domainGroup) => (
                        <div
                          key={domainGroup.key}
                          className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-dark"
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <h5 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-300">
                              {domainGroup.title}
                            </h5>
                            <span className="text-xs text-gray-500">
                              {domainGroup.goals.length} goal{domainGroup.goals.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="space-y-3">
                            {domainGroup.goals.map((goal) => (
                              <GoalCard
                                key={goal.id}
                                archiveGoal={archiveGoal}
                                archivingGoalId={archivingGoalId}
                                canDeleteGoalTargets={canDeleteGoalTargets}
                                clientId={client.id}
                                deleteGoalTarget={deleteGoalTarget}
                                deletingTargetId={deletingTargetId}
                                domainsById={goalDomainsById}
                                goal={goal}
                                goalTargetsForGoal={targetsByGoalId[goal.id] ?? []}
                                goalTargetsLoading={goalTargetsLoading}
                                lifecycleTargetId={lifecycleTargetId}
                                organizationId={organizationId}
                                setGoalTargetArchiveState={canManageProgramsGoals ? setGoalTargetArchiveState : null}
                                updateGoalTarget={canManageProgramsGoals ? updateGoalTarget : null}
                                updatingTargetId={updatingTargetId}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
                {goalTargetsQueryError instanceof Error && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                    Could not load targets: {goalTargetsQueryError.message}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Add Target</h3>
            <div className="space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-300">
                Targets sit under a goal and define the measurement type and graph source used by trial-level data.
              </p>
              <label htmlFor="target-goal" className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                Parent goal
              </label>
              <select
                id="target-goal"
                value={targetGoalId}
                onChange={(event) => setTargetGoalId(event.target.value)}
                disabled={liveGoals.length === 0}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              >
                {liveGoals.length === 0 ? (
                  <option value="">No goals available</option>
                ) : (
                  liveGoals.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.title}
                    </option>
                  ))
                )}
              </select>
              <label htmlFor="target-name" className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                Target name *
              </label>
              <input
                id="target-name"
                type="text"
                value={targetName}
                onChange={(event) => setTargetName(event.target.value)}
                placeholder="Target name"
                aria-required="true"
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                  Measurement type
                  <select
                    value={targetMeasurementType}
                    onChange={(event) => setTargetMeasurementType(event.target.value as TargetMeasurementType)}
                    className="mt-1 w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
                  >
                    {TARGET_MEASUREMENT_TYPES.map((measurementType) => (
                      <option key={measurementType} value={measurementType}>
                        {TARGET_MEASUREMENT_TYPE_LABELS[measurementType]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                  Target status
                  <select
                    value={targetStatus}
                    onChange={(event) => setTargetStatus(event.target.value as GoalTarget["status"])}
                    className="mt-1 w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="mastered">Mastered</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
              </div>
              <button
                type="button"
                onClick={() => createGoalTarget.mutate()}
                disabled={Boolean(createTargetDisabledReason) || createGoalTarget.isLoading}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {createGoalTarget.isLoading ? "Creating..." : "Create Target"}
              </button>
              {createTargetDisabledReason && !createGoalTarget.isLoading && (
                <p className="text-xs text-gray-500 dark:text-gray-300">{createTargetDisabledReason}</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Add Goal</h3>
            <div className="space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-300">
                Select a program before creating a goal. Required fields are marked with an asterisk.
              </p>
              {!hasResolvedProgram && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100">
                  {noProgramHelperText}
                </div>
              )}
              <label htmlFor="goal-title" className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                Goal title *
              </label>
              <input
                id="goal-title"
                type="text"
                value={goalTitle}
                onChange={(event) => setGoalTitle(event.target.value)}
                placeholder="Goal title"
                aria-required="true"
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <label htmlFor="goal-description" className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                Goal description *
              </label>
              <textarea
                id="goal-description"
                value={goalDescription}
                onChange={(event) => setGoalDescription(event.target.value)}
                placeholder="Goal description"
                rows={2}
                aria-required="true"
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <label htmlFor="goal-original-text" className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                Original clinical wording *
              </label>
              <textarea
                id="goal-original-text"
                value={goalOriginalText}
                onChange={(event) => setGoalOriginalText(event.target.value)}
                placeholder="Original clinical wording"
                rows={2}
                aria-describedby="goal-original-text-help"
                aria-required="true"
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <p id="goal-original-text-help" className="text-xs text-gray-500 dark:text-gray-300">
                Paste the original clinical wording from the assessment or care-plan source so the goal stays audit-friendly.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                  Goal type
                  <select
                    value={goalClinicalGoalType ?? ""}
                    onChange={(event) => setGoalClinicalGoalType(event.target.value as Goal["clinical_goal_type"])}
                    className="mt-1 w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
                  >
                    <option value="skill">Skill</option>
                    <option value="behavior">Behavior</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                  Source
                  <select
                    value={goalSource}
                    onChange={(event) => setGoalSource(event.target.value as NonNullable<Goal["source"]>)}
                    className="mt-1 w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
                  >
                    <option value="manual">Manual</option>
                    <option value="fba_extraction">FBA extraction</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                  Domain
                  <select
                    value={goalDomainId}
                    onChange={(event) => {
                      setGoalDomainId(event.target.value);
                      if (event.target.value !== CREATE_NEW_DOMAIN_VALUE) {
                        setNewGoalDomainName("");
                      }
                    }}
                    disabled={goalDomainsLoading}
                    className="mt-1 w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
                  >
                    <option value="">{goalDomainsLoading ? "Loading domains..." : "No domain assigned"}</option>
                    {activeGoalDomains.map((domain) => (
                      <option key={domain.id} value={domain.id}>
                        {domain.name}
                      </option>
                    ))}
                    <option value={CREATE_NEW_DOMAIN_VALUE}>Create new domain...</option>
                  </select>
                </label>
              </div>
              {goalDomainId === CREATE_NEW_DOMAIN_VALUE && (
                <div className="rounded-md border border-blue-100 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                  <label htmlFor="new-goal-domain-name" className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                    New domain name *
                    <input
                      id="new-goal-domain-name"
                      type="text"
                      value={newGoalDomainName}
                      onChange={(event) => setNewGoalDomainName(event.target.value)}
                      placeholder="Communication, Social, Behavior reduction..."
                      aria-required="true"
                      className="mt-1 w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => createGoalDomain.mutate()}
                    disabled={!newGoalDomainNameValue || createGoalDomain.isLoading}
                    className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {createGoalDomain.isLoading ? "Creating domain..." : "Create Domain"}
                  </button>
                </div>
              )}
              {goalDomainsQueryError instanceof Error && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Could not load goal domains: {goalDomainsQueryError.message}
                </p>
              )}
              <input
                type="text"
                value={goalMeasurementType}
                onChange={(event) => setGoalMeasurementType(event.target.value)}
                placeholder="Measurement type (optional)"
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <textarea
                value={goalBaselineData}
                onChange={(event) => setGoalBaselineData(event.target.value)}
                placeholder="Baseline data (optional)"
                rows={2}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <textarea
                value={goalOperationalDefinition}
                onChange={(event) => setGoalOperationalDefinition(event.target.value)}
                placeholder="Operational definition (optional)"
                rows={2}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <textarea
                value={goalTeachingStrategies}
                onChange={(event) => setGoalTeachingStrategies(event.target.value)}
                placeholder="Teaching strategies (optional)"
                rows={2}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              {GOAL_TIMELINE_INPUTS.map(({ key, placeholder }) => (
                <textarea
                  key={key}
                  value={
                    key === "shortTermGoal"
                      ? goalShortTermGoal
                      : key === "intermediateGoal"
                        ? goalIntermediateGoal
                        : goalLongTermGoal
                  }
                  onChange={(event) => {
                    if (key === "shortTermGoal") {
                      setGoalShortTermGoal(event.target.value);
                      return;
                    }
                    if (key === "intermediateGoal") {
                      setGoalIntermediateGoal(event.target.value);
                      return;
                    }
                    setGoalLongTermGoal(event.target.value);
                  }}
                  placeholder={`${placeholder} (optional)`}
                  rows={2}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
                />
              ))}
              <textarea
                value={goalMasteryCriteria}
                onChange={(event) => setGoalMasteryCriteria(event.target.value)}
                placeholder="Mastery criteria (optional)"
                rows={2}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <textarea
                value={goalMaintenanceCriteria}
                onChange={(event) => setGoalMaintenanceCriteria(event.target.value)}
                placeholder="Maintenance criteria (optional)"
                rows={2}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <textarea
                value={goalGeneralizationCriteria}
                onChange={(event) => setGoalGeneralizationCriteria(event.target.value)}
                placeholder="Generalization criteria (optional)"
                rows={2}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <textarea
                value={goalObjectiveDataPoints}
                onChange={(event) => setGoalObjectiveDataPoints(event.target.value)}
                placeholder='Objective data points JSON array (optional), e.g. [{"objective":"Identify 4 emotions","data_settings":"Opportunity based with prompts"}]'
                rows={3}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => createGoal.mutate()}
                disabled={Boolean(createGoalDisabledReason) || createGoal.isLoading}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {createGoal.isLoading ? "Creating..." : "Create Goal"}
              </button>
              {createGoalDisabledReason && !createGoal.isLoading && (
                <p className="text-xs text-gray-500 dark:text-gray-300">{createGoalDisabledReason}</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Program Notes</h3>
            <div className="space-y-3">
              {!hasResolvedProgram ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100">
                  {noProgramHelperText}
                </div>
              ) : programNotes.length === 0 ? (
                <p className="text-sm text-gray-500">No program notes yet.</p>
              ) : null}
              {hasResolvedProgram && programNotes.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-300">
                  Add a note to document plan updates, progress summaries, or other program-specific context.
                </p>
              )}
              {programNotes.map((note) => (
                <div key={note.id} className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{note.note_type.replace("_", " ")}</span>
                    <span>{new Date(note.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-200 mt-2">
                    {typeof note.content?.text === "string" ? note.content.text : "Note saved"}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              <select
                value={noteType}
                onChange={(event) => setNoteType(event.target.value as ProgramNote["note_type"])}
                disabled={!hasResolvedProgram}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              >
                <option value="plan_update">Plan Update</option>
                <option value="progress_summary">Progress Summary</option>
                <option value="other">Other</option>
              </select>
              <textarea
                value={noteContent}
                onChange={(event) => setNoteContent(event.target.value)}
                placeholder="Add a program note"
                rows={3}
                disabled={!hasResolvedProgram}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm text-sm"
              />
              <button
                type="button"
                onClick={() => createNote.mutate()}
                disabled={Boolean(createNoteDisabledReason) || createNote.isLoading}
                className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {createNote.isLoading ? "Saving..." : "Add Note"}
              </button>
              {createNoteDisabledReason && !createNote.isLoading && (
                <p className="text-xs text-gray-500 dark:text-gray-300">{createNoteDisabledReason}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
