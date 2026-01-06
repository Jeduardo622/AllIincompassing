import {
  corsHeaders,
  createProtectedRoute,
  logApiAccess,
  RouteOptions,
  UserContext,
} from "../_shared/auth-middleware.ts";
import { getLogger } from "../_shared/logging.ts";

type TemplateKey = "ER" | "FBA" | "PR";

type FillDocsRequest = {
  template: TemplateKey;
  fields: Record<string, string>;
  outputFileName?: string;
};

type FillDocsResponse = {
  success: true;
  template: TemplateKey;
  filename: string;
  contentType: string;
  base64: string;
};

const CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const TEMPLATES: Record<TemplateKey, { fileName: string; fileUrl: URL }> = {
  ER: {
    fileName: "Updated ER - IEHP.docx",
    fileUrl: new URL("./fill_docs/Updated ER - IEHP.docx", import.meta.url),
  },
  FBA: {
    fileName: "Updated FBA - IEHP.docx",
    fileUrl: new URL("./fill_docs/Updated FBA - IEHP.docx", import.meta.url),
  },
  PR: {
    fileName: "Updated PR - IEHP.docx",
    fileUrl: new URL("./fill_docs/Updated PR - IEHP.docx", import.meta.url),
  },
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequest(input: unknown):
  | { ok: true; value: FillDocsRequest }
  | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "Invalid request payload" };
  const template = input.template;
  const fields = input.fields;
  const outputFileName = input.outputFileName;

  if (template !== "ER" && template !== "FBA" && template !== "PR") {
    return { ok: false, error: "Invalid template. Expected ER, FBA, or PR." };
  }
  if (!isRecord(fields)) {
    return { ok: false, error: "Invalid fields payload" };
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof key !== "string" || key.trim().length === 0) continue;
    if (typeof value !== "string") continue;
    normalized[key.trim()] = value;
  }

  const safeOutputName =
    typeof outputFileName === "string" && outputFileName.trim().length > 0
      ? outputFileName.trim()
      : undefined;

  return {
    ok: true,
    value: {
      template,
      fields: normalized,
      outputFileName: safeOutputName,
    },
  };
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function applyPlaceholdersToXml(xml: string, fields: Record<string, string>): string {
  let next = xml;
  for (const [key, rawValue] of Object.entries(fields)) {
    const token = `{{${key}}}`;
    next = next.replaceAll(token, escapeXmlText(rawValue));
  }
  return next;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fillDocxTemplate(
  templateBytes: Uint8Array,
  fields: Record<string, string>,
): Promise<Uint8Array> {
  const { default: JSZip } = await import("npm:jszip@3.10.1");

  const zip = await JSZip.loadAsync(templateBytes);
  const xmlTargets = Object.keys(zip.files).filter((path) =>
    path === "word/document.xml" ||
    /^word\/header\d+\.xml$/.test(path) ||
    /^word\/footer\d+\.xml$/.test(path)
  );

  for (const path of xmlTargets) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    const updated = applyPlaceholdersToXml(xml, fields);
    zip.file(path, updated);
  }

  const out = await zip.generateAsync({ type: "uint8array" });
  return out as Uint8Array;
}

export default createProtectedRoute(async (req: Request, userContext: UserContext) => {
  const logger = getLogger(req, {
    functionName: "fill-docs",
    userId: userContext.user.id,
  });

  if (req.method !== "POST") {
    logApiAccess(req.method, "/fill-docs", userContext, 405);
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const parsed = parseRequest(await req.json());
    if (!parsed.ok) {
      logApiAccess("POST", "/fill-docs", userContext, 400);
      logger.warn("request.invalid", { reason: parsed.error });
      return jsonResponse({ error: parsed.error }, 400);
    }

    const { template, fields, outputFileName } = parsed.value;
    const templateMeta = TEMPLATES[template];
    const templateBytes = await Deno.readFile(templateMeta.fileUrl);

    logger.info("fill.start", { template, fieldsCount: Object.keys(fields).length });

    const filledBytes = await fillDocxTemplate(templateBytes, fields);

    const filename = ensureDocxExtension(
      outputFileName ?? `${templateMeta.fileName.replace(".docx", "")} (filled).docx`,
    );

    const response: FillDocsResponse = {
      success: true,
      template,
      filename,
      contentType: CONTENT_TYPE,
      base64: toBase64(filledBytes),
    };

    logApiAccess("POST", "/fill-docs", userContext, 200);
    logger.info("fill.complete", { template, filename });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    logApiAccess("POST", "/fill-docs", userContext, 500);
    logger.error("fill.failed", { error: message });
    return jsonResponse({ error: "Failed to fill document template" }, 500);
  }
}, RouteOptions.therapist);

function ensureDocxExtension(name: string): string {
  const trimmed = name.trim();
  if (trimmed.toLowerCase().endsWith(".docx")) return trimmed;
  return `${trimmed}.docx`;
}

