import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface AssessmentChecklistSeedRow {
  section: string;
  label: string;
  placeholder_key: string;
  mode: "AUTO" | "ASSISTED" | "MANUAL";
  source: string;
  required: boolean;
  extraction_method: string;
  validation_rule: string;
  status: "not_started" | "drafted" | "verified" | "approved";
  extraction_owner?: string;
  review_owner?: string;
  review_notes?: string;
}

interface ChecklistTemplateFile {
  rows?: unknown;
}

const TEMPLATE_FILE_BY_TYPE = {
  caloptima_fba: "caloptima_fba_field_extraction_checklist.json",
  iehp_fba: "iehp_fba_field_extraction_checklist.json",
} as const;

export type AssessmentTemplateType = keyof typeof TEMPLATE_FILE_BY_TYPE;

const DEFAULT_TEMPLATE_TYPE: AssessmentTemplateType = "caloptima_fba";

const cachedRowsByTemplate = new Map<AssessmentTemplateType, AssessmentChecklistSeedRow[]>();

const normalizeRow = (row: unknown): AssessmentChecklistSeedRow | null => {
  if (!row || typeof row !== "object") {
    return null;
  }
  const candidate = row as Record<string, unknown>;
  const modeValue = candidate.mode;
  const mode = modeValue === "AUTO" || modeValue === "ASSISTED" || modeValue === "MANUAL" ? modeValue : null;
  const statusValue = candidate.status;
  const status =
    statusValue === "not_started" || statusValue === "drafted" || statusValue === "verified" || statusValue === "approved"
      ? statusValue
      : "not_started";

  if (
    typeof candidate.section !== "string" ||
    typeof candidate.label !== "string" ||
    typeof candidate.placeholder_key !== "string" ||
    !mode ||
    typeof candidate.source !== "string" ||
    typeof candidate.required !== "boolean" ||
    typeof candidate.extraction_method !== "string" ||
    typeof candidate.validation_rule !== "string"
  ) {
    return null;
  }

  return {
    section: candidate.section,
    label: candidate.label,
    placeholder_key: candidate.placeholder_key,
    mode,
    source: candidate.source,
    required: candidate.required,
    extraction_method: candidate.extraction_method,
    validation_rule: candidate.validation_rule,
    status,
    extraction_owner: typeof candidate.extraction_owner === "string" ? candidate.extraction_owner : undefined,
    review_owner: typeof candidate.review_owner === "string" ? candidate.review_owner : undefined,
    review_notes: typeof candidate.review_notes === "string" ? candidate.review_notes : undefined,
  };
};

const toTemplateType = (value: string | undefined): AssessmentTemplateType => {
  if (value && value in TEMPLATE_FILE_BY_TYPE) {
    return value as AssessmentTemplateType;
  }
  return DEFAULT_TEMPLATE_TYPE;
};

export async function loadChecklistTemplateRows(templateType?: string): Promise<AssessmentChecklistSeedRow[]> {
  const resolvedTemplateType = toTemplateType(templateType);
  const cachedRows = cachedRowsByTemplate.get(resolvedTemplateType);
  if (cachedRows) {
    return cachedRows;
  }

  const checklistFile = TEMPLATE_FILE_BY_TYPE[resolvedTemplateType];
  const checklistPath = resolve(process.cwd(), "docs", "fill_docs", checklistFile);
  const raw = await readFile(checklistPath, "utf8");
  const parsed = JSON.parse(raw) as ChecklistTemplateFile;
  const parsedRows = Array.isArray(parsed.rows) ? parsed.rows.map(normalizeRow).filter(Boolean) : [];

  if (parsedRows.length === 0) {
    throw new Error(`Checklist template rows are missing or invalid for ${resolvedTemplateType}.`);
  }

  cachedRowsByTemplate.set(resolvedTemplateType, parsedRows);
  return parsedRows;
}

export async function loadCalOptimaChecklistTemplateRows(): Promise<AssessmentChecklistSeedRow[]> {
  return loadChecklistTemplateRows("caloptima_fba");
}
