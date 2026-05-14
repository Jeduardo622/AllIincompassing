const ADOBE_PDF_SERVICES_BASE_URL = "https://pdf-services.adobe.io";
const ADOBE_PDF_SERVICES_TOKEN_URL = `${ADOBE_PDF_SERVICES_BASE_URL}/token`;

type FetchLike = typeof fetch;

type AdobeEnv = {
  get: (name: string) => string | undefined;
};

type AdobePdfExtractOptions = {
  fetchImpl?: FetchLike;
  env?: AdobeEnv;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
};

type AdobeCredentials = {
  clientId: string;
  clientSecret: string;
};

type AdobeStructuredElement = Record<string, unknown>;

export type NormalizedAdobePdfExtract = {
  text: string;
  element_count: number;
  table_count: number;
};

export class AdobePdfExtractError extends Error {
  readonly code: string;
  readonly status: number;
  readonly publicMessage: string;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "AdobePdfExtractError";
    this.code = code;
    this.status = status;
    this.publicMessage = code === "adobe_pdf_extract_not_configured"
      ? "Adobe PDF extraction is not configured. Review checklist manually."
      : "Adobe PDF extraction failed. Review checklist manually.";
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const getDefaultEnv = (): AdobeEnv => ({
  get(name: string): string | undefined {
    const denoEnv = (globalThis as { Deno?: { env?: AdobeEnv } }).Deno?.env;
    return denoEnv?.get(name);
  },
});

const getAliasedEnv = (
  env: AdobeEnv,
  primaryKey: string,
  fallbackKey: string,
): string | undefined => {
  const primary = env.get(primaryKey)?.trim();
  if (primary) return primary;
  const fallback = env.get(fallbackKey)?.trim();
  return fallback || undefined;
};

export const getAdobePdfExtractCredentials = (
  env: AdobeEnv = getDefaultEnv(),
): AdobeCredentials => {
  const clientId = getAliasedEnv(
    env,
    "ADOBE_PDF_SERVICES_CLIENT_ID",
    "PDF_SERVICES_CLIENT_ID",
  );
  const clientSecret = getAliasedEnv(
    env,
    "ADOBE_PDF_SERVICES_CLIENT_SECRET",
    "PDF_SERVICES_CLIENT_SECRET",
  );

  if (!clientId || !clientSecret) {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_not_configured",
      "Adobe PDF Services credentials are missing.",
      500,
    );
  }

  return { clientId, clientSecret };
};

const parseJsonResponse = async <T>(
  response: Response,
  operation: string,
): Promise<T> => {
  const text = await response.text();
  if (!response.ok) {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      `Adobe PDF Extract ${operation} failed with status ${response.status}.`,
      502,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      `Adobe PDF Extract ${operation} returned invalid JSON.`,
      502,
    );
  }
};

const ADOBE_SERVICE_HOST_PATTERN = /^pdf-services(?:-[a-z0-9]+)?\.adobe\.io$/i;
const ADOBE_RESULT_DOWNLOAD_HOSTS = new Set([
  "dcplatformstorageservice-prod-us-east-1.s3-accelerate.amazonaws.com",
  "dcplatformstorageservice-prod-eu-west-1.s3.amazonaws.com",
]);

const parseHttpsUrl = (
  url: string,
  context: "polling" | "upload" | "download",
): URL => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      `Adobe PDF Extract returned an invalid ${context} URL.`,
      502,
    );
  }

  if (parsed.protocol !== "https:") {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      `Adobe PDF Extract returned a non-HTTPS ${context} URL.`,
      502,
    );
  }

  if (parsed.username || parsed.password) {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      `Adobe PDF Extract returned a ${context} URL with credentials.`,
      502,
    );
  }

  return parsed;
};

const assertAdobePollingUrl = (url: string): void => {
  const parsed = parseHttpsUrl(url, "polling");

  if (!ADOBE_SERVICE_HOST_PATTERN.test(parsed.hostname)) {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      "Adobe PDF Extract returned an unexpected polling host.",
      502,
    );
  }
};

const assertAdobeStorageUrl = (url: string, context: "upload" | "download"): void => {
  const parsed = parseHttpsUrl(url, context);
  const hostname = parsed.hostname.toLowerCase();

  if (!ADOBE_RESULT_DOWNLOAD_HOSTS.has(hostname)) {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      `Adobe PDF Extract returned an unexpected ${context} host.`,
      502,
    );
  }
};

const assertAdobeResultDownloadUrl = (url: string): void => {
  const parsed = parseHttpsUrl(url, "download");
  const hostname = parsed.hostname.toLowerCase();

  if (
    !ADOBE_SERVICE_HOST_PATTERN.test(hostname) &&
    !ADOBE_RESULT_DOWNLOAD_HOSTS.has(hostname)
  ) {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      "Adobe PDF Extract returned an unexpected download host.",
      502,
    );
  }
};

const requestAccessToken = async (
  credentials: AdobeCredentials,
  fetchImpl: FetchLike,
): Promise<string> => {
  const response = await fetchImpl(ADOBE_PDF_SERVICES_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    }),
  });
  const body = await parseJsonResponse<{ access_token?: unknown }>(
    response,
    "token request",
  );
  if (typeof body.access_token !== "string" || !body.access_token.trim()) {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      "Adobe PDF Extract token response did not include an access token.",
      502,
    );
  }
  return body.access_token.trim();
};

const buildAdobeHeaders = (
  credentials: AdobeCredentials,
  accessToken: string,
  contentType = "application/json",
): Record<string, string> => ({
  "X-API-Key": credentials.clientId,
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": contentType,
});

const createAsset = async (
  credentials: AdobeCredentials,
  accessToken: string,
  fetchImpl: FetchLike,
): Promise<{ uploadUri: string; assetID: string }> => {
  const response = await fetchImpl(`${ADOBE_PDF_SERVICES_BASE_URL}/assets`, {
    method: "POST",
    headers: buildAdobeHeaders(credentials, accessToken),
    body: JSON.stringify({ mediaType: "application/pdf" }),
  });
  const body = await parseJsonResponse<{
    uploadUri?: unknown;
    assetID?: unknown;
  }>(response, "asset creation");
  if (typeof body.uploadUri !== "string" || typeof body.assetID !== "string") {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      "Adobe PDF Extract asset response was incomplete.",
      502,
    );
  }
  return { uploadUri: body.uploadUri, assetID: body.assetID };
};

const uploadAsset = async (
  uploadUri: string,
  pdfBytes: Uint8Array,
  fetchImpl: FetchLike,
): Promise<void> => {
  assertAdobeStorageUrl(uploadUri, "upload");

  const body = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength,
  ) as ArrayBuffer;
  const response = await fetchImpl(uploadUri, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body,
  });
  if (!response.ok) {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      `Adobe PDF Extract asset upload failed with status ${response.status}.`,
      502,
    );
  }
};

const submitExtractJob = async (
  credentials: AdobeCredentials,
  accessToken: string,
  assetID: string,
  fetchImpl: FetchLike,
): Promise<string> => {
  const response = await fetchImpl(
    `${ADOBE_PDF_SERVICES_BASE_URL}/operation/extractpdf`,
    {
      method: "POST",
      headers: buildAdobeHeaders(credentials, accessToken),
      body: JSON.stringify({
        assetID,
        elementsToExtract: ["text", "tables"],
      }),
    },
  );
  if (!response.ok) {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      `Adobe PDF Extract job submission failed with status ${response.status}.`,
      502,
    );
  }
  const location = response.headers.get("location")?.trim();
  if (!location) {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      "Adobe PDF Extract job response did not include a polling location.",
      502,
    );
  }
  return location;
};

const resolveDownloadUri = (body: Record<string, unknown>): string | null => {
  const readDownloadUri = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const uri = record.downloadUri ?? record.dowloadUri;
    return typeof uri === "string" && uri.trim() ? uri.trim() : null;
  };

  const direct = body.downloadUri ?? body.dowloadUri;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const assetDownloadUri = readDownloadUri(body.asset);
  if (assetDownloadUri) return assetDownloadUri;
  const result = body.result;
  if (result && typeof result === "object") {
    const resource = (result as Record<string, unknown>).resource;
    const resourceDownloadUri = readDownloadUri(resource);
    if (resourceDownloadUri) return resourceDownloadUri;
  }
  return null;
};

const pollExtractJob = async (
  pollingUrl: string,
  credentials: AdobeCredentials,
  accessToken: string,
  fetchImpl: FetchLike,
  sleep: (ms: number) => Promise<void>,
  pollIntervalMs: number,
  maxPollAttempts: number,
): Promise<string> => {
  assertAdobePollingUrl(pollingUrl);

  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    const response = await fetchImpl(pollingUrl, {
      method: "GET",
      headers: buildAdobeHeaders(credentials, accessToken),
    });
    const body = await parseJsonResponse<Record<string, unknown>>(
      response,
      "job status",
    );
    const status = typeof body.status === "string"
      ? body.status.toLowerCase()
      : "";
    if (status === "done") {
      const downloadUri = resolveDownloadUri(body);
      if (!downloadUri) {
        throw new AdobePdfExtractError(
          "adobe_pdf_extract_failed",
          "Adobe PDF Extract completed without a download URI.",
          502,
        );
      }
      return downloadUri;
    }
    if (status === "failed") {
      throw new AdobePdfExtractError(
        "adobe_pdf_extract_failed",
        "Adobe PDF Extract job failed.",
        502,
      );
    }
    await sleep(pollIntervalMs);
  }

  throw new AdobePdfExtractError(
    "adobe_pdf_extract_failed",
    "Adobe PDF Extract job did not complete before polling timed out.",
    504,
  );
};

const downloadResultZip = async (
  downloadUri: string,
  fetchImpl: FetchLike,
): Promise<Uint8Array> => {
  assertAdobeResultDownloadUrl(downloadUri);

  const response = await fetchImpl(downloadUri, { method: "GET" });
  if (!response.ok) {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      `Adobe PDF Extract result download failed with status ${response.status}.`,
      502,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
};

const getElementText = (element: AdobeStructuredElement): string => {
  const text = element.Text ?? element.text;
  return typeof text === "string" ? text.trim() : "";
};

const isTableElement = (element: AdobeStructuredElement): boolean => {
  const path = element.Path ?? element.path;
  return typeof path === "string" && /\/Table(?:\/|$)/i.test(path);
};

const normalizeText = (value: string): string =>
  value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const normalizeAdobeStructuredData = (
  structuredData: unknown,
): NormalizedAdobePdfExtract => {
  const record = structuredData && typeof structuredData === "object"
    ? structuredData as Record<string, unknown>
    : {};
  const elements = Array.isArray(record.elements)
    ? record.elements as AdobeStructuredElement[]
    : [];
  const lines = elements
    .map(getElementText)
    .filter((text) => text.length > 0);

  return {
    text: normalizeText(lines.join("\n")),
    element_count: elements.length,
    table_count: elements.filter(isTableElement).length,
  };
};

export const normalizeAdobeExtractZip = async (
  zipBytes: Uint8Array,
): Promise<NormalizedAdobePdfExtract> => {
  const { default: JSZip } = await import("npm:jszip@3.10.1");
  const zip = await JSZip.loadAsync(zipBytes);
  const structuredDataFile = zip.file("structuredData.json");
  if (!structuredDataFile) {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      "Adobe PDF Extract result is missing structuredData.json.",
      502,
    );
  }
  const rawStructuredData = await structuredDataFile.async("string");
  try {
    return normalizeAdobeStructuredData(JSON.parse(rawStructuredData));
  } catch {
    throw new AdobePdfExtractError(
      "adobe_pdf_extract_failed",
      "Adobe PDF Extract structuredData.json is invalid.",
      502,
    );
  }
};

export const extractPdfWithAdobe = async (
  pdfBytes: Uint8Array,
  options: AdobePdfExtractOptions = {},
): Promise<NormalizedAdobePdfExtract> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const credentials = getAdobePdfExtractCredentials(options.env);
  const accessToken = await requestAccessToken(credentials, fetchImpl);
  const asset = await createAsset(credentials, accessToken, fetchImpl);
  await uploadAsset(asset.uploadUri, pdfBytes, fetchImpl);
  const pollingUrl = await submitExtractJob(
    credentials,
    accessToken,
    asset.assetID,
    fetchImpl,
  );
  const downloadUri = await pollExtractJob(
    pollingUrl,
    credentials,
    accessToken,
    fetchImpl,
    options.sleep ?? defaultSleep,
    options.pollIntervalMs ?? 1_000,
    options.maxPollAttempts ?? 45,
  );
  const zipBytes = await downloadResultZip(downloadUri, fetchImpl);
  return normalizeAdobeExtractZip(zipBytes);
};
