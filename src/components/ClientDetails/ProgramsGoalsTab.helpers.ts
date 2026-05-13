import type { AssessmentDocumentRecord, AssessmentTemplateType } from "../../lib/assessment-documents";

export interface AssessmentChecklistItem {
  id: string;
  section_key: string;
  label: string;
  placeholder_key: string;
  required: boolean;
  mode: "AUTO" | "ASSISTED" | "MANUAL";
  status: "not_started" | "drafted" | "verified" | "approved";
  review_notes: string | null;
  value_text: string | null;
}

export interface AssessmentStructuredSection {
  id: string;
  section_key: string;
  field_key: string;
  section_index: number;
  payload: Record<string, unknown>;
  source_span?: Record<string, unknown> | null;
  status: "not_started" | "drafted" | "verified" | "approved" | "rejected";
  required: boolean;
  review_notes: string | null;
}

export interface AssessmentChecklistResponse {
  items: AssessmentChecklistItem[];
  structured_sections: AssessmentStructuredSection[];
}

export interface AssessmentDraftProgram {
  id: string;
  name: string;
  description: string | null;
  accept_state: "pending" | "accepted" | "rejected" | "edited";
  review_notes: string | null;
}

export interface AssessmentDraftGoal {
  id: string;
  title: string;
  description: string;
  original_text: string;
  goal_type: "child" | "parent";
  measurement_type?: string | null;
  baseline_data?: string | null;
  target_criteria?: string | null;
  mastery_criteria?: string | null;
  maintenance_criteria?: string | null;
  generalization_criteria?: string | null;
  objective_data_points?: Array<Record<string, unknown>> | null;
  accept_state: "pending" | "accepted" | "rejected" | "edited";
  review_notes: string | null;
}

export interface AssessmentDraftResponse {
  programs: AssessmentDraftProgram[];
  goals: AssessmentDraftGoal[];
}

export interface AssessmentPlanPdfResponse {
  fill_mode: "acroform" | "overlay" | "mixed";
  signed_url: string;
  object_path: string;
  layout_warnings?: Array<{
    placeholder_key: string;
    page: number;
    reason: "overflow";
    rendered_line_count: number;
    total_line_count: number;
    max_lines: number;
  }>;
  overflow_keys?: string[];
}

export const EMPTY_ASSESSMENT_DOCUMENTS: AssessmentDocumentRecord[] = [];
export const EMPTY_CHECKLIST_ITEMS: AssessmentChecklistItem[] = [];
export const EMPTY_STRUCTURED_SECTIONS: AssessmentStructuredSection[] = [];
export const EMPTY_CHECKLIST_RESPONSE: AssessmentChecklistResponse = {
  items: EMPTY_CHECKLIST_ITEMS,
  structured_sections: EMPTY_STRUCTURED_SECTIONS,
};
export const EMPTY_ASSESSMENT_DRAFTS: AssessmentDraftResponse = { programs: [], goals: [] };
export const ENABLE_CHECKLIST_MAPPING_UI = true;
export const MIN_CHILD_GOALS = 20;
export const MIN_PARENT_GOALS = 6;

export const TEMPLATE_LABELS: Record<AssessmentTemplateType, string> = {
  caloptima_fba: "CalOptima FBA",
  iehp_fba: "IEHP FBA",
};

export const statusToneByAssessment: Record<
  AssessmentDocumentRecord["status"],
  { label: string; className: string }
> = {
  uploaded: { label: "uploaded", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  extracting: { label: "extracting", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200" },
  extracted: { label: "extracted", className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200" },
  drafted: { label: "ai proposal ready", className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200" },
  approved: { label: "approved", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" },
  rejected: { label: "rejected", className: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200" },
  extraction_failed: {
    label: "extraction failed",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
  },
};

export const parseJson = async <T,>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text) {
    return [] as unknown as T;
  }
  return JSON.parse(text) as T;
};

export const parseApiErrorMessage = async (
  response: Response,
  fallback: string,
): Promise<string> => {
  const text = await response.text();
  if (!text) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
    return fallback;
  } catch {
    return fallback;
  }
};

export const parseObjectiveDataPointsInput = (
  value: string,
): Array<Record<string, unknown>> => {
  if (!value.trim()) {
    return [];
  }
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Objective data points must be a JSON array.");
  }
  return parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
};

export interface GoalTimelineFields {
  shortTermGoal: string;
  intermediateGoal: string;
  longTermGoal: string;
}

export const EMPTY_GOAL_TIMELINE_FIELDS: GoalTimelineFields = {
  shortTermGoal: "",
  intermediateGoal: "",
  longTermGoal: "",
};

const GOAL_TIMELINE_LABELS = [
  { key: "shortTermGoal", label: "Short-term" },
  { key: "intermediateGoal", label: "Intermediate" },
  { key: "longTermGoal", label: "Long-term" },
] as const satisfies ReadonlyArray<{ key: keyof GoalTimelineFields; label: string }>;

export const formatGoalTimelineCriteria = (fields: GoalTimelineFields): string => {
  const lines = GOAL_TIMELINE_LABELS.flatMap(({ key, label }) => {
    const value = fields[key].trim();
    return value ? [`${label}: ${value}`] : [];
  });
  return lines.join("\n");
};

export const parseGoalTimelineCriteria = (value?: string | null): GoalTimelineFields => {
  const trimmedValue = value?.trim() ?? "";
  if (!trimmedValue) {
    return { ...EMPTY_GOAL_TIMELINE_FIELDS };
  }

  const lines = trimmedValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = { ...EMPTY_GOAL_TIMELINE_FIELDS };
  let matchedLabelCount = 0;
  let currentField: keyof GoalTimelineFields | null = null;

  for (const line of lines) {
    const match = line.match(/^(Short-term|Intermediate|Long-term):\s*(.*)$/i);
    if (!match) {
      if (currentField) {
        parsed[currentField] = parsed[currentField]
          ? `${parsed[currentField]}\n${line}`
          : line;
      }
      continue;
    }

    const [, rawLabel, rawValue] = match;
    const normalizedValue = rawValue.trim();
    matchedLabelCount += 1;
    switch (rawLabel.toLowerCase()) {
      case "short-term":
        parsed.shortTermGoal = normalizedValue;
        currentField = "shortTermGoal";
        break;
      case "intermediate":
        parsed.intermediateGoal = normalizedValue;
        currentField = "intermediateGoal";
        break;
      case "long-term":
        parsed.longTermGoal = normalizedValue;
        currentField = "longTermGoal";
        break;
      default:
        currentField = null;
        break;
    }
  }

  if (matchedLabelCount === 0) {
    parsed.shortTermGoal = trimmedValue;
  }

  return parsed;
};
