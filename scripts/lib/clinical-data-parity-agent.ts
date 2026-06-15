import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path, { extname } from "node:path";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";

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
  outputDataParityFindings?: ClinicalQaParityFinding[];
  outputFindingsHeading?: string;
  disclaimer: string;
};

export type ClinicalQaGeneratedOutputMetadata = {
  generatedFileType: "docx" | "pdf";
  signedUrl: string;
  filename: string | null;
};

export type ClinicalQaCapturedGeneratedOutput = {
  artifactPath: string;
  generatedFileType: "docx" | "pdf";
  filename: string | null;
  text: string;
};

export type ClinicalQaPreflightEnv = Record<string, string | undefined>;

export type ClinicalQaPreflightReport = {
  ok: boolean;
  mode: "browser-only-redacted-clinical-data-parity-preflight";
  credentialLabel: string | null;
  routePath: string | null;
  fixtures: {
    sourceConfigured: boolean;
    outputConfigured: boolean;
    expectationsConfigured: boolean;
    generatedOutputCaptureConfigured: boolean;
  };
  expectationsSource: "expectations-file" | "source-text" | "none";
  outputSource: "generated-output-capture" | "output-fixture" | "none";
  blockingIssues: string[];
  warnings: string[];
  nextAction: string;
};

export type ClinicalQaPreflightReportMarkdownInput = {
  generatedAt: string;
  report: ClinicalQaPreflightReport;
};

type ClinicalQaGeneratedOutputResponse = {
  url: () => string;
  request: () => { method: () => string };
  json: () => Promise<unknown>;
  ok: () => boolean;
};

type ClinicalQaGeneratedOutputArtifactResponse = {
  ok: () => boolean;
  status: () => number;
  body: () => Promise<Buffer>;
};

export type ClinicalQaGeneratedOutputPage = {
  waitForResponse: (
    predicate: (response: ClinicalQaGeneratedOutputResponse) => boolean,
    options: { timeout: number },
  ) => Promise<ClinicalQaGeneratedOutputResponse>;
  waitForEvent: (
    eventName: "popup",
    options: { timeout: number },
  ) => Promise<{ close: () => Promise<unknown> } | null>;
  locator: (selector: string) => {
    click: (options: { timeout: number }) => Promise<unknown>;
  };
  context: () => {
    request: {
      get: (url: string) => Promise<ClinicalQaGeneratedOutputArtifactResponse>;
    };
  };
};

const REDACTED_PASSWORD_PLACEHOLDER = "****";
const execFileAsync = promisify(execFile);

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
  if (!/\.(?:txt|md|docx|pdf)$/i.test(fixturePath)) {
    throw new Error(
      "PW_CLINICAL_QA_SOURCE_FILE text extraction supports .txt, .md, .docx, or .pdf fixtures.",
    );
  }
  return fixturePath;
};

export const parseClinicalQaGeneratedOutputResponse = (
  value: unknown,
): ClinicalQaGeneratedOutputMetadata => {
  if (!value || typeof value !== "object") {
    throw new Error("Generated output response must be a JSON object.");
  }
  const response = value as Record<string, unknown>;
  const generatedFileType = response.generated_file_type;
  if (generatedFileType !== "docx" && generatedFileType !== "pdf") {
    throw new Error("Generated output response must include generated_file_type of docx or pdf.");
  }

  const signedUrl = typeof response.signed_url === "string" ? response.signed_url.trim() : "";
  if (!signedUrl) {
    throw new Error("Generated output response must include a non-empty signed_url.");
  }

  const filename = typeof response.filename === "string" && response.filename.trim()
    ? response.filename.trim()
    : null;

  return {
    generatedFileType,
    signedUrl,
    filename,
  };
};

export const buildClinicalQaGeneratedOutputArtifactPath = (
  latestDir: string,
  runId: number,
  metadata: ClinicalQaGeneratedOutputMetadata,
): string =>
  path.join(
    latestDir,
    `redacted-clinical-qa-generated-output-${runId}.${metadata.generatedFileType}`,
  );

export const captureClinicalQaGeneratedOutputArtifact = async (args: {
  page: ClinicalQaGeneratedOutputPage;
  selector: string;
  latestDir: string;
  runId: number;
  readOutputText?: (artifactPath: string) => Promise<string>;
  writeArtifact?: (artifactPath: string, artifactBody: Buffer) => Promise<unknown>;
}): Promise<ClinicalQaCapturedGeneratedOutput> => {
  const responsePromise = args.page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/assessment-plan-pdf" && response.request().method() === "POST";
    },
    { timeout: 45_000 },
  );
  const popupPromise = args.page.waitForEvent("popup", { timeout: 5_000 }).catch(() => null);

  await args.page.locator(args.selector).click({ timeout: 10_000 });
  const response = await responsePromise;
  const responsePayload = await response.json();
  if (!response.ok()) {
    throw new Error("Generated output request failed before artifact download.");
  }

  const metadata = parseClinicalQaGeneratedOutputResponse(responsePayload);
  const artifactPath = buildClinicalQaGeneratedOutputArtifactPath(args.latestDir, args.runId, metadata);
  const artifactResponse = await args.page.context().request.get(metadata.signedUrl);
  if (!artifactResponse.ok()) {
    throw new Error(`Generated output artifact download failed with HTTP ${artifactResponse.status()}.`);
  }

  const writeArtifact = args.writeArtifact ?? writeFile;
  const readOutputText = args.readOutputText ?? readClinicalQaOutputFixtureText;
  await writeArtifact(artifactPath, await artifactResponse.body());
  const popup = await popupPromise;
  await popup?.close().catch(() => undefined);

  return {
    artifactPath,
    generatedFileType: metadata.generatedFileType,
    filename: metadata.filename,
    text: await readOutputText(artifactPath),
  };
};

const decodeXmlText = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const extractTextFromDocxBuffer = (buffer: Buffer): string => {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("DOCX source fixture is not a readable ZIP archive.");
  }

  const centralDirectoryEntryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const xmlTextParts: string[] = [];

  for (let index = 0; index < centralDirectoryEntryCount; index += 1) {
    if (buffer.readUInt32LE(centralDirectoryOffset) !== 0x02014b50) {
      throw new Error("DOCX source fixture has an invalid ZIP central directory.");
    }

    const compressionMethod = buffer.readUInt16LE(centralDirectoryOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralDirectoryOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralDirectoryOffset + 28);
    const extraLength = buffer.readUInt16LE(centralDirectoryOffset + 30);
    const commentLength = buffer.readUInt16LE(centralDirectoryOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralDirectoryOffset + 42);
    const fileName = buffer
      .subarray(centralDirectoryOffset + 46, centralDirectoryOffset + 46 + fileNameLength)
      .toString("utf8");

    if (/^word\/(?:document|header\d+|footer\d+)\.xml$/i.test(fileName)) {
      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error(`DOCX source fixture has an invalid local ZIP header for ${fileName}.`);
      }
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      const xmlBuffer =
        compressionMethod === 0
          ? compressed
          : compressionMethod === 8
            ? inflateRawSync(compressed)
            : null;
      if (!xmlBuffer) {
        throw new Error(`DOCX source fixture uses unsupported ZIP compression method ${compressionMethod}.`);
      }
      const xml = xmlBuffer
        .toString("utf8")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:tab\s*\/>/g, " ");
      xmlTextParts.push(decodeXmlText(xml.replace(/<[^>]+>/g, " ")));
    }

    centralDirectoryOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  const extractedText = xmlTextParts.join("\n").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
  if (!extractedText) {
    throw new Error("DOCX source fixture did not contain extractable document text.");
  }
  return extractedText;
};

const extractTextFromPdfWithPython = async (fixturePath: string): Promise<string> => {
  const script = [
    "import sys",
    "try:",
    "    from pypdf import PdfReader",
    "except Exception as exc:",
    "    raise SystemExit(f'pypdf is required to extract PDF source fixtures: {exc}')",
    "reader = PdfReader(sys.argv[1])",
    "parts = []",
    "for page in reader.pages:",
    "    parts.append(page.extract_text() or '')",
    "print('\\n'.join(parts))",
  ].join("\n");

  let lastError: unknown;
  for (const command of ["python", "python3"]) {
    try {
      const { stdout } = await execFileAsync(command, ["-c", script, fixturePath], {
        maxBuffer: 10 * 1024 * 1024,
      });
      const extractedText = stdout.trim();
      if (!extractedText) {
        throw new Error("PDF source fixture did not contain extractable text.");
      }
      return extractedText;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to extract PDF source fixture text. Install Python with pypdf or provide PW_CLINICAL_QA_EXPECTATIONS_FILE. ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
};

const decodePdfLiteralString = (value: string): string =>
  value.replace(/\\([()\\nrtbf])/g, (_match, escaped: string) => {
    if (escaped === "n") return "\n";
    if (escaped === "r") return "\r";
    if (escaped === "t") return "\t";
    if (escaped === "b") return "\b";
    if (escaped === "f") return "\f";
    return escaped;
  });

const extractTextFromSimplePdfBuffer = (buffer: Buffer): string | null => {
  const rawPdf = buffer.toString("latin1");
  const textParts = Array.from(rawPdf.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g), (match) =>
    decodePdfLiteralString(match[1]),
  );
  const extractedText = textParts.join("\n").trim();
  return extractedText.length > 0 ? extractedText : null;
};

const readClinicalQaTextFixture = async (fixturePath: string, label: string): Promise<string> => {
  assertRedactedQaFixture(fixturePath, label);
  assertSupportedClinicalQaSourceTextFixture(fixturePath);
  const extension = extname(fixturePath).toLowerCase();
  if (extension === ".txt" || extension === ".md") {
    return readFile(fixturePath, "utf8");
  }
  if (extension === ".docx") {
    return extractTextFromDocxBuffer(await readFile(fixturePath));
  }
  if (extension === ".pdf") {
    const simpleText = extractTextFromSimplePdfBuffer(await readFile(fixturePath));
    return simpleText ?? extractTextFromPdfWithPython(fixturePath);
  }
  throw new Error("Unsupported clinical QA source fixture extension.");
};

export const readClinicalQaSourceFixtureText = async (fixturePath: string): Promise<string> =>
  readClinicalQaTextFixture(fixturePath, "PW_CLINICAL_QA_SOURCE_FILE");

export const readClinicalQaOutputFixtureText = async (fixturePath: string): Promise<string> =>
  readClinicalQaTextFixture(fixturePath, "PW_CLINICAL_QA_OUTPUT_FILE");

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

const pushFixturePreflightIssue = (
  blockingIssues: string[],
  value: string | undefined,
  label: string,
  validateSupportedSource = false,
): string | null => {
  try {
    const fixturePath = assertRedactedQaFixture(value, label);
    if (fixturePath && validateSupportedSource) {
      assertSupportedClinicalQaSourceTextFixture(fixturePath);
    }
    return fixturePath;
  } catch (error) {
    blockingIssues.push(error instanceof Error ? error.message : String(error));
    return null;
  }
};

export const buildClinicalQaPreflightReport = (
  env: ClinicalQaPreflightEnv,
): ClinicalQaPreflightReport => {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  let credentialLabel: string | null = null;
  try {
    credentialLabel = selectClinicalQaCredentials([
      {
        email: env.PW_CLINICAL_QA_EMAIL,
        password: env.PW_CLINICAL_QA_PASSWORD,
        label: "PW_CLINICAL_QA_EMAIL + PW_CLINICAL_QA_PASSWORD",
      },
      {
        email: env.PW_ADMIN_EMAIL ?? env.PLAYWRIGHT_ADMIN_EMAIL,
        password: env.PW_ADMIN_PASSWORD ?? env.PLAYWRIGHT_ADMIN_PASSWORD,
        label: "PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD",
      },
    ]).label;
  } catch {
    blockingIssues.push("Set PW_CLINICAL_QA_EMAIL/PW_CLINICAL_QA_PASSWORD or PW_ADMIN_EMAIL/PW_ADMIN_PASSWORD.");
  }
  if (!env.PW_CLINICAL_QA_EMAIL?.trim() && (env.PW_ADMIN_EMAIL?.trim() || env.PLAYWRIGHT_ADMIN_EMAIL?.trim())) {
    warnings.push("Dedicated PW_CLINICAL_QA_EMAIL credentials are preferred over admin fallback credentials.");
  }

  let routePath: string | null = null;
  try {
    const clientId = requireClinicalQaClientId(env.PW_CLINICAL_QA_CLIENT_ID);
    if (!clientId && !env.PW_CLINICAL_QA_ROUTE?.trim()) {
      blockingIssues.push("Set PW_CLINICAL_QA_CLIENT_ID or PW_CLINICAL_QA_ROUTE.");
    } else {
      routePath = buildClinicalQaRoute({
        clientId,
        routePath: env.PW_CLINICAL_QA_ROUTE,
      });
    }
  } catch (error) {
    blockingIssues.push(error instanceof Error ? error.message : String(error));
  }

  const sourceFixture = pushFixturePreflightIssue(
    blockingIssues,
    env.PW_CLINICAL_QA_SOURCE_FILE,
    "PW_CLINICAL_QA_SOURCE_FILE",
    true,
  );
  const outputFixture = pushFixturePreflightIssue(
    blockingIssues,
    env.PW_CLINICAL_QA_OUTPUT_FILE,
    "PW_CLINICAL_QA_OUTPUT_FILE",
    true,
  );
  const expectationsFixture = pushFixturePreflightIssue(
    blockingIssues,
    env.PW_CLINICAL_QA_EXPECTATIONS_FILE,
    "PW_CLINICAL_QA_EXPECTATIONS_FILE",
  );
  const generatedOutputCaptureConfigured = Boolean(env.PW_CLINICAL_QA_GENERATED_OUTPUT_SELECTOR?.trim());

  if (!sourceFixture && !expectationsFixture) {
    blockingIssues.push("Set PW_CLINICAL_QA_SOURCE_FILE or PW_CLINICAL_QA_EXPECTATIONS_FILE.");
  }
  if (!outputFixture && !generatedOutputCaptureConfigured) {
    blockingIssues.push("Set PW_CLINICAL_QA_OUTPUT_FILE or PW_CLINICAL_QA_GENERATED_OUTPUT_SELECTOR.");
  }
  if (outputFixture && !generatedOutputCaptureConfigured) {
    warnings.push("Generated output capture is not configured; parity will use the redacted output fixture.");
  }

  const outputSource = generatedOutputCaptureConfigured
    ? "generated-output-capture"
    : outputFixture
      ? "output-fixture"
      : "none";
  const expectationsSource = expectationsFixture ? "expectations-file" : sourceFixture ? "source-text" : "none";
  const ok = blockingIssues.length === 0;

  return {
    ok,
    mode: "browser-only-redacted-clinical-data-parity-preflight",
    credentialLabel,
    routePath,
    fixtures: {
      sourceConfigured: Boolean(sourceFixture),
      outputConfigured: Boolean(outputFixture),
      expectationsConfigured: Boolean(expectationsFixture),
      generatedOutputCaptureConfigured,
    },
    expectationsSource,
    outputSource,
    blockingIssues,
    warnings,
    nextAction: ok
      ? "Run npm run playwright:clinical-data-parity-agent with the same environment to collect browser evidence."
      : "Set the missing redacted clinical QA environment values, then rerun preflight.",
  };
};

export const buildClinicalQaPreflightReportMarkdown = ({
  generatedAt,
  report,
}: ClinicalQaPreflightReportMarkdownInput): string => {
  const blockingIssueLines = report.blockingIssues.map((issue) => `- ${issue}`);
  const warningLines = report.warnings.map((warning) => `- ${warning}`);

  return [
    "# Clinical Data Parity Agent Preflight",
    "",
    `generated at: ${generatedAt}`,
    `ready: ${report.ok ? "yes" : "no"}`,
    `mode: \`${report.mode}\``,
    `credential label: \`${report.credentialLabel ?? "none"}\``,
    `target route: \`${report.routePath ?? "none"}\``,
    `expectations source: \`${report.expectationsSource}\``,
    `output source: \`${report.outputSource}\``,
    "",
    "## Fixture Readiness",
    `- source configured: ${report.fixtures.sourceConfigured ? "yes" : "no"}`,
    `- output configured: ${report.fixtures.outputConfigured ? "yes" : "no"}`,
    `- expectations configured: ${report.fixtures.expectationsConfigured ? "yes" : "no"}`,
    `- generated output capture configured: ${report.fixtures.generatedOutputCaptureConfigured ? "yes" : "no"}`,
    "",
    "## Blocking Issues",
    ...(blockingIssueLines.length > 0 ? blockingIssueLines : ["- none"]),
    "",
    "## Warnings",
    ...(warningLines.length > 0 ? warningLines : ["- none"]),
    "",
    "## Next Action",
    report.nextAction,
    "",
  ].join("\n");
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

export const buildClinicalQaTextEvidenceSections = (text: string): ClinicalQaEvidenceSection[] => {
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .filter((lines) => lines.length > 0);

  return blocks.map((lines, index) => {
    const [label, ...bodyLines] = lines;
    const sectionText = bodyLines.length > 0 ? bodyLines.join(" ") : label;
    return {
      label: label || `Output section ${index + 1}`,
      text: sectionText.replace(/\s+/g, " ").trim(),
    };
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

const formatFindingLines = (findings: ClinicalQaParityFinding[]): string[] =>
  findings.map((finding) => {
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

export const buildClinicalQaReportMarkdown = (report: ClinicalQaReportInput): string => {
  const outputDataParityFindings = report.outputDataParityFindings ?? [];
  const allFindings = [...report.dataParityFindings, ...outputDataParityFindings];
  const blockerCount = allFindings.filter(
    (finding) => finding.status === "fail" && finding.humanReviewBlocker,
  ).length;
  const checklistLines = report.checklist.map(
    (item) => `- ${item.status.toUpperCase()} ${item.label}: missing ${formatTermList(item.missingTerms)}`,
  );
  const findingLines = formatFindingLines(report.dataParityFindings);
  const outputFindingLines = formatFindingLines(outputDataParityFindings);
  const outputFindingsHeading = report.outputFindingsHeading ?? "Output Fixture Parity Findings";

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
    `## ${outputFindingsHeading}`,
    ...(outputFindingLines.length > 0 ? outputFindingLines : ["- none"]),
    "",
    "## Disclaimer",
    report.disclaimer,
    "",
  ].join("\n");
};
