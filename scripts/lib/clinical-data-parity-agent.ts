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

export type ClinicalQaParitySeverity = "low" | "medium" | "high";

export type ClinicalQaParityExpectation = {
  key: string;
  label: string;
  sourceSection: string | null;
  expectedTerms: string[];
  observedSectionTerms: string[];
  severity: ClinicalQaParitySeverity;
  humanReviewBlocker: boolean;
};

export type ClinicalQaEvidenceSection = {
  label: string;
  text: string;
};

export type ClinicalQaSectionEvidenceResult = {
  sectionLabel: string;
  matchedTerms: string[];
  missingTerms: string[];
  observedTextSnippet: string | null;
};

export type ClinicalQaParityFinding = ClinicalQaParityExpectation & {
  status: "pass" | "fail";
  mismatchType: "match" | "partial" | "missing";
  matchedTerms: string[];
  missingTerms: string[];
  observedSectionMatchedTerms: string[];
  observedSectionMissingTerms: string[];
  observedTextSnippet: string | null;
  sectionEvidenceStatus?: "match" | "partial" | "missing" | "not_evaluated";
  sectionEvidence?: ClinicalQaSectionEvidenceResult[];
};

export type ClinicalQaReportInput = {
  generatedAt: string;
  baseUrl: string;
  routePath: string;
  credentialLabel: string;
  screenshotPath: string;
  checklist: ClinicalQaChecklistResult[];
  dataParityFindings: ClinicalQaParityFinding[];
  disclaimer: string;
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

export const assertSupportedClinicalQaSourceTextFixture = (fixturePath: string): string => {
  if (!/\.(?:txt|md)$/i.test(fixturePath)) {
    throw new Error(
      "PW_CLINICAL_QA_SOURCE_FILE text extraction currently supports .txt or .md fixtures; provide PW_CLINICAL_QA_EXPECTATIONS_FILE for DOCX/PDF.",
    );
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

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);

const normalizeSeverity = (value: unknown): ClinicalQaParitySeverity => {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "medium";
};

const normalizeOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeOptionalStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const sanitizeEvidenceText = (value: string): string =>
  value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]");

const normalizeSourceText = (value: string): string =>
  sanitizeEvidenceText(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n");

const splitExpectedTerms = (value: string | null): string[] => {
  if (!value) {
    return [];
  }
  const seen = new Set<string>();
  return value
    .split(/[;,]|\n/)
    .map((term) => term.trim().replace(/[.]+$/g, ""))
    .filter((term) => term.length > 0)
    .filter((term) => {
      const normalized = term.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
};

const extractLabeledTerms = (sourceText: string, labelPattern: RegExp): string[] => {
  const match = sourceText.match(labelPattern);
  return splitExpectedTerms(match?.[1] ?? null);
};

type SourceTextExpectationDefinition = {
  key: string;
  label: string;
  sourceSection: string;
  labelPattern: RegExp;
  observedSectionTerms: string[];
  severity: ClinicalQaParitySeverity;
  humanReviewBlocker: boolean;
};

const SOURCE_TEXT_EXPECTATION_DEFINITIONS: SourceTextExpectationDefinition[] = [
  {
    key: "target_behaviors",
    label: "Target behaviors",
    sourceSection: "FBA target behavior summary",
    labelPattern: /(?:^|\n)\s*target behaviors?\s*:\s*([^\n]+)/i,
    observedSectionTerms: ["Programs", "Goals"],
    severity: "high",
    humanReviewBlocker: true,
  },
  {
    key: "replacement_behavior",
    label: "Replacement behavior",
    sourceSection: "Replacement behavior plan",
    labelPattern: /(?:^|\n)\s*replacement behavior\s*:\s*([^\n]+)/i,
    observedSectionTerms: ["Programs", "Goals"],
    severity: "medium",
    humanReviewBlocker: false,
  },
  {
    key: "program_goal_measurement",
    label: "Program goal measurement",
    sourceSection: "Goals and measurement criteria",
    labelPattern: /(?:^|\n)\s*measurement terms?\s*:\s*([^\n]+)/i,
    observedSectionTerms: ["Programs", "Goals"],
    severity: "medium",
    humanReviewBlocker: false,
  },
  {
    key: "antecedents",
    label: "Antecedents",
    sourceSection: "ABC and function summary",
    labelPattern: /(?:^|\n)\s*antecedents?\s*:\s*([^\n]+)/i,
    observedSectionTerms: ["Assessment", "Programs", "Goals"],
    severity: "high",
    humanReviewBlocker: true,
  },
  {
    key: "consequences",
    label: "Consequences",
    sourceSection: "ABC and function summary",
    labelPattern: /(?:^|\n)\s*consequences?\s*:\s*([^\n]+)/i,
    observedSectionTerms: ["Assessment", "Programs", "Goals"],
    severity: "high",
    humanReviewBlocker: true,
  },
  {
    key: "functions",
    label: "Behavior functions",
    sourceSection: "ABC and function summary",
    labelPattern: /(?:^|\n)\s*functions?\s*:\s*([^\n]+)/i,
    observedSectionTerms: ["Assessment", "Programs", "Goals"],
    severity: "high",
    humanReviewBlocker: true,
  },
  {
    key: "interventions",
    label: "Interventions",
    sourceSection: "Intervention plan",
    labelPattern: /(?:^|\n)\s*interventions?\s*:\s*([^\n]+)/i,
    observedSectionTerms: ["Programs", "Goals"],
    severity: "medium",
    humanReviewBlocker: false,
  },
  {
    key: "client_metadata",
    label: "Client metadata",
    sourceSection: "Authorization and client metadata",
    labelPattern: /(?:^|\n)\s*client identifiers?\s*:\s*([^\n]+)/i,
    observedSectionTerms: ["Client", "Assessment"],
    severity: "medium",
    humanReviewBlocker: false,
  },
  {
    key: "authorization_metadata",
    label: "Authorization metadata",
    sourceSection: "Authorization and client metadata",
    labelPattern: /(?:^|\n)\s*authorization details?\s*:\s*([^\n]+)/i,
    observedSectionTerms: ["Authorization", "Client"],
    severity: "medium",
    humanReviewBlocker: false,
  },
];

export const deriveClinicalQaExpectationsFromSourceText = (
  sourceText: string,
): ClinicalQaParityExpectation[] => {
  const normalizedSourceText = normalizeSourceText(sourceText);

  return SOURCE_TEXT_EXPECTATION_DEFINITIONS.flatMap((definition) => {
    const expectedTerms = extractLabeledTerms(normalizedSourceText, definition.labelPattern);
    if (expectedTerms.length === 0) {
      return [];
    }

    return [
      {
        key: definition.key,
        label: definition.label,
        sourceSection: definition.sourceSection,
        expectedTerms,
        observedSectionTerms: definition.observedSectionTerms,
        severity: definition.severity,
        humanReviewBlocker: definition.humanReviewBlocker,
      },
    ];
  });
};

const buildObservedTextSnippet = (pageText: string, matchedTerms: string[]): string | null => {
  const compactText = sanitizeEvidenceText(pageText.replace(/\s+/g, " ").trim());
  if (!compactText) {
    return null;
  }
  if (matchedTerms.length === 0) {
    return compactText.slice(0, 240);
  }

  const normalizedText = compactText.toLowerCase();
  const firstMatchIndex = matchedTerms
    .map((term) => normalizedText.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  if (firstMatchIndex === undefined) {
    return compactText.slice(0, 240);
  }

  const start = Math.max(0, firstMatchIndex - 80);
  return compactText.slice(start, start + 240);
};

const classifyMismatch = (
  expectedTermCount: number,
  missingTermCount: number,
): ClinicalQaParityFinding["mismatchType"] => {
  if (missingTermCount === 0) {
    return "match";
  }
  if (missingTermCount === expectedTermCount) {
    return "missing";
  }
  return "partial";
};

const sectionLabelMatches = (sectionLabel: string, observedSectionTerms: string[]): boolean => {
  const normalizedLabel = sectionLabel.toLowerCase();
  return observedSectionTerms.some((term) => normalizedLabel.includes(term.toLowerCase()));
};

const evaluateSectionEvidence = (
  expectation: ClinicalQaParityExpectation,
  evidenceSections: ClinicalQaEvidenceSection[],
): Pick<ClinicalQaParityFinding, "sectionEvidence" | "sectionEvidenceStatus"> => {
  if (expectation.observedSectionTerms.length === 0) {
    return {
      sectionEvidence: [],
      sectionEvidenceStatus: "not_evaluated",
    };
  }

  const matchingSections = evidenceSections.filter((section) =>
    sectionLabelMatches(section.label, expectation.observedSectionTerms),
  );
  if (matchingSections.length === 0) {
    return {
      sectionEvidence: [],
      sectionEvidenceStatus: "not_evaluated",
    };
  }

  const sectionEvidence = matchingSections.map((section) => {
    const normalizedSectionText = section.text.toLowerCase();
    const matchedTerms = expectation.expectedTerms.filter((term) =>
      normalizedSectionText.includes(term.toLowerCase()),
    );
    const missingTerms = expectation.expectedTerms.filter(
      (term) => !normalizedSectionText.includes(term.toLowerCase()),
    );

    return {
      sectionLabel: section.label,
      matchedTerms,
      missingTerms,
      observedTextSnippet: buildObservedTextSnippet(section.text, matchedTerms),
    };
  });
  const matchedAcrossSections = new Set(
    sectionEvidence.flatMap((section) => section.matchedTerms.map((term) => term.toLowerCase())),
  );
  const missingAcrossSections = expectation.expectedTerms.filter(
    (term) => !matchedAcrossSections.has(term.toLowerCase()),
  );

  return {
    sectionEvidence,
    sectionEvidenceStatus: classifyMismatch(expectation.expectedTerms.length, missingAcrossSections.length),
  };
};

export const parseClinicalQaExpectations = (
  rawJson: string,
  fixturePath: string,
): ClinicalQaParityExpectation[] => {
  assertRedactedQaFixture(fixturePath, "PW_CLINICAL_QA_EXPECTATIONS_FILE");

  const parsed = JSON.parse(rawJson) as { expectations?: unknown };
  if (!Array.isArray(parsed.expectations)) {
    throw new Error("Clinical QA expectations fixture must contain an expectations array.");
  }

  return parsed.expectations.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Clinical QA expectation at index ${index} must be an object.`);
    }
    const expectation = entry as Record<string, unknown>;
    const key = typeof expectation.key === "string" ? expectation.key.trim() : "";
    const label = typeof expectation.label === "string" ? expectation.label.trim() : "";
    if (!key || !label || !isStringArray(expectation.expectedTerms)) {
      throw new Error(
        `Clinical QA expectation at index ${index} requires key, label, and non-empty expectedTerms.`,
      );
    }

    return {
      key,
      label,
      sourceSection: normalizeOptionalString(expectation.sourceSection),
      expectedTerms: expectation.expectedTerms.map((term) => term.trim()),
      observedSectionTerms: normalizeOptionalStringArray(expectation.observedSectionTerms),
      severity: normalizeSeverity(expectation.severity),
      humanReviewBlocker: expectation.humanReviewBlocker === true,
    };
  });
};

export const evaluateClinicalDataParity = (
  pageText: string,
  expectations: ClinicalQaParityExpectation[],
  evidenceSections?: ClinicalQaEvidenceSection[],
): ClinicalQaParityFinding[] => {
  const normalizedText = pageText.toLowerCase();
  return expectations.map((expectation) => {
    const matchedTerms = expectation.expectedTerms.filter((term) =>
      normalizedText.includes(term.toLowerCase()),
    );
    const missingTerms = expectation.expectedTerms.filter(
      (term) => !normalizedText.includes(term.toLowerCase()),
    );
    const observedSectionMatchedTerms = expectation.observedSectionTerms.filter((term) =>
      normalizedText.includes(term.toLowerCase()),
    );
    const observedSectionMissingTerms = expectation.observedSectionTerms.filter(
      (term) => !normalizedText.includes(term.toLowerCase()),
    );

    const sectionEvidence =
      evidenceSections === undefined ? {} : evaluateSectionEvidence(expectation, evidenceSections);

    return {
      ...expectation,
      status: missingTerms.length === 0 ? "pass" : "fail",
      mismatchType: classifyMismatch(expectation.expectedTerms.length, missingTerms.length),
      matchedTerms,
      missingTerms,
      observedSectionMatchedTerms,
      observedSectionMissingTerms,
      observedTextSnippet: buildObservedTextSnippet(pageText, [...matchedTerms, ...observedSectionMatchedTerms]),
      ...sectionEvidence,
    };
  });
};

const formatTermList = (terms: string[]): string => (terms.length > 0 ? terms.join(", ") : "none");

const formatSectionEvidence = (finding: ClinicalQaParityFinding): string[] => {
  if (!finding.sectionEvidenceStatus || !finding.sectionEvidence) {
    return [];
  }

  const sectionLines = finding.sectionEvidence.flatMap((section) => [
    `  - section evidence: ${section.sectionLabel}`,
    `    - matched: ${formatTermList(section.matchedTerms)}`,
    `    - missing: ${formatTermList(section.missingTerms)}`,
    `    - snippet: ${section.observedTextSnippet ? sanitizeEvidenceText(section.observedTextSnippet) : "none"}`,
  ]);

  return [`  - section evidence status: ${finding.sectionEvidenceStatus}`, ...sectionLines];
};

export const buildClinicalQaReportMarkdown = (report: ClinicalQaReportInput): string => {
  const blockerCount = report.dataParityFindings.filter(
    (finding) => finding.status === "fail" && finding.humanReviewBlocker,
  ).length;
  const checklistLines = report.checklist.map(
    (item) => `- ${item.status.toUpperCase()} ${item.label}: missing ${formatTermList(item.missingTerms)}`,
  );
  const findingLines = report.dataParityFindings.map((finding) => {
    const sourceSection = finding.sourceSection ?? "unspecified";
    const snippet = finding.observedTextSnippet ? sanitizeEvidenceText(finding.observedTextSnippet) : "none";
    return [
      `- ${finding.status.toUpperCase()} ${finding.label}`,
      `  - source section: ${sourceSection}`,
      `  - mismatch type: ${finding.mismatchType}`,
      `  - severity: ${finding.severity}`,
      `  - expected: ${formatTermList(finding.expectedTerms)}`,
      `  - matched: ${formatTermList(finding.matchedTerms)}`,
      `  - missing: ${formatTermList(finding.missingTerms)}`,
      `  - observed section missing: ${formatTermList(finding.observedSectionMissingTerms)}`,
      ...formatSectionEvidence(finding),
      `  - human review blocker: ${finding.humanReviewBlocker ? "yes" : "no"}`,
      `  - observed snippet: ${snippet}`,
    ].join("\n");
  });

  return [
    "# Clinical Data Parity Agent Report",
    "",
    `generated at: ${report.generatedAt}`,
    `target route: \`${report.routePath}\``,
    `base URL: \`${report.baseUrl}\``,
    `credential label: \`${report.credentialLabel}\``,
    `screenshot: \`${report.screenshotPath}\``,
    `human review blockers: ${blockerCount}`,
    "",
    "## Checklist",
    ...(checklistLines.length > 0 ? checklistLines : ["- none"]),
    "",
    "## Data Parity Findings",
    ...(findingLines.length > 0 ? findingLines : ["- none"]),
    "",
    "## Disclaimer",
    report.disclaimer,
    "",
  ].join("\n");
};
