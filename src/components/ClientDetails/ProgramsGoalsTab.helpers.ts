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
  fill_mode: "acroform" | "overlay";
  signed_url: string;
  object_path: string;
}

export const EMPTY_ASSESSMENT_DOCUMENTS: AssessmentDocumentRecord[] = [];
export const EMPTY_CHECKLIST_ITEMS: AssessmentChecklistItem[] = [];
export const EMPTY_ASSESSMENT_DRAFTS: AssessmentDraftResponse = { programs: [], goals: [] };
export const ENABLE_CHECKLIST_MAPPING_UI = false;
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
