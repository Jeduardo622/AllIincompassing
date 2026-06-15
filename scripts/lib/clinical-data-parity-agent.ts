export type ClinicalQaCredentialCandidate = {
  email?: string;
  password?: string;
  label: string;
};

export type ClinicalQaCredentials = {
  email: string;
  password: string;
  label: string;
};

export type ClinicalQaChecklistItem = {
  key: string;
  label: string;
  requiredTerms: string[];
};

export type ClinicalQaChecklistResult = {
  key: string;
  label: string;
  status: "pass" | "fail";
  missingTerms: string[];
};

const REDACTED_PASSWORD_PLACEHOLDER = "****";

export const DEFAULT_CLINICAL_QA_ROUTE = "/";

export const CLINICAL_DATA_PARITY_CHECKLIST: ClinicalQaChecklistItem[] = [
  {
    key: "client_context",
    label: "Client and assessment context are visible",
    requiredTerms: ["client", "assessment"],
  },
  {
    key: "fba_surface",
    label: "FBA workflow or output surface is visible",
    requiredTerms: ["fba"],
  },
  {
    key: "program_goal_surface",
    label: "Programs/goals review surface is visible",
    requiredTerms: ["program", "goal"],
  },
];

export const assertBrowserOnlyTarget = (routePath: string): string => {
  const trimmed = routePath.trim();
  if (!trimmed.startsWith("/")) {
    throw new Error("PW_CLINICAL_QA_ROUTE must be an app-relative path that starts with '/'.");
  }
  if (/^\/api(?:\/|$)/i.test(trimmed)) {
    throw new Error("PW_CLINICAL_QA_ROUTE must target a browser route, not an API route.");
  }
  if (/^\/(?:admin|super-admin)(?:\/|$)/i.test(trimmed)) {
    throw new Error("PW_CLINICAL_QA_ROUTE must not target admin-only routes for this read-only QA agent.");
  }
  return trimmed;
};

export const requireClinicalQaClientId = (value: string | undefined): string | null => {
  const clientId = value?.trim();
  return clientId && clientId.length > 0 ? clientId : null;
};

export const assertRedactedQaFixture = (value: string | undefined, label: string): string | null => {
  const fixturePath = value?.trim();
  if (!fixturePath) {
    return null;
  }
  if (!/\b(redacted|synthetic|smoke|test)\b/i.test(fixturePath)) {
    throw new Error(`${label} must point to a clearly redacted, synthetic, smoke, or test fixture.`);
  }
  return fixturePath;
};

export const selectClinicalQaCredentials = (
  candidates: ClinicalQaCredentialCandidate[],
): ClinicalQaCredentials => {
  for (const candidate of candidates) {
    const email = candidate.email?.trim();
    const password = candidate.password?.trim();
    if (!email || !password) {
      continue;
    }
    if (password === REDACTED_PASSWORD_PLACEHOLDER) {
      throw new Error(`${candidate.label} cannot use placeholder password "${REDACTED_PASSWORD_PLACEHOLDER}".`);
    }
    return { email, password, label: candidate.label };
  }

  throw new Error(
    "Missing clinical QA browser credentials. Set PW_CLINICAL_QA_EMAIL/PW_CLINICAL_QA_PASSWORD or PW_ADMIN_EMAIL/PW_ADMIN_PASSWORD.",
  );
};

export const buildClinicalQaRoute = (args: {
  routePath?: string;
  clientId?: string | null;
}): string => {
  if (args.routePath?.trim()) {
    return assertBrowserOnlyTarget(args.routePath);
  }
  if (args.clientId) {
    return `/clients/${encodeURIComponent(args.clientId)}?tab=programs-goals`;
  }
  return DEFAULT_CLINICAL_QA_ROUTE;
};

export const evaluateClinicalQaChecklist = (
  pageText: string,
  checklist: ClinicalQaChecklistItem[] = CLINICAL_DATA_PARITY_CHECKLIST,
): ClinicalQaChecklistResult[] => {
  const normalizedText = pageText.toLowerCase();
  return checklist.map((item) => {
    const missingTerms = item.requiredTerms.filter((term) => !normalizedText.includes(term.toLowerCase()));
    return {
      key: item.key,
      label: item.label,
      status: missingTerms.length === 0 ? "pass" : "fail",
      missingTerms,
    };
  });
};
