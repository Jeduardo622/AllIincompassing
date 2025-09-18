import type { BookableSession, BookingOverrides, DerivedCpt } from "./types";
import type { SessionTypeRule } from "./cptRules";
import {
  CPT_DESCRIPTIONS,
  FALLBACK_RULE,
  LOCATION_MODIFIER_RULES,
  LONG_DURATION_MODIFIER,
  LONG_DURATION_THRESHOLD_MINUTES,
  SESSION_TYPE_RULES,
  normalizeBillingCode,
} from "./cptRules";

interface DeriveCptInput {
  session: BookableSession;
  overrides?: BookingOverrides;
}

function computeDurationMinutes(session: BookableSession): number | null {
  try {
    const start = new Date(session.start_time);
    const end = new Date(session.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null;
    }
    const diff = (end.getTime() - start.getTime()) / 60000;
    if (!Number.isFinite(diff) || diff <= 0) {
      return null;
    }
    return Math.round(diff);
  } catch (error) {
    console.warn("Failed to compute session duration", error);
    return null;
  }
}

function deriveBaseRule(session: BookableSession, overrides?: BookingOverrides): {
  rule: SessionTypeRule;
  source: DerivedCpt["source"];
} {
  const overrideCode = normalizeBillingCode(overrides?.cptCode ?? null);
  if (overrideCode) {
    const description = CPT_DESCRIPTIONS[overrideCode] ?? "Custom CPT code";
    return {
      rule: { code: overrideCode, description },
      source: "override",
    };
  }

  const normalizedType = typeof session.session_type === "string"
    ? session.session_type.trim().toLowerCase()
    : "";

  if (normalizedType && SESSION_TYPE_RULES[normalizedType]) {
    return { rule: SESSION_TYPE_RULES[normalizedType], source: "session_type" };
  }

  return { rule: FALLBACK_RULE, source: "fallback" };
}

function appendLocationModifiers(session: BookableSession, modifiers: Set<string>) {
  const location = typeof session.location_type === "string"
    ? session.location_type.trim().toLowerCase()
    : "";

  if (location.length === 0) {
    return;
  }

  LOCATION_MODIFIER_RULES.forEach((rule) => {
    if (rule.keywords.some((keyword) => location.includes(keyword))) {
      modifiers.add(rule.modifier);
    }
  });
}

export function deriveCptMetadata({ session, overrides }: DeriveCptInput): DerivedCpt {
  const { rule, source } = deriveBaseRule(session, overrides);
  const durationMinutes = computeDurationMinutes(session);
  const modifiers = new Set<string>();

  if (Array.isArray(overrides?.modifiers)) {
    overrides?.modifiers.forEach((modifier) => {
      const normalized = normalizeBillingCode(modifier);
      if (normalized) {
        modifiers.add(normalized);
      }
    });
  }

  rule.defaultModifiers?.forEach((modifier) => {
    const normalized = normalizeBillingCode(modifier);
    if (normalized) {
      modifiers.add(normalized);
    }
  });

  appendLocationModifiers(session, modifiers);

  if (
    typeof durationMinutes === "number"
    && durationMinutes >= LONG_DURATION_THRESHOLD_MINUTES
  ) {
    modifiers.add(LONG_DURATION_MODIFIER);
  }

  return {
    code: rule.code,
    description: rule.description,
    modifiers: [...modifiers],
    source,
    durationMinutes,
  };
}
