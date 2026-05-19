export interface StructuredGoalSectionResult {
  section_key: string;
  field_key: string;
  section_index: number;
  payload: Record<string, unknown>;
  source_span: Record<string, unknown> | null;
  status: "not_started" | "drafted" | "verified" | "approved";
  required: boolean;
  review_notes: string | null;
}

const GOAL_HEADING_PATTERN =
  /(?:^|\s)(?:[A-Z]\.\s*)?(?:\d+\.\s*)?((?:replacement\s+behavior|target(?:\s+and\s+replacement)?(?:\s+behavior)?|skill\s+acquisition|parent\/caregiver|parent|caregiver)\s+goal)\s*(\d+|[A-Z])?\s*(?:\([^)]*\))?\s*(?::|[-–—])\s*/gi;

const CALOPTIMA_CHILD_GOAL_FIELD_KEYS = new Set([
  "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
  "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
]);
const CALOPTIMA_PARENT_GOAL_FIELD_KEYS = new Set(["CALOPTIMA_FBA_PARENT_GOALS"]);
const CHILD_GOAL_FIELD_KEYS = new Set([...CALOPTIMA_CHILD_GOAL_FIELD_KEYS]);
const PARENT_GOAL_FIELD_KEYS = new Set([...CALOPTIMA_PARENT_GOAL_FIELD_KEYS]);

const FIELD_PATTERN =
  /\b(program|description|target behavior|behavior|skill|measurement type|measure|baseline(?: data)?(?: and date| with dates)?|target criteria|criteria|mastery criteria|maintenance criteria|generalization criteria|rationale|objective data points?)\s*:\s*(.+?)(?=\s+\b(?:program|description|target behavior|behavior|skill|measurement type|measure|baseline(?: data)?(?: and date| with dates)?|target criteria|criteria|mastery criteria|maintenance criteria|generalization criteria|rationale|objective data points?)\s*:|$)/gi;

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const classifyHeading = (heading: string): {
  field_key: string;
  goal_type: "child" | "parent";
  program_name: string;
} => {
  const normalized = heading.toLowerCase();
  if (normalized.includes("parent") || normalized.includes("caregiver")) {
    return {
      field_key: "CALOPTIMA_FBA_PARENT_GOALS",
      goal_type: "parent",
      program_name: "Parent Training",
    };
  }
  if (normalized.includes("skill")) {
    return {
      field_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
      goal_type: "child",
      program_name: "Skill Acquisition",
    };
  }
  return {
    field_key: "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
    goal_type: "child",
    program_name: "Behavior Treatment",
  };
};

const titleFromGoalBody = (body: string): string => {
  const normalized = normalizeText(body);
  const [beforeIntermediate] = normalized.split(/\s+-\s*Intermediate|\s+⇒\s*Intermediate|\s+Intermediate[-\s]Term/i);
  const [beforeSection] = beforeIntermediate.split(/\s+(?:[IVXLCDM]{2,}|HCPCS Code|Telehealth Consent)\b/i);
  const [beforeMetadata] = beforeSection.split(
    /\s+(?:(?:a\.|b\.|c\.|\d+\.)\s*)?(?:Date|Location|Program|Description|Target Behavior|Behavior|Skill|Measurement Type|Measure|Baseline(?: Data)?(?: and Date| with Dates)?|Target Criteria|Criteria|Mastery Criteria|Maintenance Criteria|Generalization Criteria|Rationale|Objective data point)\b\s*:?/i,
  );
  return beforeMetadata.trim() || normalized;
};

const titleLooksLikeServiceLocation = (title: string): boolean => {
  const normalized = title.toLowerCase();
  return (
    /^[☐☑☒✓x\s]+/i.test(title) &&
    ["telehealth", "home", "school", "clinic", "community"].some((location) => normalized.includes(location))
  );
};

const titleFromHeading = (heading: string, headingNumber: string, sectionIndex: number): string => {
  const normalizedHeading = normalizeText(heading)
    .replace(/\btarget(?:\s+and\s+replacement)?(?:\s+behavior)?\s+goal\b/i, "Replacement Behavior Goal")
    .replace(/\bskill\s+acquisition\s+goal\b/i, "Skill Acquisition Goal")
    .replace(/\bparent\/caregiver\s+goal\b/i, "Parent/Caregiver Goal")
    .replace(/\bparent\s+goal\b/i, "Parent/Caregiver Goal")
    .replace(/\bcaregiver\s+goal\b/i, "Parent/Caregiver Goal");
  return `${normalizedHeading} ${headingNumber || sectionIndex + 1}`.trim();
};

const resolveGoalTitle = (body: string, heading: string, headingNumber: string, sectionIndex: number): string => {
  const parsedTitle = titleFromGoalBody(body);
  if (!parsedTitle || titleLooksLikeServiceLocation(parsedTitle)) {
    return titleFromHeading(heading, headingNumber, sectionIndex);
  }
  return parsedTitle;
};

const normalizeObjectKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const parseObjectiveDataPoints = (value: string): Array<Record<string, string>> => {
  const normalized = normalizeText(value);
  const rowTexts = normalized
    .split(/\s*(?:;|\n)\s*/)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);

  const rows = rowTexts.map((rowText) => {
    const row: Record<string, string> = {};
    const parts = rowText
      .split(/\s*\|\s*/)
      .map((part) => normalizeText(part))
      .filter(Boolean);

    for (const part of parts.length > 0 ? parts : [rowText]) {
      const match = /^([A-Za-z][A-Za-z0-9 _/-]{0,40})\s*:\s*(.+)$/.exec(part);
      if (match) {
        const key = normalizeObjectKey(match[1] ?? "");
        const fieldValue = normalizeText(match[2] ?? "");
        if (key && fieldValue) {
          row[key] = fieldValue;
        }
        continue;
      }
      row.raw_text = row.raw_text ? `${row.raw_text} | ${part}` : part;
    }

    return Object.keys(row).length > 0 ? row : { raw_text: rowText };
  });

  return rows.length > 0 ? rows : [{ raw_text: normalized }];
};

const parseGoalFields = (body: string): Record<string, string | Array<Record<string, string>>> => {
  const fields: Record<string, string | Array<Record<string, string>>> = {};
  let match: RegExpExecArray | null;
  while ((match = FIELD_PATTERN.exec(body)) !== null) {
    const rawKey = match[1]?.toLowerCase().replace(/\s+/g, "_") ?? "";
    const value = normalizeText(match[2] ?? "");
    if (!rawKey || !value) {
      continue;
    }
    const key = rawKey
      .replace(/^measure$/, "measurement_type")
      .replace(/^baseline(?:_data)?(?:_and_date|_with_dates)?$/, "baseline_data")
      .replace(/^objective_data_points?$/, "objective_data_points");
    if (key === "objective_data_points") {
      fields.objective_data_points = parseObjectiveDataPoints(value);
      continue;
    }
    fields[key === "behavior" || key === "skill" ? "target_behavior" : key] = value;
  }
  return fields;
};

export const extractStructuredGoalSections = (text: string): StructuredGoalSectionResult[] => {
  const matches = [...text.matchAll(GOAL_HEADING_PATTERN)];
  const sections: StructuredGoalSectionResult[] = [];

  matches.forEach((match, index) => {
    const heading = normalizeText(match[1] ?? "");
    const headingNumber = normalizeText(match[2] ?? "");
    const bodyStart = match.index ?? 0;
    const contentStart = bodyStart + match[0].length;
    const nextStart = matches[index + 1]?.index ?? text.length;
    const body = normalizeText(text.slice(contentStart, nextStart));
    if (!heading || body.length < 20) {
      return;
    }
    const classification = classifyHeading(heading);
    const parsedFields = parseGoalFields(body);
    const originalText = normalizeText(text.slice(bodyStart, nextStart));

    sections.push({
      section_key: "goals_treatment_planning",
      field_key: classification.field_key,
      section_index: sections.filter((section) => section.field_key === classification.field_key).length,
      payload: {
        title: resolveGoalTitle(body, heading, headingNumber, index),
        goal_type: classification.goal_type,
        program_name: typeof parsedFields.program === "string" ? parsedFields.program : classification.program_name,
        original_text: originalText,
        ...parsedFields,
      },
      source_span: {
        method: "deterministic_embedded_goal_heading",
        heading,
        heading_number: headingNumber || null,
        start_offset: bodyStart,
        end_offset: nextStart,
      },
      status: "drafted",
      required: true,
      review_notes: "Deterministic structured goal block extracted from embedded CalOptima goal heading.",
    });
  });

  return sections;
};

export const summarizeStructuredGoalSections = (sections: Array<{ field_key: string; payload: Record<string, unknown> }>) => {
  const childGoalCount = sections.filter((section) =>
    CHILD_GOAL_FIELD_KEYS.has(section.field_key) ||
    section.payload.goal_type === "child"
  ).length;
  const parentGoalCount = sections.filter((section) =>
    PARENT_GOAL_FIELD_KEYS.has(section.field_key) || section.payload.goal_type === "parent"
  ).length;
  return { childGoalCount, parentGoalCount };
};
