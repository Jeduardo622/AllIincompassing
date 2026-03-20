export interface AssessmentChecklistValueRow {
  section_key: string;
  label: string;
  placeholder_key: string;
  value_text: string | null;
  value_json: Record<string, unknown> | null;
}

const GOAL_SECTION_HINTS = [
  "goal",
  "treatment_planning",
  "recommendation",
  "replacement",
  "skill_acquisition",
  "parent",
  "generalization",
  "maintenance",
];

const PRIORITIZED_JSON_KEYS = [
  "title",
  "target_behavior",
  "measurement_type",
  "baseline_data",
  "target_criteria",
  "mastery_criteria",
  "maintenance_criteria",
  "generalization_criteria",
  "objective_data_points",
] as const;

const hasStructuredValue = (value: Record<string, unknown> | null | undefined): value is Record<string, unknown> =>
  !!value && Object.keys(value).length > 0;

const sectionPriority = (sectionKey: string): number => {
  const normalized = sectionKey.toLowerCase();
  if (GOAL_SECTION_HINTS.some((hint) => normalized.includes(hint))) {
    return 0;
  }
  return 1;
};

const compactWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();
const truncateText = (value: string, maxChars: number): string =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars - 3)}...`;

const safeStringify = (value: unknown, maxChars = 280): string => {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) {
    return serialized;
  }
  return `${serialized.slice(0, maxChars - 3)}...`;
};

const valueJsonSummary = (valueJson: Record<string, unknown>): string | null => {
  const orderedKeys = [
    ...PRIORITIZED_JSON_KEYS,
    ...Object.keys(valueJson).filter((key) => !PRIORITIZED_JSON_KEYS.includes(key as (typeof PRIORITIZED_JSON_KEYS)[number])),
  ];

  const parts: string[] = [];
  for (const key of orderedKeys) {
    if (!(key in valueJson)) {
      continue;
    }
    const rawValue = valueJson[key];
    if (rawValue === null || rawValue === undefined) {
      continue;
    }
    if (typeof rawValue === "string") {
      const compact = compactWhitespace(rawValue);
      if (compact.length > 0) {
        parts.push(`${key}: ${truncateText(compact, 280)}`);
      }
      continue;
    }
    if (typeof rawValue === "number" || typeof rawValue === "boolean") {
      parts.push(`${key}: ${String(rawValue)}`);
      continue;
    }
    parts.push(`${key}: ${safeStringify(rawValue)}`);
  }

  if (parts.length === 0) {
    return null;
  }
  return parts.join(" | ");
};

const formatRowValue = (row: AssessmentChecklistValueRow): string | null => {
  const textPart = row.value_text ? compactWhitespace(row.value_text) : "";
  const jsonSummary = hasStructuredValue(row.value_json) ? valueJsonSummary(row.value_json) : null;
  if (textPart.length > 0 && jsonSummary) {
    return `- ${row.label}: ${textPart} | ${jsonSummary}`;
  }
  if (textPart.length > 0) {
    return `- ${row.label}: ${textPart}`;
  }
  if (jsonSummary) {
    return `- ${row.label}: ${jsonSummary}`;
  }
  return null;
};

export const composeAssessmentTextFromChecklist = (rows: AssessmentChecklistValueRow[]): string => {
  const grouped = new Map<string, string[]>();
  rows.forEach((row) => {
    const line = formatRowValue(row);
    if (!line) {
      return;
    }
    const sectionLines = grouped.get(row.section_key) ?? [];
    sectionLines.push(line);
    grouped.set(row.section_key, sectionLines);
  });

  const orderedSections = Array.from(grouped.entries()).sort(([leftSection], [rightSection]) => {
    const leftPriority = sectionPriority(leftSection);
    const rightPriority = sectionPriority(rightSection);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return leftSection.localeCompare(rightSection);
  });

  const blocks = orderedSections
    .map(([section, sectionLines]) => {
      const title = section.replace(/_/g, " ").toUpperCase();
      const values = sectionLines.join("\n");
      return values.length > 0 ? `${title}\n${values}` : null;
    })
    .filter((value): value is string => value !== null);

  return blocks.join("\n\n").trim();
};
