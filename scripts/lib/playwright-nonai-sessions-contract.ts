type EnvIssue = {
  key: string;
  reason: "missing" | "placeholder";
};

type CredentialCandidate = {
  email: string;
  password: string;
  label: string;
};

const PLACEHOLDER_VALUES = new Set(["****", "<required>", "changeme"]);
const DOC_HINT = "docs/TESTING.md (Non-AI sessions Playwright flows)";
const PREFLIGHT_HINT = "npm run playwright:preflight";

const normalizeEnvValue = (value: string | undefined): string => (typeof value === "string" ? value.trim() : "");

const isPlaceholder = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return PLACEHOLDER_VALUES.has(normalized);
};

const collectIssue = (issues: EnvIssue[], key: string, value: string): void => {
  if (!value) {
    issues.push({ key, reason: "missing" });
    return;
  }
  if (isPlaceholder(value)) {
    issues.push({ key, reason: "placeholder" });
  }
};

const formatIssue = (issue: EnvIssue): string =>
  issue.reason === "placeholder"
    ? `${issue.key} is set to a placeholder value`
    : `${issue.key} is missing`;

const buildFailureMessage = (flowLabel: string, issues: EnvIssue[], extraGuidance?: string): string => {
  const header = `${flowLabel} cannot run until required environment contract is satisfied.`;
  const lines = issues.map((issue) => `- ${formatIssue(issue)}`);
  const guidance = [
    `Run ${PREFLIGHT_HINT} to validate the full contract before launching browser flows.`,
    `See ${DOC_HINT} for local and CI setup details.`,
  ];
  if (extraGuidance) {
    guidance.unshift(extraGuidance);
  }
  return [header, ...lines, ...guidance].join("\n");
};

export const resolveNonAiSessionCredentialCandidates = (): CredentialCandidate[] => {
  const scheduleEmail = normalizeEnvValue(process.env.PW_SCHEDULE_EMAIL);
  const schedulePassword = normalizeEnvValue(process.env.PW_SCHEDULE_PASSWORD);
  const adminEmail = normalizeEnvValue(process.env.PW_ADMIN_EMAIL ?? process.env.PLAYWRIGHT_ADMIN_EMAIL);
  const adminPassword = normalizeEnvValue(process.env.PW_ADMIN_PASSWORD ?? process.env.PLAYWRIGHT_ADMIN_PASSWORD);

  const candidates: CredentialCandidate[] = [];
  if (scheduleEmail && schedulePassword) {
    candidates.push({
      email: scheduleEmail,
      password: schedulePassword,
      label: "PW_SCHEDULE_EMAIL + PW_SCHEDULE_PASSWORD",
    });
  }
  if (adminEmail && adminPassword) {
    candidates.push({
      email: adminEmail,
      password: adminPassword,
      label: "PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD",
    });
  }
  return candidates;
};

export const assertNonAiSessionsEnvContract = (flowLabel: string): CredentialCandidate[] => {
  const issues: EnvIssue[] = [];
  const baseUrl = normalizeEnvValue(process.env.PW_BASE_URL || "https://app.allincompassing.ai");
  if (!/^https?:\/\//i.test(baseUrl)) {
    issues.push({ key: "PW_BASE_URL", reason: "placeholder" });
  }

  const supabaseUrl = normalizeEnvValue(process.env.VITE_SUPABASE_URL);
  collectIssue(issues, "VITE_SUPABASE_URL", supabaseUrl);

  const anonKey = normalizeEnvValue(process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY);
  if (!anonKey) {
    issues.push({ key: "VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)", reason: "missing" });
  } else if (isPlaceholder(anonKey)) {
    issues.push({ key: "VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)", reason: "placeholder" });
  }

  const serviceRole = normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  collectIssue(issues, "SUPABASE_SERVICE_ROLE_KEY", serviceRole);

  const candidates = resolveNonAiSessionCredentialCandidates();
  if (candidates.length === 0) {
    issues.push({ key: "PW_SCHEDULE_* or PW_ADMIN_* credential pair", reason: "missing" });
  }

  if (issues.length > 0) {
    throw new Error(
      buildFailureMessage(
        flowLabel,
        issues,
        "Set either PW_SCHEDULE_EMAIL/PW_SCHEDULE_PASSWORD or PW_ADMIN_EMAIL/PW_ADMIN_PASSWORD.",
      ),
    );
  }

  return candidates;
};
