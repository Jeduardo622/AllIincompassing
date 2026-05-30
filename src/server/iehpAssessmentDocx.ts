import type {
  AssessmentChecklistValueRow,
  AssessmentClientSnapshot,
  AssessmentStructuredSectionValueRow,
  AssessmentWriterSnapshot,
} from "./assessmentPlanPdf";

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
    | "manual_review_required";
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
  const matching = sections
    .filter((section) => section.field_key === fieldKey && section.status === "approved")
    .sort((left, right) => left.section_index - right.section_index);
  return matching.map((section) => formatStructuredPayload(section.payload)).filter(Boolean).join("\n\n");
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
      return parts.join("\n");
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
  if (structuredText) return structuredText;

  const checklistText = checklistValue ? toText(checklistValue.value_text ?? checklistValue.value_json) : "";
  const { client, writer, acceptedPrograms, acceptedGoals } = args;
  const childGoals = acceptedGoals.filter((goal) => goal.goal_type !== "parent");
  const parentGoals = acceptedGoals.filter((goal) => goal.goal_type === "parent");

  switch (fieldKey) {
    case "IEHP_FBA_FIRST_NAME":
      return client.first_name?.trim() || client.full_name?.trim().split(/\s+/)[0] || checklistText;
    case "IEHP_FBA_LAST_NAME":
      return client.last_name?.trim() || client.full_name?.trim().split(/\s+/).slice(1).join(" ") || checklistText;
    case "IEHP_FBA_BIRTH_DATE":
      return formatDate(client.date_of_birth) || checklistText;
    case "IEHP_FBA_MEMBER_ID":
      return `${args.authorizationMemberId ?? client.cin_number ?? client.client_id ?? ""}`.trim() || checklistText;
    case "IEHP_FBA_PRESENT_ADDRESS":
      return formatAddress(client) || checklistText;
    case "IEHP_FBA_PARENT_GUARDIAN":
      return `${client.parent1_first_name ?? ""} ${client.parent1_last_name ?? ""}`.trim() || checklistText;
    case "IEHP_FBA_CONTACT_PHONE":
      return `${client.parent1_phone ?? client.phone ?? ""}`.trim() || checklistText;
    case "IEHP_FBA_LANGUAGE":
      return `${client.preferred_language ?? ""}`.trim() || checklistText;
    case "IEHP_FBA_REPORT_DATE":
      return formatDate(new Date().toISOString()) || checklistText;
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

  args.checklistItems
    .filter((item) => item.required && item.status !== "approved")
    .forEach((item) => {
      blockers.push({
        code: "unapproved_required_checklist",
        key: item.placeholder_key,
        message: `Required checklist field ${item.placeholder_key} is not approved.`,
      });
    });

  (args.structuredSections ?? [])
    .filter((section) => section.required && section.status !== "approved")
    .forEach((section) => {
      blockers.push({
        code: "unapproved_required_structured_section",
        key: section.field_key,
        message: `Required structured section ${section.field_key} is not approved.`,
      });
    });

  if ((args.pendingDraftProgramCount ?? 0) > 0) {
    blockers.push({
      code: "pending_draft_programs",
      count: args.pendingDraftProgramCount,
      message: "Draft programs are still pending review.",
    });
  }
  if ((args.pendingDraftGoalCount ?? 0) > 0) {
    blockers.push({
      code: "pending_draft_goals",
      count: args.pendingDraftGoalCount,
      message: "Draft goals are still pending review.",
    });
  }

  if (!args.acceptedGoals.some((goal) => goal.goal_type !== "parent")) {
    blockers.push({ code: "missing_child_goal", message: "At least one accepted or edited child goal is required." });
  }
  if (!args.acceptedGoals.some((goal) => goal.goal_type === "parent")) {
    blockers.push({ code: "missing_parent_goal", message: "At least one accepted or edited parent goal is required." });
  }

  (args.structuredSections ?? [])
    .filter((section) => section.field_key === "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES" && hasManualReviewAdaptiveGap(section.payload))
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
    if (field.required && !values[field.field_key]?.trim()) {
      blockers.push({
        code: "missing_required_output",
        key: field.field_key,
        message: `Required IEHP output field ${field.field_key} resolved empty.`,
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
