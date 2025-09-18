import type { BookableSession, BookingOverrides, DerivedCpt } from "./types";

interface DeriveCptInput {
  session: BookableSession;
  overrides?: BookingOverrides;
}

interface SessionTypeRule {
  code: string;
  description: string;
  defaultModifiers?: string[];
}

const SESSION_TYPE_RULES: Record<string, SessionTypeRule> = {
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
    description: "Behavior identification assessment by a physician or other qualified health care professional",
  },
  consultation: {
    code: "97156",
    description: "Family adaptive behavior guidance and therapy",
    defaultModifiers: ["HO"],
  },
};

const CPT_DESCRIPTIONS: Record<string, string> = Object.values(SESSION_TYPE_RULES).reduce(
  (acc, rule) => ({ ...acc, [rule.code]: rule.description }),
  {
    "97155": "Adaptive behavior treatment with protocol modification",
    "97158": "Group adaptive behavior treatment with protocol modification",
  },
);

const FALLBACK_RULE: SessionTypeRule = {
  code: "97153",
  description: "Adaptive behavior treatment by protocol",
};

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

function normalizeModifier(candidate: unknown): string | null {
  if (typeof candidate !== "string") {
    return null;
  }
  const trimmed = candidate.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveBaseRule(session: BookableSession, overrides?: BookingOverrides): {
  rule: SessionTypeRule;
  source: DerivedCpt["source"];
} {
  const overrideCode = normalizeModifier(overrides?.cptCode ?? null);
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

  if (location.includes("tele") || location.includes("virtual") || location.includes("remote")) {
    modifiers.add("95");
  }

  if (location.includes("school")) {
    modifiers.add("HQ");
  }
}

export function deriveCptMetadata({ session, overrides }: DeriveCptInput): DerivedCpt {
  const { rule, source } = deriveBaseRule(session, overrides);
  const durationMinutes = computeDurationMinutes(session);
  const modifiers = new Set<string>();

  if (Array.isArray(overrides?.modifiers)) {
    overrides?.modifiers.forEach((modifier) => {
      const normalized = normalizeModifier(modifier);
      if (normalized) {
        modifiers.add(normalized);
      }
    });
  }

  rule.defaultModifiers?.forEach((modifier) => {
    const normalized = normalizeModifier(modifier);
    if (normalized) {
      modifiers.add(normalized);
    }
  });

  appendLocationModifiers(session, modifiers);

  if (typeof durationMinutes === "number" && durationMinutes >= 180) {
    modifiers.add("KX");
  }

  return {
    code: rule.code,
    description: rule.description,
    modifiers: [...modifiers],
    source,
    durationMinutes,
  };
}
