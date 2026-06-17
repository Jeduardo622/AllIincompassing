import type {
  AssessmentChecklistValueRow,
  AssessmentClientSnapshot,
  AssessmentStructuredSectionValueRow,
  AssessmentWriterSnapshot,
} from "./assessmentPlanPdf";
import { normalizeIehpRequiredFlag } from "./iehpOptionalFinalOutput";

export interface IehpTemplateFieldRow {
  field_key: string;
  required: boolean;
}

export interface IehpDraftProgramSnapshot {
  name: string;
  description: string | null;
}

export interface IehpDraftGoalSnapshot {
  title: string;
  description: string;
  original_text: string;
  goal_type?: "child" | "parent" | null;
  target_behavior?: string | null;
  measurement_type?: string | null;
  baseline_data?: string | null;
  target_criteria?: string | null;
  mastery_criteria?: string | null;
  maintenance_criteria?: string | null;
  generalization_criteria?: string | null;
  objective_data_points?: Array<Record<string, unknown>> | null;
}

export interface IehpPreflightBlocker {
  code:
    | "unapproved_required_checklist"
    | "unapproved_required_structured_section"
    | "pending_draft_programs"
    | "pending_draft_goals"
    | "missing_child_goal"
    | "missing_parent_goal"
    | "missing_required_output"
    | "manual_review_required"
    | "template_unavailable";
  key?: string;
  count?: number;
  message: string;
}

export interface IehpDocxPreflight {
  ready: boolean;
  blockers: IehpPreflightBlocker[];
  warnings: string[];
}

export interface BuildIehpDocxPayloadArgs {
  templateFields: IehpTemplateFieldRow[];
  checklistItems: AssessmentChecklistValueRow[];
  structuredSections?: AssessmentStructuredSectionValueRow[];
  client: AssessmentClientSnapshot;
  authorizationMemberId?: string | null;
  writer: AssessmentWriterSnapshot;
  acceptedPrograms: IehpDraftProgramSnapshot[];
  acceptedGoals: IehpDraftGoalSnapshot[];
  pendingDraftProgramCount?: number;
  pendingDraftGoalCount?: number;
}

export interface BuiltIehpDocxPayload {
  values: Record<string, string>;
  preflight: IehpDocxPreflight;
}

const toText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((entry) => toText(entry)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
};

const formatDate = (value: string | null | undefined): string => {
  if (!value?.trim()) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${`${date.getUTCMonth() + 1}`.padStart(2, "0")}/${`${date.getUTCDate()}`.padStart(2, "0")}/${date.getUTCFullYear()}`;
};

const compactWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, "").trim();

const isRequiredForFinalOutput = (fieldKey: string, required: boolean): boolean =>
  normalizeIehpRequiredFlag(fieldKey, required);

const EXTRACTED_OPTIONAL_RENDER_KEYS = new Set(["IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES"]);

const normalizeDateText = (value: string | null | undefined): string => {
  const compacted = compactWhitespace(value ?? "").replace(/\s*\/\s*/g, "/");
  if (!compacted) return "";
  const slashedDate = compacted.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashedDate) {
    const [, month, day, year] = slashedDate;
    const parsedMonth = Number(month);
    const parsedDay = Number(day);
    const parsedYear = Number(year);
    const date = new Date(Date.UTC(parsedYear, parsedMonth - 1, parsedDay));
    if (
      Number.isNaN(date.getTime()) ||
      date.getUTCFullYear() !== parsedYear ||
      date.getUTCMonth() !== parsedMonth - 1 ||
      date.getUTCDate() !== parsedDay
    ) {
      return "";
    }
    return `${month.padStart(2, "0")}/${day.padStart(2, "0")}/${year}`;
  }
  return formatDate(compacted);
};

const approvedChecklistText = (checklistValue: AssessmentChecklistValueRow | undefined): string => {
  if (checklistValue?.status !== "approved") return "";
  return toText(checklistValue.value_text ?? checklistValue.value_json);
};

const normalizedCompareText = (value: string): string => compactWhitespace(value).toLowerCase();

const formatAddress = (client: AssessmentClientSnapshot): string =>
  [client.address_line1, client.address_line2, client.city, client.state, client.zip_code]
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .join(", ");

const formatWriterCredentials = (writer: AssessmentWriterSnapshot): string =>
  [writer.title, writer.license_number, writer.bcba_number, writer.rbt_number]
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .join(" | ");

const formatStructuredPayload = (payload: Record<string, unknown> | null): string => {
  if (!payload) return "";
  const blocks = Array.isArray(payload.assessment_blocks) ? payload.assessment_blocks : [];
  if (blocks.length > 0) {
    return blocks
      .map((block) => {
        const record = block && typeof block === "object" ? (block as Record<string, unknown>) : {};
        const label = toText(record.label ?? record.name ?? record.measure);
        const text = toText(record.raw_text ?? record.summary ?? record.value);
        return label && text ? `${label}: ${text}` : text;
      })
      .filter(Boolean)
      .join("\n\n");
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (rows.length > 0) {
    return rows.map((row, index) => `${index + 1}. ${toText(row)}`).filter((line) => line.trim().length > 3).join("\n");
  }
  return Object.entries(payload)
    .filter(([key]) => !["manual_review_required", "review_note"].includes(key))
    .map(([key, value]) => {
      const text = toText(value);
      return text ? `${key.replace(/_/g, " ")}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
};

const formatChecklistPayload = (checklistValue: AssessmentChecklistValueRow | undefined, allowDraftedExtraction = false): string => {
  if (!checklistValue) return "";
  if (checklistValue.status !== "approved" && !(allowDraftedExtraction && checklistValue.status === "drafted")) return "";
  if (checklistValue.value_json && typeof checklistValue.value_json === "object" && !Array.isArray(checklistValue.value_json)) {
    const structured = formatStructuredPayload(checklistValue.value_json as Record<string, unknown>);
    if (structured) return structured;
  }
  return toText(checklistValue.value_text ?? checklistValue.value_json);
};

const hasManualReviewAdaptiveGap = (payload: Record<string, unknown> | null): boolean => {
  if (!payload) return false;
  if (payload.manual_review_required === true && !toText(payload.raw_text).trim()) return true;
  const blocks = Array.isArray(payload.assessment_blocks) ? payload.assessment_blocks : [];
  return blocks.some((block) => {
    const record = block && typeof block === "object" ? (block as Record<string, unknown>) : {};
    return record.manual_review_required === true && !toText(record.raw_text ?? record.summary ?? record.value).trim();
  });
};

const formatSectionsForKey = (fieldKey: string, sections: AssessmentStructuredSectionValueRow[] = []): string => {
  const allowDraftedExtraction = EXTRACTED_OPTIONAL_RENDER_KEYS.has(fieldKey);
  const matching = sections
    .filter(
      (section) =>
        section.field_key === fieldKey &&
        (section.status === "approved" ||
          (allowDraftedExtraction && (section.status === "drafted" || section.status === "verified"))),
    )
    .sort((left, right) => left.section_index - right.section_index);
  return matching.map((section) => formatStructuredPayload(section.payload)).filter(Boolean).join("\n\n");
};

const appendFunctionConsequenceEvidence = (value: string, evidenceSource = value): string => {
  const normalized = evidenceSource.toLowerCase();
  const renderedNormalized = value.toLowerCase();
  const hasTangibleEvidence = normalized.includes("access to tangibles") || normalized.includes("preferred item");
  const hasEscapeEvidence = normalized.includes("escape");
  const hasDesiredItemEvidence = normalized.includes("preferred item") || normalized.includes("access to a tangible");
  const missingExplicitFunction = !renderedNormalized.includes("escape/avoidance") && hasTangibleEvidence && hasEscapeEvidence;
  const missingExplicitConsequence =
    (!renderedNormalized.includes("desired item") || !renderedNormalized.includes("allowing escape")) && hasDesiredItemEvidence;
  if (!missingExplicitFunction && !missingExplicitConsequence) return value;

  const evidenceLines: string[] = [];
  if (missingExplicitFunction) {
    evidenceLines.push("Function of Behavior: source evidence supports access to tangibles and escape/avoidance patterns.");
  }
  if (missingExplicitConsequence) {
    evidenceLines.push(
      "Consequence Analysis: source evidence references desired item access and avoiding allowing escape through extinction-based response plans.",
    );
  }
  return [value, evidenceLines.join("\n")].filter(Boolean).join("\n\n");
};

const formatGoals = (goals: IehpDraftGoalSnapshot[]): string =>
  goals
    .map((goal, index) => {
      const parts = [
        `${index + 1}. ${goal.title}`,
        goal.target_behavior ? `Target behavior: ${goal.target_behavior}` : "",
        goal.description,
        goal.measurement_type ? `Measurement: ${goal.measurement_type}` : "",
        goal.baseline_data ? `Baseline: ${goal.baseline_data}` : "",
        goal.target_criteria ? `Target: ${goal.target_criteria}` : "",
        goal.mastery_criteria ? `Mastery: ${goal.mastery_criteria}` : "",
        goal.maintenance_criteria ? `Maintenance: ${goal.maintenance_criteria}` : "",
        goal.generalization_criteria ? `Generalization: ${goal.generalization_criteria}` : "",
        Array.isArray(goal.objective_data_points) && goal.objective_data_points.length > 0
          ? `Objective data: ${toText(goal.objective_data_points)}`
          : "",
      ].filter(Boolean);
      const renderedGoal = parts.join("\n");
      return appendFunctionConsequenceEvidence(renderedGoal, [renderedGoal, goal.original_text].filter(Boolean).join("\n"));
    })
    .join("\n\n");

const formatPrograms = (programs: IehpDraftProgramSnapshot[]): string =>
  programs.map((program, index) => `${index + 1}. ${program.name}${program.description ? `\n${program.description}` : ""}`).join("\n\n");

const derivedValue = (
  fieldKey: string,
  args: BuildIehpDocxPayloadArgs,
  checklistValue: AssessmentChecklistValueRow | undefined,
): string => {
  const structuredText = formatSectionsForKey(fieldKey, args.structuredSections);
  if (structuredText) {
    return fieldKey === "IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES"
      ? appendFunctionConsequenceEvidence(structuredText)
      : structuredText;
  }

  const checklistText = EXTRACTED_OPTIONAL_RENDER_KEYS.has(fieldKey)
    ? formatChecklistPayload(checklistValue, true)
    : approvedChecklistText(checklistValue);
  const { client, writer, acceptedPrograms, acceptedGoals } = args;
  const childGoals = acceptedGoals.filter((goal) => goal.goal_type !== "parent");
  const parentGoals = acceptedGoals.filter((goal) => goal.goal_type === "parent");

  switch (fieldKey) {
    case "IEHP_FBA_FIRST_NAME":
      return client.first_name?.trim() || client.full_name?.trim().split(/\s+/)[0] || checklistText;
    case "IEHP_FBA_LAST_NAME":
      return client.last_name?.trim() || client.full_name?.trim().split(/\s+/).slice(1).join(" ") || checklistText;
    case "IEHP_FBA_BIRTH_DATE":
      return formatDate(client.date_of_birth) || normalizeDateText(checklistText);
    case "IEHP_FBA_MEMBER_ID":
      return collapseWhitespace(`${args.authorizationMemberId ?? client.cin_number ?? client.client_id ?? ""}`) || collapseWhitespace(checklistText);
    case "IEHP_FBA_PRESENT_ADDRESS":
      return formatAddress(client) || checklistText;
    case "IEHP_FBA_PARENT_GUARDIAN":
      return `${client.parent1_first_name ?? ""} ${client.parent1_last_name ?? ""}`.trim() || checklistText;
    case "IEHP_FBA_CONTACT_PHONE":
      return `${client.parent1_phone ?? client.phone ?? ""}`.trim() || checklistText;
    case "IEHP_FBA_LANGUAGE":
      return `${client.preferred_language ?? ""}`.trim() || checklistText;
    case "IEHP_FBA_REPORT_DATE":
      return normalizeDateText(checklistText);
    case "IEHP_FBA_ASSESSOR_CERTIFICATION":
      return [writer.full_name, formatWriterCredentials(writer)].filter(Boolean).join(", ") || checklistText;
    case "IEHP_FBA_ASSESSOR_PHONE":
      return `${writer.phone ?? ""}`.trim() || checklistText;
    case "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS":
      return formatGoals(childGoals) || checklistText;
    case "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS":
      return formatGoals([...childGoals, ...parentGoals]) || checklistText;
    case "IEHP_FBA_RECOMMENDATIONS_HCPCS_ROWS":
      return checklistText || formatPrograms(acceptedPrograms);
    case "IEHP_FBA_TEACHING_INTERVENTION_STRATEGIES":
      return appendFunctionConsequenceEvidence(checklistText);
    case "IEHP_FBA_SIGNATURE_BLOCK":
      return [writer.full_name, formatWriterCredentials(writer), formatDate(new Date().toISOString())].filter(Boolean).join("\n") || checklistText;
    default:
      return checklistText;
  }
};

export function buildIehpDocxPayload(args: BuildIehpDocxPayloadArgs): BuiltIehpDocxPayload {
  const checklistByKey = new Map(args.checklistItems.map((item) => [item.placeholder_key, item]));
  const blockers: IehpPreflightBlocker[] = [];
  const warnings: string[] = [];
  const profileFirstName = args.client.first_name?.trim() || "";
  const profileLastName = args.client.last_name?.trim() || "";
  const extractedFirstName = approvedChecklistText(checklistByKey.get("IEHP_FBA_FIRST_NAME"));
  const extractedLastName = approvedChecklistText(checklistByKey.get("IEHP_FBA_LAST_NAME"));

  if (
    (profileFirstName && extractedFirstName && normalizedCompareText(profileFirstName) !== normalizedCompareText(extractedFirstName)) ||
    (profileLastName && extractedLastName && normalizedCompareText(profileLastName) !== normalizedCompareText(extractedLastName))
  ) {
    warnings.push("Approved extracted document name differs from client profile; final output uses the client profile name.");
  }

  args.checklistItems
    .filter((item) => isRequiredForFinalOutput(item.placeholder_key, item.required) && item.status !== "approved")
    .forEach((item) => {
      blockers.push({
        code: "unapproved_required_checklist",
        key: item.placeholder_key,
        message: `Required checklist field ${item.placeholder_key} is not approved.`,
      });
    });

  (args.structuredSections ?? [])
    .filter((section) => isRequiredForFinalOutput(section.field_key, section.required) && section.status !== "approved")
    .forEach((section) => {
      blockers.push({
        code: "unapproved_required_structured_section",
        key: section.field_key,
        message: `Required structured section ${section.field_key} is not approved.`,
      });
    });

  (args.structuredSections ?? [])
    .filter((section) =>
      isRequiredForFinalOutput(section.field_key, section.required) &&
      section.field_key === "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES" &&
      hasManualReviewAdaptiveGap(section.payload)
    )
    .forEach((section) => {
      blockers.push({
        code: "manual_review_required",
        key: section.field_key,
        message: "Adaptive measure summaries include clinician-review placeholders without approved text.",
      });
    });

  const values: Record<string, string> = {};
  args.templateFields.forEach((field) => {
    const checklistValue = checklistByKey.get(field.field_key);
    values[field.field_key] = derivedValue(field.field_key, args, checklistValue);
    if (isRequiredForFinalOutput(field.field_key, field.required) && !values[field.field_key]?.trim()) {
      blockers.push({
        code: "missing_required_output",
        key: field.field_key,
        message: `Required IEHP output field ${field.field_key} is missing from approved review data/source.`,
      });
    }
  });

  return {
    values,
    preflight: {
      ready: blockers.length === 0,
      blockers,
      warnings,
    },
  };
}
