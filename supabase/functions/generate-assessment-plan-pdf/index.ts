import {
  PDFCheckBox,
  PDFDocument,
  PDFTextField,
  rgb,
  StandardFonts,
} from "npm:pdf-lib@1.17.1";
import { z } from "npm:zod@3.23.8";
import {
  corsHeaders,
  createProtectedRoute,
  RouteOptions,
} from "../_shared/auth-middleware.ts";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { resolveOrgId } from "../_shared/org.ts";
import {
  layoutOverlayText,
  type OverlayLayoutWarning,
} from "./overlay-layout.ts";
import {
  isPdfCheckboxNotApplicableValue,
  resolvePdfCheckboxValue,
  sanitizePdfText,
} from "./pdf-text.ts";
import {
  ASSESSMENT_PLAN_PDF_BUCKET_ID,
  isAllowedAssessmentPlanPdfOutputTarget,
} from "./storage-scope.ts";

const renderMapEntrySchema = z.object({
  placeholder_key: z.string().trim().min(1),
  form_field_candidates: z.array(z.string().trim().min(1)).min(1),
  fallback: z.object({
    page: z.number().int().positive(),
    x: z.number(),
    y: z.number(),
    font_size: z.number().positive(),
    max_width: z.number().positive(),
    height: z.number().positive().optional(),
    line_height: z.number().positive().optional(),
    max_lines: z.number().int().positive().optional(),
    field_kind: z.string().trim().min(1).optional(),
  }),
});

const requestSchema = z.object({
  assessment_document_id: z.string().uuid(),
  template_type: z.literal("caloptima_fba"),
  template_pdf_base64: z.string().min(1),
  render_map_entries: z.array(renderMapEntrySchema).min(1),
  field_values: z.record(z.string()),
  output_bucket_id: z.string().trim().min(1).default("client-documents"),
  output_object_path: z.string().trim().min(1),
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
          maybeSingle: () => Promise<
            { data: AssessmentDocumentScopeRow | null; error: unknown | null }
          >;
        };
      };
    };
  };
}

interface AssessmentPlanPdfStorageClient {
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
      ) => Promise<
        { data: { signedUrl?: string } | null; error: unknown | null }
      >;
    };
  };
}

interface GenerateAssessmentPlanPdfDeps {
  createRequestClient: (req: Request) => AssessmentDocumentQueryBuilder;
  resolveOrgId: (
    client: AssessmentDocumentQueryBuilder,
  ) => Promise<string | null>;
  supabaseAdmin: AssessmentPlanPdfStorageClient;
}

const toUint8Array = (base64Value: string): Uint8Array => {
  const binary = atob(base64Value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const createGenerateAssessmentPlanPdfHandler =
  (deps: GenerateAssessmentPlanPdfDeps) =>
  async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const requestClient = deps.createRequestClient(req);
      const organizationId = await deps.resolveOrgId(requestClient);
      if (!organizationId) {
        return new Response(
          JSON.stringify({ error: "Organization context required" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const documentResult = await requestClient
        .from("assessment_documents")
        .select("id,organization_id,client_id,template_type")
        .eq("id", parsed.data.assessment_document_id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (documentResult.error || !documentResult.data) {
        return new Response(
          JSON.stringify({
            error:
              "assessment_document_id is not in scope for this organization",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (documentResult.data.template_type !== parsed.data.template_type) {
        return new Response(
          JSON.stringify({
            error:
              "PDF generation is not supported for this assessment template.",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (
        !isAllowedAssessmentPlanPdfOutputTarget({
          bucketId: parsed.data.output_bucket_id,
          objectPath: parsed.data.output_object_path,
          clientId: documentResult.data.client_id,
          assessmentDocumentId: documentResult.data.id,
        })
      ) {
        return new Response(
          JSON.stringify({ error: "Invalid generated PDF storage target." }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const templateBytes = toUint8Array(parsed.data.template_pdf_base64);
      const pdfDoc = await PDFDocument.load(templateBytes);
      const form = pdfDoc.getForm();
      const fields = form.getFields();
      const fieldsByName = new Map(
        fields.map((field) => [field.getName(), field]),
      );
      let filledAcroFormCount = 0;
      const acroFormFilledKeys = new Set<string>();

      for (const entry of parsed.data.render_map_entries) {
        const rawValue = parsed.data.field_values[entry.placeholder_key];
        const rawText = typeof rawValue === "string" ? rawValue : "";

        const match = entry.form_field_candidates
          .map((candidate) => fieldsByName.get(candidate))
          .find((field) => Boolean(field));
        if (!match) continue;

        if (match instanceof PDFCheckBox) {
          if (isPdfCheckboxNotApplicableValue(rawText)) {
            match.uncheck();
            continue;
          }
          const checkboxValue = resolvePdfCheckboxValue(rawText);
          if (checkboxValue === null) continue;
          if (checkboxValue) {
            match.check();
          } else {
            match.uncheck();
          }
          filledAcroFormCount += 1;
          acroFormFilledKeys.add(entry.placeholder_key);
          continue;
        }

        const value = sanitizePdfText(rawText);
        if (!value) continue;

        if (match instanceof PDFTextField) {
          match.setText(value);
          filledAcroFormCount += 1;
          acroFormFilledKeys.add(entry.placeholder_key);
          continue;
        }
      }

      const layoutWarnings: OverlayLayoutWarning[] = [];
      let overlayFilledCount = 0;
      if (acroFormFilledKeys.size < parsed.data.render_map_entries.length) {
        const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

        for (const entry of parsed.data.render_map_entries) {
          if (acroFormFilledKeys.has(entry.placeholder_key)) continue;

          const rawValue = parsed.data.field_values[entry.placeholder_key];
          const value = typeof rawValue === "string"
            ? sanitizePdfText(rawValue)
            : "";
          if (!value) continue;

          const pageIndex = entry.fallback.page - 1;
          if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;
          const page = pdfDoc.getPage(pageIndex);
          if (!page) continue;

          const layout = layoutOverlayText(entry, value, regularFont);
          if (layout.warning) {
            layoutWarnings.push(layout.warning);
          }
          if (layout.lines.length > 0) {
            overlayFilledCount += 1;
          }
          layout.lines.forEach((line, lineIndex) => {
            page.drawText(line, {
              x: entry.fallback.x,
              y: entry.fallback.y - lineIndex * layout.line_height,
              size: entry.fallback.font_size,
              font: regularFont,
              color: rgb(0.12, 0.12, 0.12),
            });
          });
        }
      }
      const fillMode: "acroform" | "overlay" | "mixed" =
        filledAcroFormCount > 0 && overlayFilledCount > 0
          ? "mixed"
          : filledAcroFormCount > 0
          ? "acroform"
          : "overlay";

      const pdfBytes = await pdfDoc.save();

      const uploadResult = await deps.supabaseAdmin.storage
        .from(ASSESSMENT_PLAN_PDF_BUCKET_ID)
        .upload(parsed.data.output_object_path, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (uploadResult.error) {
        return new Response(
          JSON.stringify({ error: "Failed to upload generated PDF." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const signedResult = await deps.supabaseAdmin.storage
        .from(ASSESSMENT_PLAN_PDF_BUCKET_ID)
        .createSignedUrl(parsed.data.output_object_path, 60 * 10);
      if (signedResult.error || !signedResult.data?.signedUrl) {
        return new Response(
          JSON.stringify({ error: "Failed to create download URL." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          fill_mode: fillMode,
          bucket_id: ASSESSMENT_PLAN_PDF_BUCKET_ID,
          object_path: parsed.data.output_object_path,
          signed_url: signedResult.data.signedUrl,
          layout_warnings: layoutWarnings,
          overflow_keys: layoutWarnings.map((warning) =>
            warning.placeholder_key
          ),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      console.error("generate-assessment-plan-pdf error", error);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  };

export const generateAssessmentPlanPdfHandler =
  createGenerateAssessmentPlanPdfHandler({
    createRequestClient: createRequestClient as unknown as (
      req: Request,
    ) => AssessmentDocumentQueryBuilder,
    resolveOrgId: resolveOrgId as unknown as (
      client: AssessmentDocumentQueryBuilder,
    ) => Promise<string | null>,
    supabaseAdmin: supabaseAdmin as unknown as AssessmentPlanPdfStorageClient,
  });

const handler = createProtectedRoute(
  generateAssessmentPlanPdfHandler,
  RouteOptions.therapist,
);

if (import.meta.main) {
  Deno.serve(handler);
}

export default handler;
