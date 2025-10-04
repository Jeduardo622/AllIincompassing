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

interface PayerCptRule {
  modifiers?: string[];
  longDurationThresholdMinutes?: number;
}

const DEFAULT_LONG_DURATION_THRESHOLD_MINUTES = 180;
const PAYER_RULE_KEY_WILDCARD = "*" as const;

const PAYER_SPECIFIC_RULES: Record<string, Record<string, PayerCptRule>> = {
  "caloptima-health": {
    "97153": { modifiers: ["U7", "U8"] },
    "97156": { modifiers: ["HO", "U8"] },
  },
  "anthem-blue-cross": {
    [PAYER_RULE_KEY_WILDCARD]: { modifiers: ["59"], longDurationThresholdMinutes: 150 },
    "97155": { longDurationThresholdMinutes: 120 },
  },
};

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

function canonicalizePayerSlug(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : null;
}

function extractPayerSlug(session: BookableSession): string | null {
  const record = session as Record<string, unknown>;

  const candidates: unknown[] = [
    record.payer_slug,
    record.payerSlug,
    record.payer_name,
    record.payerName,
  ];

  const nestedContainers: unknown[] = [
    record.payer,
    record.billing_profile,
    record.billingProfile,
    record.insurance,
  ];

  nestedContainers.forEach((container) => {
    if (container && typeof container === "object") {
      const nested = container as Record<string, unknown>;
      candidates.push(
        nested.slug,
        nested.payer_slug,
        nested.payerSlug,
        nested.code,
        nested.name,
      );
    }
  });

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const normalized = canonicalizePayerSlug(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function applyPayerSpecificRules(
  session: BookableSession,
  cptCode: string,
  modifiers: Set<string>,
): number {
  const payerSlug = extractPayerSlug(session);
  if (!payerSlug) {
    return DEFAULT_LONG_DURATION_THRESHOLD_MINUTES;
  }

  const payerRules = PAYER_SPECIFIC_RULES[payerSlug];
  if (!payerRules) {
    return DEFAULT_LONG_DURATION_THRESHOLD_MINUTES;
  }

  let threshold = DEFAULT_LONG_DURATION_THRESHOLD_MINUTES;
  let thresholdAssigned = false;

  const applyRule = (rule: PayerCptRule | undefined) => {
    if (!rule) {
      return;
    }

    if (Array.isArray(rule.modifiers)) {
      rule.modifiers.forEach((modifier) => {
        const normalized = normalizeModifier(modifier);
        if (normalized) {
          modifiers.add(normalized);
        }
      });
    }

    if (
      typeof rule.longDurationThresholdMinutes === "number"
      && Number.isFinite(rule.longDurationThresholdMinutes)
      && rule.longDurationThresholdMinutes > 0
    ) {
      threshold = rule.longDurationThresholdMinutes;
      thresholdAssigned = true;
    }
  };

  applyRule(payerRules[PAYER_RULE_KEY_WILDCARD]);
  applyRule(payerRules[cptCode]);

  return thresholdAssigned ? threshold : DEFAULT_LONG_DURATION_THRESHOLD_MINUTES;
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

  const longDurationThreshold = applyPayerSpecificRules(session, rule.code, modifiers);

  if (
    typeof durationMinutes === "number"
    && durationMinutes >= longDurationThreshold
  ) {
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
