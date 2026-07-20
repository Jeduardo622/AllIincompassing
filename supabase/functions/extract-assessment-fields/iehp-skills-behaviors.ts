export interface IehpSkillsBehaviorsSection {
  field_key: string;
  section_index: number;
  payload: Record<string, unknown>;
}

export type IehpClinicalGoalType = "behavior" | "skill";
export type IehpClassificationSource = "explicit_goal_type" | "detailed_goal_field_key";
export type IehpReconciliationStatus = "matched" | "summary_only" | "ambiguous" | "detailed_only";

export interface IehpSkillsBehaviorsItem {
  name: string;
  clinical_goal_type: IehpClinicalGoalType | null;
  reconciliation_status: IehpReconciliationStatus;
  summary_target_index: number | null;
  matched_goal_refs: Array<{ field_key: string; section_index: number }>;
  classification_source: IehpClassificationSource | null;
}

export interface IehpSkillsBehaviorsResult {
  version: 1;
  items: IehpSkillsBehaviorsItem[];
  counts: {
    total: number;
    behavior: number;
    skill: number;
    summary_only: number;
    detailed_only: number;
    ambiguous: number;
  };
}

interface DetailedGoalCandidate {
  name: string;
  normalized_name: string;
  aliases: string[];
  field_key: string;
  section_index: number;
  clinical_goal_type: IehpClinicalGoalType;
  classification_source: IehpClassificationSource;
}

const SUMMARY_FIELD_KEY = "IEHP_FBA_BEHAVIOR_SKILL_TARGETS";
const DETAILED_GOAL_FIELD_KEYS = new Set([
  "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS",
  "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS",
]);

const normalizeScalar = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const stripBoundaryPunctuation = (value: string): string => value.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");

const normalizeComparableName = (value: unknown): string =>
  stripBoundaryPunctuation(normalizeScalar(value))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const readSummaryTargets = (payload: Record<string, unknown>): string[] => {
  const rawTargets = payload.targets;
  return Array.isArray(rawTargets)
    ? rawTargets
    .map((target) => normalizeScalar(target))
    .filter(Boolean)
    : [];
};

const isDetailedGoalSection = (section: IehpSkillsBehaviorsSection): boolean =>
  DETAILED_GOAL_FIELD_KEYS.has(section.field_key) && typeof section.payload === "object" && section.payload !== null;

const resolveClinicalGoalType = (
  section: IehpSkillsBehaviorsSection,
): { value: IehpClinicalGoalType; source: IehpClassificationSource } | null => {
  const explicitGoalType = normalizeComparableName(section.payload.clinical_goal_type);
  if (explicitGoalType === "behavior" || explicitGoalType === "skill") {
    return { value: explicitGoalType, source: "explicit_goal_type" };
  }

  if (section.field_key === "IEHP_FBA_TARGET_BEHAVIOR_INTERVENTION_BLOCKS") {
    return { value: "behavior", source: "detailed_goal_field_key" };
  }
  if (section.field_key === "IEHP_FBA_SKILL_AND_SCHOOL_GOAL_BLOCKS") {
    return { value: "skill", source: "detailed_goal_field_key" };
  }

  return null;
};

const uniqueAliases = (values: unknown[]): string[] => {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const value of values) {
    const normalized = normalizeComparableName(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    aliases.push(normalized);
  }
  return aliases;
};

const toDetailedGoalCandidate = (
  section: IehpSkillsBehaviorsSection,
): DetailedGoalCandidate | null => {
  const resolvedGoalType = resolveClinicalGoalType(section);
  if (!resolvedGoalType) {
    return null;
  }

  const aliases = uniqueAliases([
    section.payload.program_name,
    section.payload.title,
    section.payload.target_behavior,
  ]);
  if (aliases.length === 0) {
    return null;
  }

  const name = [
    normalizeScalar(section.payload.program_name),
    normalizeScalar(section.payload.title),
    normalizeScalar(section.payload.target_behavior),
  ].find(Boolean);
  if (!name) {
    return null;
  }

  return {
    name,
    normalized_name: normalizeComparableName(name),
    aliases,
    field_key: section.field_key,
    section_index: section.section_index,
    clinical_goal_type: resolvedGoalType.value,
    classification_source: resolvedGoalType.source,
  };
};

const reconcileTargets = (
  targets: readonly string[],
  goals: readonly DetailedGoalCandidate[],
): IehpSkillsBehaviorsResult => {
  const goalMatchesByAlias = new Map<string, DetailedGoalCandidate[]>();
  for (const goal of goals) {
    for (const alias of goal.aliases) {
      const existing = goalMatchesByAlias.get(alias) ?? [];
      existing.push(goal);
      goalMatchesByAlias.set(alias, existing);
    }
  }

  const consumedGoalRefs = new Set<string>();
  const items: IehpSkillsBehaviorsItem[] = [];

  targets.forEach((target, summaryTargetIndex) => {
    const normalizedTarget = normalizeComparableName(target);
    const matches = normalizedTarget
      ? (goalMatchesByAlias.get(normalizedTarget) ?? []).filter((goal, index, source) =>
        source.findIndex((candidate) =>
          candidate.field_key === goal.field_key && candidate.section_index === goal.section_index
        ) === index
      )
      : [];

    matches.forEach((goal) => consumedGoalRefs.add(`${goal.field_key}:${goal.section_index}`));

    if (matches.length === 0) {
      items.push({
        name: target,
        clinical_goal_type: null,
        reconciliation_status: "summary_only",
        summary_target_index: summaryTargetIndex,
        matched_goal_refs: [],
        classification_source: null,
      });
      return;
    }

    if (matches.length > 1) {
      items.push({
        name: target,
        clinical_goal_type: null,
        reconciliation_status: "ambiguous",
        summary_target_index: summaryTargetIndex,
        matched_goal_refs: matches.map(({ field_key, section_index }) => ({ field_key, section_index })),
        classification_source: null,
      });
      return;
    }

    const match = matches[0];
    items.push({
      name: target,
      clinical_goal_type: match.clinical_goal_type,
      reconciliation_status: "matched",
      summary_target_index: summaryTargetIndex,
      matched_goal_refs: [{ field_key: match.field_key, section_index: match.section_index }],
      classification_source: match.classification_source,
    });
  });

  const remainingGoals = goals.filter((goal) => !consumedGoalRefs.has(`${goal.field_key}:${goal.section_index}`));
  const remainingByAlias = new Map<string, DetailedGoalCandidate[]>();
  for (const goal of remainingGoals) {
    for (const alias of goal.aliases) {
      const existing = remainingByAlias.get(alias) ?? [];
      existing.push(goal);
      remainingByAlias.set(alias, existing);
    }
  }

  const visitedRefs = new Set<string>();
  for (const goal of remainingGoals) {
    const goalRef = `${goal.field_key}:${goal.section_index}`;
    if (visitedRefs.has(goalRef)) {
      continue;
    }

    const stack = [goal];
    const group: DetailedGoalCandidate[] = [];
    const groupRefs = new Set<string>();

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      const currentRef = `${current.field_key}:${current.section_index}`;
      if (groupRefs.has(currentRef)) {
        continue;
      }
      groupRefs.add(currentRef);
      visitedRefs.add(currentRef);
      group.push(current);

      for (const alias of current.aliases) {
        for (const relatedGoal of remainingByAlias.get(alias) ?? []) {
          const relatedRef = `${relatedGoal.field_key}:${relatedGoal.section_index}`;
          if (!groupRefs.has(relatedRef)) {
            stack.push(relatedGoal);
          }
        }
      }
    }

    if (group.length > 1) {
      items.push({
        name: goal.name,
        clinical_goal_type: null,
        reconciliation_status: "ambiguous",
        summary_target_index: null,
        matched_goal_refs: group.map(({ field_key, section_index }) => ({ field_key, section_index })),
        classification_source: null,
      });
      continue;
    }

    items.push({
      name: goal.name,
      clinical_goal_type: goal.clinical_goal_type,
      reconciliation_status: "detailed_only",
      summary_target_index: null,
      matched_goal_refs: [{ field_key: goal.field_key, section_index: goal.section_index }],
      classification_source: goal.classification_source,
    });
  }

  return {
    version: 1,
    items,
    counts: {
      total: items.length,
      behavior: items.filter((item) => item.clinical_goal_type === "behavior").length,
      skill: items.filter((item) => item.clinical_goal_type === "skill").length,
      summary_only: items.filter((item) => item.reconciliation_status === "summary_only").length,
      detailed_only: items.filter((item) => item.reconciliation_status === "detailed_only").length,
      ambiguous: items.filter((item) => item.reconciliation_status === "ambiguous").length,
    },
  };
};

export const buildIehpSkillsBehaviorsResult = (
  sections: readonly IehpSkillsBehaviorsSection[],
): IehpSkillsBehaviorsResult | null => {
  const summary = sections.find((section) => section.field_key === SUMMARY_FIELD_KEY);
  if (!summary) {
    return null;
  }

  const targets = readSummaryTargets(summary.payload);
  const childGoals = sections
    .filter(isDetailedGoalSection)
    .filter((section) => normalizeScalar(section.payload.goal_type) !== "parent")
    .map(toDetailedGoalCandidate)
    .filter((candidate): candidate is DetailedGoalCandidate => candidate !== null);

  return reconcileTargets(targets, childGoals);
};
