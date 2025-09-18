import type { BookableSession } from "./types";

export interface SessionTypeRule {
  code: string;
  description: string;
  defaultModifiers?: string[];
}

export interface LocationModifierRule {
  modifier: string;
  keywords: string[];
}

export const SESSION_TYPE_RULES: Record<string, SessionTypeRule> = {
  individual: {
    code: "97153",
    description: "Adaptive behavior treatment by protocol",
  },
  group: {
    code: "97154",
    description: "Group adaptive behavior treatment by protocol",
    defaultModifiers: ["HQ"],
  },
  assessment: {
    code: "97151",
    description:
      "Behavior identification assessment by a physician or other qualified health care professional",
  },
  consultation: {
    code: "97156",
    description: "Family adaptive behavior guidance and therapy",
    defaultModifiers: ["HO"],
  },
} as const;

export const FALLBACK_RULE: SessionTypeRule = {
  code: SESSION_TYPE_RULES.individual.code,
  description: SESSION_TYPE_RULES.individual.description,
};

export const CPT_DESCRIPTIONS: Record<string, string> = Object.values(SESSION_TYPE_RULES).reduce(
  (acc, rule) => ({ ...acc, [rule.code]: rule.description }),
  {
    "97155": "Adaptive behavior treatment with protocol modification",
    "97158": "Group adaptive behavior treatment with protocol modification",
  },
);

export const LOCATION_MODIFIER_RULES: LocationModifierRule[] = [
  { modifier: "95", keywords: ["tele", "virtual", "remote"] },
  { modifier: "HQ", keywords: ["school"] },
];

export const LONG_DURATION_THRESHOLD_MINUTES = 180;
export const LONG_DURATION_MODIFIER = "KX";
export const BILLING_UNIT_MINUTES = 15;

export function normalizeBillingCode(candidate: unknown): string | null {
  if (typeof candidate !== "string") {
    return null;
  }
  const trimmed = candidate.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveSessionTypeRule(session: BookableSession): SessionTypeRule {
  const normalizedType = typeof session.session_type === "string"
    ? session.session_type.trim().toLowerCase()
    : "";

  if (normalizedType && SESSION_TYPE_RULES[normalizedType]) {
    return SESSION_TYPE_RULES[normalizedType];
  }

  return FALLBACK_RULE;
}
