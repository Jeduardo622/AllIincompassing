import { composeAssessmentTextFromChecklist, type AssessmentChecklistValueRow } from "./assessment-text-composer";

const MAX_SUMMARY_CHARS = 12000;
const MAX_SNIPPET_CHARS = 1800;
const MAX_SNIPPETS = 120;

export interface AssessmentChecklistGenerationRow extends AssessmentChecklistValueRow {
  status: "not_started" | "drafted" | "verified" | "approved";
}

export interface AssessmentExtractionGenerationRow {
  section_key: string;
  field_key: string;
  label: string;
  value_text: string | null;
  value_json: Record<string, unknown> | null;
  source_span: Record<string, unknown> | null;
  status: "not_started" | "drafted" | "verified" | "approved";
}

interface BuildGenerationPayloadArgs {
  assessmentDocumentId: string;
  clientId: string;
  organizationId: string;
  clientDisplayName?: string;
  organizationGuidance?: string;
  checklistRows: AssessmentChecklistGenerationRow[];
  extractionRows: AssessmentExtractionGenerationRow[];
}

export interface GenerateProgramGoalsPayload {
  assessment_document_id: string;
  client_id: string;
  organization_id: string;
  client_display_name: string;
  organization_guidance: string;
  approved_checklist_rows: Array<{
    section_key: string;
    label: string;
    placeholder_key: string;
    value_text?: string;
    value_json?: Record<string, unknown>;
  }>;
  extracted_canonical_fields: Record<string, unknown>;
  assessment_summary: string;
  source_evidence_snippets: Array<{
    section_key: string;
    snippet: string;
  }>;
}

const compactWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const trimTo = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3).trimEnd()}...`;
};

const stringifySafe = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
};

const toSnippet = (value: string | null | undefined): string => {
  const compact = compactWhitespace(value ?? "");
  return trimTo(compact, MAX_SNIPPET_CHARS);
};

const buildChecklistRowSnippet = (row: AssessmentChecklistGenerationRow): string => {
  const valueText = toSnippet(row.value_text);
  const valueJson = row.value_json ? toSnippet(stringifySafe(row.value_json)) : "";
  const merged = [row.label.trim(), valueText, valueJson].filter((part) => part.length > 0).join(": ");
  return trimTo(merged, MAX_SNIPPET_CHARS);
};

const sourceSpanToSnippet = (span: Record<string, unknown> | null): string => {
  if (!span) {
    return "";
  }
  const serialized = toSnippet(stringifySafe(span));
  return serialized;
};

const canonicalFieldValue = (
  checklistRow: AssessmentChecklistGenerationRow | undefined,
  extractionRow: AssessmentExtractionGenerationRow | undefined,
): unknown => {
  if (checklistRow) {
    if (checklistRow.value_json && Object.keys(checklistRow.value_json).length > 0) {
      return checklistRow.value_json;
    }
    if (typeof checklistRow.value_text === "string" && checklistRow.value_text.trim().length > 0) {
      return checklistRow.value_text.trim();
    }
  }
  if (extractionRow) {
    if (extractionRow.value_json && Object.keys(extractionRow.value_json).length > 0) {
      return extractionRow.value_json;
    }
    if (typeof extractionRow.value_text === "string" && extractionRow.value_text.trim().length > 0) {
      return extractionRow.value_text.trim();
    }
  }
  return "";
};

export const buildGenerateProgramGoalsPayload = (args: BuildGenerationPayloadArgs): GenerateProgramGoalsPayload => {
  const approvedChecklistRows = args.checklistRows.filter((row) => row.status === "approved");
  const preferredChecklistRows = approvedChecklistRows.length > 0 ? approvedChecklistRows : args.checklistRows;

  const approvedRowsPayload = approvedChecklistRows
    .filter((row) => (row.value_text && row.value_text.trim().length > 0) || (row.value_json && Object.keys(row.value_json).length > 0))
    .map((row) => ({
      section_key: row.section_key,
      label: row.label,
      placeholder_key: row.placeholder_key,
      ...(row.value_text && row.value_text.trim().length > 0 ? { value_text: row.value_text.trim() } : {}),
      ...(row.value_json && Object.keys(row.value_json).length > 0 ? { value_json: row.value_json } : {}),
    }));

  const extractionByField = new Map(args.extractionRows.map((row) => [row.field_key, row]));
  const canonicalFieldKeys = new Set<string>();
  args.checklistRows.forEach((row) => canonicalFieldKeys.add(row.placeholder_key));
  args.extractionRows.forEach((row) => canonicalFieldKeys.add(row.field_key));

  const extractedCanonicalFields: Record<string, unknown> = {};
  Array.from(canonicalFieldKeys.values())
    .sort((left, right) => left.localeCompare(right))
    .forEach((fieldKey) => {
      const checklistRow = args.checklistRows.find((row) => row.placeholder_key === fieldKey);
      const extractionRow = extractionByField.get(fieldKey);
      extractedCanonicalFields[fieldKey] = canonicalFieldValue(checklistRow, extractionRow);
    });

  const summarySourceRows = preferredChecklistRows.length > 0 ? preferredChecklistRows : args.checklistRows;
  const composedSummary = composeAssessmentTextFromChecklist(summarySourceRows);
  const fallbackSummary =
    composedSummary.trim().length > 0 ? composedSummary : composeAssessmentTextFromChecklist(args.checklistRows);
  const assessmentSummary = trimTo(fallbackSummary.trim(), MAX_SUMMARY_CHARS);

  const sourceEvidenceSnippets: Array<{ section_key: string; snippet: string }> = [];
  args.extractionRows.forEach((row) => {
    const valueTextSnippet = toSnippet(row.value_text);
    const sourceSpanSnippet = sourceSpanToSnippet(row.source_span);
    const combined = [row.label.trim(), valueTextSnippet, sourceSpanSnippet].filter((part) => part.length > 0).join(" | ");
    const snippet = trimTo(combined, MAX_SNIPPET_CHARS);
    if (snippet.length > 0) {
      sourceEvidenceSnippets.push({
        section_key: row.section_key || "extraction",
        snippet,
      });
    }
  });

  if (sourceEvidenceSnippets.length === 0) {
    preferredChecklistRows.forEach((row) => {
      const snippet = buildChecklistRowSnippet(row);
      if (snippet.length > 0) {
        sourceEvidenceSnippets.push({
          section_key: row.section_key,
          snippet,
        });
      }
    });
  }

  if (sourceEvidenceSnippets.length === 0) {
    sourceEvidenceSnippets.push({
      section_key: "assessment_summary",
      snippet: trimTo(assessmentSummary, MAX_SNIPPET_CHARS),
    });
  }

  return {
    assessment_document_id: args.assessmentDocumentId,
    client_id: args.clientId,
    organization_id: args.organizationId,
    client_display_name: args.clientDisplayName?.trim() || "",
    organization_guidance: args.organizationGuidance?.trim() || "",
    approved_checklist_rows: approvedRowsPayload,
    extracted_canonical_fields: extractedCanonicalFields,
    assessment_summary: assessmentSummary,
    source_evidence_snippets: sourceEvidenceSnippets.slice(0, MAX_SNIPPETS),
  };
};
