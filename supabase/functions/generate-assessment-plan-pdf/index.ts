import { PDFCheckBox, PDFDocument, PDFTextField, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { z } from "npm:zod@3.23.8";
import { createProtectedRoute, corsHeaders, RouteOptions } from "../_shared/auth-middleware.ts";
import { supabaseAdmin } from "../_shared/database.ts";

const renderMapEntrySchema = z.object({
  placeholder_key: z.string().trim().min(1),
  form_field_candidates: z.array(z.string().trim().min(1)).min(1),
  fallback: z.object({
    page: z.number().int().positive(),
    x: z.number(),
    y: z.number(),
    font_size: z.number().positive(),
    max_width: z.number().positive(),
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

const toUint8Array = (base64Value: string): Uint8Array => {
  const binary = atob(base64Value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const wrapText = (text: string, maxWidth: number, font: { widthOfTextAtSize: (value: string, size: number) => number }, fontSize: number): string[] => {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let currentLine = words[0];
  for (let index = 1; index < words.length; index += 1) {
    const nextWord = words[index];
    const candidate = `${currentLine} ${nextWord}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = nextWord;
    }
  }
  lines.push(currentLine);
  return lines;
};

const normalizeCheckboxValue = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "checked" || normalized === "1";
};

export default createProtectedRoute(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
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
    const templateBytes = toUint8Array(parsed.data.template_pdf_base64);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    const fieldsByName = new Map(fields.map((field) => [field.getName(), field]));
    let filledAcroFormCount = 0;

    for (const entry of parsed.data.render_map_entries) {
      const rawValue = parsed.data.field_values[entry.placeholder_key];
      const value = typeof rawValue === "string" ? rawValue.trim() : "";
      if (!value) continue;

      const match = entry.form_field_candidates
        .map((candidate) => fieldsByName.get(candidate))
        .find((field) => Boolean(field));
      if (!match) continue;

      if (match instanceof PDFTextField) {
        match.setText(value);
        filledAcroFormCount += 1;
        continue;
      }

      if (match instanceof PDFCheckBox) {
        if (normalizeCheckboxValue(value)) {
          match.check();
        } else {
          match.uncheck();
        }
        filledAcroFormCount += 1;
      }
    }

    const fillMode: "acroform" | "overlay" = filledAcroFormCount > 0 ? "acroform" : "overlay";
    if (fillMode === "overlay") {
      const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

      for (const entry of parsed.data.render_map_entries) {
        const rawValue = parsed.data.field_values[entry.placeholder_key];
        const value = typeof rawValue === "string" ? rawValue.trim() : "";
        if (!value) continue;

        const pageIndex = entry.fallback.page - 1;
        const page = pdfDoc.getPage(pageIndex);
        if (!page) continue;

        const lines = wrapText(value, entry.fallback.max_width, regularFont, entry.fallback.font_size);
        lines.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: entry.fallback.x,
            y: entry.fallback.y - lineIndex * (entry.fallback.font_size + 2),
            size: entry.fallback.font_size,
            font: regularFont,
            color: rgb(0.12, 0.12, 0.12),
          });
        });
      }
    }

    const pdfBytes = await pdfDoc.save();

    const uploadResult = await supabaseAdmin.storage
      .from(parsed.data.output_bucket_id)
      .upload(parsed.data.output_object_path, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadResult.error) {
      return new Response(JSON.stringify({ error: "Failed to upload generated PDF." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const signedResult = await supabaseAdmin.storage
      .from(parsed.data.output_bucket_id)
      .createSignedUrl(parsed.data.output_object_path, 60 * 10);
    if (signedResult.error || !signedResult.data?.signedUrl) {
      return new Response(JSON.stringify({ error: "Failed to create download URL." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        fill_mode: fillMode,
        bucket_id: parsed.data.output_bucket_id,
        object_path: parsed.data.output_object_path,
        signed_url: signedResult.data.signedUrl,
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
}, RouteOptions.therapist);
