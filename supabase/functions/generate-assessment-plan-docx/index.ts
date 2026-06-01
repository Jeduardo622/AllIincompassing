import { z } from "npm:zod@3.23.8";
import {
  corsHeaders,
  createProtectedRoute,
  RouteOptions,
} from "../_shared/auth-middleware.ts";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { resolveOrgId } from "../_shared/org.ts";

const CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const BUCKET_ID = "client-documents";
const TEMPLATE_FILE_NAME = "Updated FBA -IEHP.docx";
const TEMPLATE_STORAGE_OBJECT_PATH = `templates/assessment/iehp/${TEMPLATE_FILE_NAME}`;
const TEMPLATE_READ_TARGETS: Array<string | URL> = [
  `./${TEMPLATE_FILE_NAME}`,
  `./fill_docs/${TEMPLATE_FILE_NAME}`,
  `./functions/generate-assessment-plan-docx/fill_docs/${TEMPLATE_FILE_NAME}`,
  new URL(`./fill_docs/${TEMPLATE_FILE_NAME}`, import.meta.url),
];
const PLACEHOLDER_PATTERN = /\{\{([A-Z0-9_]+)\}\}/g;
const ASSESSMENT_GENERATION_SECRET_HEADER = "x-assessment-generation-secret";

const requestSchema = z.object({
  assessment_document_id: z.string().uuid(),
  template_type: z.literal("iehp_fba"),
  template_health_check: z.boolean().optional(),
  field_values: z.record(z.string()).optional(),
  field_layouts: z.array(z.object({
    field_key: z.string().trim().min(1),
    layout_json: z.record(z.unknown()).nullable().optional(),
  })).optional(),
  output_bucket_id: z.string().trim().min(1).default(BUCKET_ID),
  output_object_path: z.string().trim().min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.template_health_check) return;
  if (!value.output_object_path) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["output_object_path"],
      message: "output_object_path is required for DOCX generation",
    });
  }
  if (!value.field_values) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["field_values"],
      message: "field_values is required for DOCX generation",
    });
  }
});

interface AssessmentDocumentScopeRow {
  id: string;
  organization_id: string;
  client_id: string;
  template_type: string;
}

interface AssessmentDocumentQueryBuilder {
  from: (table: "assessment_documents") => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{ data: AssessmentDocumentScopeRow | null; error: unknown | null }>;
        };
      };
    };
  };
}

interface AssessmentPlanDocxStorageClient {
  storage: {
    from: (bucketId: string) => {
      upload: (
        objectPath: string,
        bytes: Uint8Array,
        options: { contentType: string; upsert: boolean },
      ) => Promise<{ data: unknown; error: unknown | null }>;
      createSignedUrl: (
        objectPath: string,
        expiresIn: number,
      ) => Promise<{ data: { signedUrl?: string } | null; error: unknown | null }>;
    };
  };
}

interface FilledDocxResult {
  bytes: Uint8Array;
  unresolved_placeholder_count: number;
  unresolved_placeholders: string[];
  changed_field_count: number;
}

class TemplateReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateReadError";
  }
}

interface GenerateAssessmentPlanDocxDeps {
  createRequestClient: (req: Request) => AssessmentDocumentQueryBuilder;
  resolveOrgId: (client: AssessmentDocumentQueryBuilder) => Promise<string | null>;
  supabaseAdmin: AssessmentPlanDocxStorageClient;
  generationSecret: string | null;
  readTemplateBytes: () => Promise<Uint8Array>;
  fillDocx: (
    templateBytes: Uint8Array,
    fields: Record<string, string>,
    fieldLayouts?: Array<{ field_key: string; layout_json?: Record<string, unknown> | null }>,
  ) => Promise<FilledDocxResult>;
}

const jsonResponse = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeXmlText = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const timingSafeEqual = (left: string, right: string): boolean => {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
};

export function applyPlaceholdersToXml(
  xml: string,
  fields: Record<string, string>,
): { xml: string; unresolved_placeholders: string[] } {
  let next = xml;
  for (const [key, value] of Object.entries(fields)) {
    next = next.replaceAll(`{{${key}}}`, escapeXmlText(value));
  }
  const unresolved = new Set<string>();
  for (const match of next.matchAll(PLACEHOLDER_PATTERN)) {
    if (match[1]) unresolved.add(match[1]);
  }
  return { xml: next, unresolved_placeholders: Array.from(unresolved).sort() };
}

const getXmlBlocks = (xml: string, tagName: string): RegExpMatchArray[] =>
  Array.from(xml.matchAll(new RegExp(`<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?</${tagName}>`, "g")));

const replaceCellText = (cellXml: string, value: string): string => {
  const openMatch = cellXml.match(/^<w:tc(?:\s[^>]*)?>/);
  const tcPrMatch = cellXml.match(/<w:tcPr(?:\s[^>]*)?>[\s\S]*?<\/w:tcPr>/);
  const openTag = openMatch?.[0] ?? "<w:tc>";
  const tcPr = tcPrMatch?.[0] ?? "";
  return `${openTag}${tcPr}<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(value)}</w:t></w:r></w:p></w:tc>`;
};

const replaceTableCell = (tableXml: string, rowIndex: number, columnIndex: number, value: string): string | null => {
  const rows = getXmlBlocks(tableXml, "w:tr");
  const rowMatch = rows[rowIndex];
  if (!rowMatch) return null;
  const rowXml = rowMatch[0];
  const cells = getXmlBlocks(rowXml, "w:tc");
  const cellMatch = cells[columnIndex];
  if (!cellMatch) return null;
  const cellXml = cellMatch[0];
  const nextCellXml = replaceCellText(cellXml, value);
  const nextRowXml = `${rowXml.slice(0, cellMatch.index)}${nextCellXml}${rowXml.slice((cellMatch.index ?? 0) + cellXml.length)}`;
  return `${tableXml.slice(0, rowMatch.index)}${nextRowXml}${tableXml.slice((rowMatch.index ?? 0) + rowXml.length)}`;
};

const applyFieldLayoutsToDocumentXml = (
  xml: string,
  fields: Record<string, string>,
  fieldLayouts: Array<{ field_key: string; layout_json?: Record<string, unknown> | null }> = [],
): { xml: string; changed_field_count: number; placed_fields: string[] } => {
  let next = xml;
  const placed = new Set<string>();

  for (const field of fieldLayouts) {
    const value = fields[field.field_key]?.trim();
    if (!value || !field.layout_json) continue;
    const tableIndex = field.layout_json.table_index;
    const rowIndex = field.layout_json.row;
    const columnIndex = field.layout_json.column;
    if (typeof tableIndex !== "number" || typeof rowIndex !== "number" || typeof columnIndex !== "number") continue;

    const tables = getXmlBlocks(next, "w:tbl");
    const tableMatch = tables[tableIndex];
    if (!tableMatch) continue;
    const tableXml = tableMatch[0];
    const nextTableXml = replaceTableCell(tableXml, rowIndex, columnIndex, value);
    if (!nextTableXml || nextTableXml === tableXml) continue;
    next = `${next.slice(0, tableMatch.index)}${nextTableXml}${next.slice((tableMatch.index ?? 0) + tableXml.length)}`;
    placed.add(field.field_key);
  }

  return { xml: next, changed_field_count: placed.size, placed_fields: Array.from(placed).sort() };
};

const appendGeneratedFieldValues = (
  xml: string,
  fields: Record<string, string>,
  placedFields: string[],
): { xml: string; appended_field_count: number } => {
  const placed = new Set(placedFields);
  const entries = Object.entries(fields)
    .filter(([key, value]) => !placed.has(key) && value.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return { xml, appended_field_count: 0 };

  const paragraphs = [
    `<w:p><w:r><w:b/><w:t>Generated IEHP Field Values</w:t></w:r></w:p>`,
    ...entries.map(([key, value]) =>
      `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(`${key}: ${value}`)}</w:t></w:r></w:p>`
    ),
  ].join("");
  return {
    xml: xml.replace("</w:body>", `${paragraphs}</w:body>`),
    appended_field_count: entries.length,
  };
};

export function isAllowedAssessmentPlanDocxOutputTarget({
  bucketId,
  objectPath,
  clientId,
  assessmentDocumentId,
}: {
  bucketId: string;
  objectPath: string;
  clientId: string;
  assessmentDocumentId: string;
}): boolean {
  if (bucketId !== BUCKET_ID) return false;
  const prefix = `clients/${clientId}/assessments/generated-iehp-fba-${assessmentDocumentId}-`;
  if (!objectPath.startsWith(prefix) || !objectPath.endsWith(".docx")) return false;
  const generatedSuffix = objectPath.slice(prefix.length, -".docx".length);
  return /^\d{8,}$/.test(generatedSuffix);
}

const readTemplateBytes = async (): Promise<Uint8Array> => {
  const errors: string[] = [];
  for (const target of TEMPLATE_READ_TARGETS) {
    try {
      return await Deno.readFile(target);
    } catch (error) {
      errors.push(`${String(target)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const downloadResult = await supabaseAdmin.storage.from(BUCKET_ID).download(TEMPLATE_STORAGE_OBJECT_PATH);
  if (downloadResult.data && !downloadResult.error) {
    return new Uint8Array(await downloadResult.data.arrayBuffer());
  }

  throw new TemplateReadError(
    `Could not read IEHP DOCX template from bundled static files or storage template object. ${errors.join(" | ")}`,
  );
};

export async function fillDocxTemplate(
  templateBytes: Uint8Array,
  fields: Record<string, string>,
  fieldLayouts: Array<{ field_key: string; layout_json?: Record<string, unknown> | null }> = [],
): Promise<FilledDocxResult> {
  const { default: JSZip } = await import("npm:jszip@3.10.1");
  const zip = await JSZip.loadAsync(templateBytes);
  const xmlTargets = Object.keys(zip.files).filter((path) =>
    path === "word/document.xml" ||
    /^word\/header\d+\.xml$/.test(path) ||
    /^word\/footer\d+\.xml$/.test(path)
  );
  const unresolved = new Set<string>();
  let changedFieldCount = 0;

  for (const path of xmlTargets) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    const updated = applyPlaceholdersToXml(xml, fields);
    updated.unresolved_placeholders.forEach((key) => unresolved.add(key));
    if (path === "word/document.xml") {
      const withLayouts = applyFieldLayoutsToDocumentXml(updated.xml, fields, fieldLayouts);
      const withAppendix = appendGeneratedFieldValues(withLayouts.xml, fields, withLayouts.placed_fields);
      changedFieldCount += withLayouts.changed_field_count + withAppendix.appended_field_count;
      zip.file(path, withAppendix.xml);
      continue;
    }
    zip.file(path, updated.xml);
  }

  const bytes = await zip.generateAsync({ type: "uint8array" });
  const unresolvedPlaceholders = Array.from(unresolved).sort();
  return {
    bytes: bytes as Uint8Array,
    unresolved_placeholder_count: unresolvedPlaceholders.length,
    unresolved_placeholders: unresolvedPlaceholders,
    changed_field_count: changedFieldCount,
  };
}

export const createGenerateAssessmentPlanDocxHandler =
  (deps: GenerateAssessmentPlanDocxDeps) =>
  async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const configuredSecret = deps.generationSecret?.trim() ?? "";
    if (!configuredSecret) {
      return jsonResponse({ error: "DOCX generation credential is not configured." }, 500);
    }
    const requestSecret = req.headers.get(ASSESSMENT_GENERATION_SECRET_HEADER)?.trim() ?? "";
    if (!timingSafeEqual(requestSecret, configuredSecret)) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }

    try {
      const requestClient = deps.createRequestClient(req);
      const organizationId = await deps.resolveOrgId(requestClient);
      if (!organizationId) {
        return jsonResponse({ error: "Organization context required" }, 403);
      }

      const documentResult = await requestClient
        .from("assessment_documents")
        .select("id,organization_id,client_id,template_type")
        .eq("id", parsed.data.assessment_document_id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (documentResult.error || !documentResult.data) {
        return jsonResponse({ error: "assessment_document_id is not in scope for this organization" }, 403);
      }
      if (documentResult.data.template_type !== parsed.data.template_type) {
        return jsonResponse({ error: "DOCX generation is not supported for this assessment template." }, 409);
      }
      const templateBytes = await deps.readTemplateBytes();
      if (parsed.data.template_health_check) {
        return jsonResponse({
          template_available: true,
          template_type: parsed.data.template_type,
          bucket_id: BUCKET_ID,
          storage_object_path: TEMPLATE_STORAGE_OBJECT_PATH,
          byte_count: templateBytes.byteLength,
        });
      }
      if (
        !isAllowedAssessmentPlanDocxOutputTarget({
          bucketId: parsed.data.output_bucket_id,
          objectPath: parsed.data.output_object_path ?? "",
          clientId: documentResult.data.client_id,
          assessmentDocumentId: documentResult.data.id,
        })
      ) {
        return jsonResponse({ error: "Invalid generated DOCX storage target." }, 403);
      }

      const filled = await deps.fillDocx(templateBytes, parsed.data.field_values ?? {}, parsed.data.field_layouts ?? []);
      if (filled.changed_field_count === 0) {
        return jsonResponse({ error: "IEHP DOCX template did not receive any generated field values." }, 409);
      }

      const uploadResult = await deps.supabaseAdmin.storage.from(BUCKET_ID).upload(
        parsed.data.output_object_path ?? "",
        filled.bytes,
        {
          contentType: CONTENT_TYPE,
          upsert: false,
        },
      );
      if (uploadResult.error) {
        return jsonResponse({ error: "Failed to upload generated DOCX." }, 500);
      }

      const signedResult = await deps.supabaseAdmin.storage.from(BUCKET_ID).createSignedUrl(
        parsed.data.output_object_path ?? "",
        60 * 10,
      );
      if (signedResult.error || !signedResult.data?.signedUrl) {
        return jsonResponse({ error: "Failed to create download URL." }, 500);
      }

      const filename = parsed.data.output_object_path?.split("/").pop() ?? "generated-iehp-fba.docx";
      return jsonResponse({
        bucket_id: BUCKET_ID,
        object_path: parsed.data.output_object_path,
        signed_url: signedResult.data.signedUrl,
        filename,
        content_type: CONTENT_TYPE,
        unresolved_placeholder_count: filled.unresolved_placeholder_count,
        unresolved_placeholders: filled.unresolved_placeholders,
        changed_field_count: filled.changed_field_count,
      });
    } catch (error) {
      console.error("generate-assessment-plan-docx error", error);
      if (error instanceof TemplateReadError) {
        return jsonResponse({ error: "IEHP DOCX template is not available to the deployed function." }, 500);
      }
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  };

export const generateAssessmentPlanDocxHandler =
  createGenerateAssessmentPlanDocxHandler({
    createRequestClient: createRequestClient as unknown as (req: Request) => AssessmentDocumentQueryBuilder,
    resolveOrgId: resolveOrgId as unknown as (client: AssessmentDocumentQueryBuilder) => Promise<string | null>,
    supabaseAdmin: supabaseAdmin as unknown as AssessmentPlanDocxStorageClient,
    generationSecret: Deno.env.get("ASSESSMENT_GENERATION_SECRET") ?? null,
    readTemplateBytes,
    fillDocx: fillDocxTemplate,
  });

const handler = createProtectedRoute(generateAssessmentPlanDocxHandler, RouteOptions.therapist);

if (import.meta.main) {
  Deno.serve(handler);
}

export default handler;
