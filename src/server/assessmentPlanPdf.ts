import { readFile } from "node:fs/promises";

import { resolveServerAssetPath } from "./serverAssetPath";

interface PdfFallbackCoordinates {
  page: number;
  x: number;
  y: number;
  font_size: number;
  max_width: number;
  height?: number;
  line_height?: number;
  max_lines?: number;
  field_kind?: string;
}

export interface PdfRenderMapEntry {
  placeholder_key: string;
  form_field_candidates: string[];
  fallback: PdfFallbackCoordinates;
}

interface PdfRenderMapFile {
  template_type: string;
  template_name: string;
  source_document: string;
  version: string;
  entries: unknown[];
}

export interface AssessmentChecklistValueRow {
  placeholder_key: string;
  required: boolean;
  status: "not_started" | "drafted" | "verified" | "approved";
  value_text: string | null;
  value_json: unknown | null;
}

export interface AssessmentStructuredSectionValueRow {
  field_key: string;
  section_key: string;
  section_index: number;
  payload: Record<string, unknown> | null;
  status: "not_started" | "drafted" | "verified" | "approved" | "rejected";
  required: boolean;
}

export interface AssessmentClientSnapshot {
  full_name: string;
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  cin_number?: string | null;
  client_id?: string | null;
  phone?: string | null;
  parent1_first_name?: string | null;
  parent1_last_name?: string | null;
  parent1_phone?: string | null;
  diagnosis?: string[] | null;
  preferred_language?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  insurance_info?: Record<string, unknown> | null;
}

export interface AssessmentWriterSnapshot {
  full_name?: string | null;
  title?: string | null;
  license_number?: string | null;
  bcba_number?: string | null;
  rbt_number?: string | null;
  phone?: string | null;
}

export interface DraftProgramSnapshot {
  name: string;
  description: string | null;
}

export interface DraftGoalSnapshot {
  title: string;
  description: string;
  original_text: string;
}

export interface BuildTemplatePayloadArgs {
  checklistItems: AssessmentChecklistValueRow[];
  structuredSections?: AssessmentStructuredSectionValueRow[];
  client: AssessmentClientSnapshot;
  writer: AssessmentWriterSnapshot;
  acceptedProgram: DraftProgramSnapshot | null;
  acceptedGoals: DraftGoalSnapshot[];
}

export interface BuiltTemplatePayload {
  values: Record<string, string>;
  missing_required_keys: string[];
}

let cachedCalOptimaMap: PdfRenderMapEntry[] | null = null;

const CALOPTIMA_RENDER_MAP_PATH = resolveServerAssetPath(
  "docs/fill_docs/caloptima_fba_pdf_render_map.json",
);
const CALOPTIMA_GOAL_DETAIL_APPENDIX_KEY = "CALOPTIMA_FBA_GOAL_DETAIL_APPENDIX";

const CALOPTIMA_GOAL_APPENDIX_FIELDS = new Map<
  string,
  { heading: string; singular: string; plural: string }
>([
  [
    "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
    {
      heading: "Target and replacement behavior goals",
      singular: "target and replacement behavior goal",
      plural: "target and replacement behavior goals",
    },
  ],
  [
    "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
    {
      heading: "Skill acquisition goals",
      singular: "skill acquisition goal",
      plural: "skill acquisition goals",
    },
  ],
  [
    "CALOPTIMA_FBA_PARENT_GOALS",
    {
      heading: "Parent/caregiver goals",
      singular: "parent/caregiver goal",
      plural: "parent/caregiver goals",
    },
  ],
]);

const toText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => toText(entry))
      .filter((entry) => entry.length > 0)
      .join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
};

const normalizeMapEntry = (entry: unknown): PdfRenderMapEntry | null => {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  if (
    typeof record.placeholder_key !== "string" ||
    !Array.isArray(record.form_field_candidates) ||
    !record.fallback ||
    typeof record.fallback !== "object"
  ) {
    return null;
  }

  const fallback = record.fallback as Record<string, unknown>;
  if (
    typeof fallback.page !== "number" ||
    typeof fallback.x !== "number" ||
    typeof fallback.y !== "number" ||
    typeof fallback.font_size !== "number" ||
    typeof fallback.max_width !== "number" ||
    (fallback.height !== undefined && typeof fallback.height !== "number") ||
    (fallback.line_height !== undefined &&
      typeof fallback.line_height !== "number") ||
    (fallback.max_lines !== undefined &&
      typeof fallback.max_lines !== "number") ||
    (fallback.field_kind !== undefined &&
      typeof fallback.field_kind !== "string")
  ) {
    return null;
  }

  const formFieldCandidates = record.form_field_candidates.filter(
    (candidate) => typeof candidate === "string",
  ) as string[];
  if (formFieldCandidates.length === 0) {
    return null;
  }

  return {
    placeholder_key: record.placeholder_key,
    form_field_candidates: formFieldCandidates,
    fallback: {
      page: fallback.page,
      x: fallback.x,
      y: fallback.y,
      font_size: fallback.font_size,
      max_width: fallback.max_width,
      ...(typeof fallback.height === "number"
        ? { height: fallback.height }
        : {}),
      ...(typeof fallback.line_height === "number"
        ? { line_height: fallback.line_height }
        : {}),
      ...(typeof fallback.max_lines === "number"
        ? { max_lines: fallback.max_lines }
        : {}),
      ...(typeof fallback.field_kind === "string"
        ? { field_kind: fallback.field_kind }
        : {}),
    },
  };
};

export async function loadCalOptimaPdfRenderMap(): Promise<
  PdfRenderMapEntry[]
> {
  if (cachedCalOptimaMap) {
    return cachedCalOptimaMap;
  }

  const raw = await readFile(CALOPTIMA_RENDER_MAP_PATH, "utf8");
  const parsed = JSON.parse(raw) as PdfRenderMapFile;
  const entries = Array.isArray(parsed.entries)
    ? parsed.entries.map(normalizeMapEntry).filter(Boolean)
    : [];

  if (entries.length === 0) {
    throw new Error("CalOptima PDF render map is missing or invalid.");
  }

  cachedCalOptimaMap = entries;
  return entries;
}

const formatDate = (value: string | null | undefined): string => {
  if (!value || value.trim().length === 0) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${month}/${day}/${year}`;
};

const formatWriterCredentials = (writer: AssessmentWriterSnapshot): string => {
  const parts = [
    writer.title,
    writer.license_number,
    writer.bcba_number,
    writer.rbt_number,
  ]
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return parts.join(" | ");
};

const formatDiagnosis = (diagnosis: string[] | null | undefined): string => {
  if (!Array.isArray(diagnosis) || diagnosis.length === 0) return "";
  return diagnosis
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .join("; ");
};

const formatAcceptedGoals = (goals: DraftGoalSnapshot[]): string => {
  if (goals.length === 0) return "";
  return goals
    .map((goal, index) => `${index + 1}. ${goal.title}: ${goal.description}`)
    .join("\n");
};

const formatStructuredPayload = (
  payload: Record<string, unknown> | null,
): string => {
  if (!payload) return "";
  if (Array.isArray(payload.rows)) {
    return payload.rows
      .map((row, index) => `${index + 1}. ${toText(row)}`)
      .filter((entry) => entry.trim().length > 3)
      .join("\n");
  }
  const orderedKeys = [
    "title",
    "description",
    "program_name",
    "goal_type",
    "target_behavior",
    "measurement_type",
    "baseline_data",
    "target_criteria",
    "mastery_criteria",
    "maintenance_criteria",
    "generalization_criteria",
    "rationale",
  ];
  const lines = orderedKeys
    .map((key) => {
      const value = toText(payload[key]);
      return value ? `${key.replace(/_/g, " ")}: ${value}` : "";
    })
    .filter(Boolean);
  const objectiveRows = Array.isArray(payload.objective_data_points)
    ? payload.objective_data_points.map(
        (row, index) => `objective ${index + 1}: ${toText(row)}`,
      )
    : [];
  return [...lines, ...objectiveRows].join("\n");
};

const getApprovedStructuredSectionsForKey = (
  placeholderKey: string,
  args: BuildTemplatePayloadArgs,
): AssessmentStructuredSectionValueRow[] =>
  (args.structuredSections ?? [])
    .filter(
      (section) =>
        section.field_key === placeholderKey && section.status === "approved",
    )
    .sort((left, right) => left.section_index - right.section_index);

const formatStructuredSections = (
  sections: AssessmentStructuredSectionValueRow[],
): string => {
  const blocks = sections
    .map((section, index) => {
      const formatted = formatStructuredPayload(section.payload);
      return formatted ? `${index + 1}. ${formatted}` : "";
    })
    .filter(Boolean);
  if (blocks.length === 0) return "";
  return blocks.join("\n\n");
};

const formatStructuredSectionsForKey = (
  placeholderKey: string,
  args: BuildTemplatePayloadArgs,
): string =>
  formatStructuredSections(
    getApprovedStructuredSectionsForKey(placeholderKey, args),
  );

const countFormattedStructuredSectionsForKey = (
  placeholderKey: string,
  args: BuildTemplatePayloadArgs,
): number =>
  getApprovedStructuredSectionsForKey(placeholderKey, args).filter(
    (section) => formatStructuredPayload(section.payload).length > 0,
  ).length;

const formatGoalAppendixNotice = (
  config: { singular: string; plural: string },
  count: number,
): string => {
  const label = count === 1 ? config.singular : config.plural;
  return `See Goal Detail Appendix for ${count} complete ${label}.`;
};

const buildGoalDetailAppendix = (args: BuildTemplatePayloadArgs): string => {
  const sections: string[] = [];

  CALOPTIMA_GOAL_APPENDIX_FIELDS.forEach((config, placeholderKey) => {
    const structuredText = formatStructuredSectionsForKey(placeholderKey, args);
    if (!structuredText) return;
    sections.push(`${config.heading}\n${structuredText}`);
  });

  const acceptedGoalsText = formatAcceptedGoals(args.acceptedGoals);
  if (acceptedGoalsText) {
    sections.push(`Accepted draft goals\n${acceptedGoalsText}`);
  }

  return sections.join("\n\n");
};

const formatAddress = (client: AssessmentClientSnapshot): string => {
  return [
    client.address_line1,
    client.address_line2,
    client.city,
    client.state,
    client.zip_code,
  ]
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .join(", ");
};

const getDerivedValue = (
  placeholderKey: string,
  args: BuildTemplatePayloadArgs,
  checklistValue: AssessmentChecklistValueRow | undefined,
): string => {
  const goalAppendixConfig = CALOPTIMA_GOAL_APPENDIX_FIELDS.get(placeholderKey);
  if (goalAppendixConfig) {
    const structuredSectionCount = countFormattedStructuredSectionsForKey(
      placeholderKey,
      args,
    );
    if (structuredSectionCount > 0) {
      return formatGoalAppendixNotice(
        goalAppendixConfig,
        structuredSectionCount,
      );
    }
  }

  const structuredText = formatStructuredSectionsForKey(placeholderKey, args);
  if (structuredText.length > 0) {
    return structuredText;
  }
  const checklistText = checklistValue
    ? toText(checklistValue.value_text ?? checklistValue.value_json)
    : "";
  if (checklistText.length > 0) {
    return checklistText;
  }

  const { client, writer, acceptedProgram, acceptedGoals } = args;
  if (goalAppendixConfig && acceptedGoals.length > 0) {
    const label =
      acceptedGoals.length === 1
        ? "accepted draft goal"
        : "accepted draft goals";
    return `See Goal Detail Appendix for ${acceptedGoals.length} ${label}.`;
  }

  switch (placeholderKey) {
    case "CALOPTIMA_FBA_MEMBER_NAME":
      return (
        client.full_name?.trim() ||
        `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim()
      );
    case "CALOPTIMA_FBA_MEMBER_DOB":
      return formatDate(client.date_of_birth);
    case "CALOPTIMA_FBA_CIN":
      return `${client.cin_number ?? client.client_id ?? ""}`.trim();
    case "CALOPTIMA_FBA_DIAGNOSES_ICD":
    case "CALOPTIMA_FBA_CURRENT_DIAGNOSIS_CODES":
      return formatDiagnosis(client.diagnosis);
    case "CALOPTIMA_FBA_GUARDIAN_NAME":
      return `${client.parent1_first_name ?? ""} ${client.parent1_last_name ?? ""}`.trim();
    case "CALOPTIMA_FBA_CONTACT_PHONE":
      return `${client.parent1_phone ?? client.phone ?? ""}`.trim();
    case "CALOPTIMA_FBA_REPORT_WRITTEN_BY":
      return `${writer.full_name ?? ""}`.trim();
    case "CALOPTIMA_FBA_WRITER_CREDENTIALS":
      return formatWriterCredentials(writer);
    case "CALOPTIMA_FBA_REPORT_COMPLETED_DATE":
      return formatDate(new Date().toISOString());
    case "CALOPTIMA_FBA_ADMIN_CONTACT_PHONE":
      return `${writer.phone ?? ""}`.trim();
    case "CALOPTIMA_FBA_PRESENT_ADDRESS":
      return formatAddress(client);
    case "CALOPTIMA_FBA_SUMMARY_RECOMMENDATIONS":
      return acceptedProgram
        ? `${acceptedProgram.name}\n${acceptedProgram.description ?? ""}\nGoals:\n${formatAcceptedGoals(acceptedGoals)}`
        : "";
    case "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS":
    case "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS":
    case "CALOPTIMA_FBA_PARENT_GOALS":
      return formatAcceptedGoals(acceptedGoals);
    default:
      return "";
  }
};

export async function buildCalOptimaTemplatePayload(
  args: BuildTemplatePayloadArgs,
): Promise<BuiltTemplatePayload> {
  const renderMap = await loadCalOptimaPdfRenderMap();
  const checklistByKey = new Map(
    args.checklistItems.map((item) => [item.placeholder_key, item]),
  );

  const values: Record<string, string> = {};
  const missingRequiredKeys: string[] = [];

  renderMap.forEach((entry) => {
    const checklistValue = checklistByKey.get(entry.placeholder_key);
    const value = getDerivedValue(entry.placeholder_key, args, checklistValue);
    values[entry.placeholder_key] = value;

    if (checklistValue?.required && value.trim().length === 0) {
      missingRequiredKeys.push(entry.placeholder_key);
    }
  });

  (args.structuredSections ?? []).forEach((section) => {
    if (
      section.required &&
      section.status === "approved" &&
      !values[section.field_key]?.trim()
    ) {
      missingRequiredKeys.push(section.field_key);
    }
  });

  const goalDetailAppendix = buildGoalDetailAppendix(args);
  if (goalDetailAppendix) {
    values[CALOPTIMA_GOAL_DETAIL_APPENDIX_KEY] = goalDetailAppendix;
  }

  return {
    values,
    missing_required_keys: missingRequiredKeys,
  };
}
