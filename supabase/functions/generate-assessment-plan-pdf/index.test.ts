import { expect } from "jsr:@std/expect";

import { layoutOverlayText, wrapOverlayText } from "./overlay-layout.ts";
import {
  isPdfCheckboxNotApplicableValue,
  resolvePdfCheckboxValue,
  sanitizePdfText,
} from "./pdf-text.ts";
import { isAllowedAssessmentPlanPdfOutputTarget } from "./storage-scope.ts";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");

const { createGenerateAssessmentPlanPdfHandler } = await import("./index.ts");

const validPayload = {
  assessment_document_id: "41df4f57-1a22-4df1-b05f-cf8f3675267c",
  template_type: "caloptima_fba",
  template_pdf_base64: "JVBERi0xLjQK",
  render_map_entries: [
    {
      placeholder_key: "CALOPTIMA_FBA_MEMBER_NAME",
      form_field_candidates: ["Member Name"],
      fallback: {
        page: 1,
        x: 10,
        y: 10,
        font_size: 10,
        max_width: 100,
        height: 14,
        line_height: 12,
        max_lines: 1,
        field_kind: "text",
      },
    },
  ],
  field_values: { CALOPTIMA_FBA_MEMBER_NAME: "Client One" },
  output_bucket_id: "client-documents",
  output_object_path:
    "clients/af87b28a-d0cf-4c73-8bce-8f1889b77c34/assessments/generated-caloptima-plan-41df4f57-1a22-4df1-b05f-cf8f3675267c-1778712054626.pdf",
};

const postRequest = (payload: unknown): Request =>
  new Request("https://edge.test/generate-assessment-plan-pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
      apikey: "anon",
    },
    body: JSON.stringify(payload),
  });

const createRequestClientForDocument = (
  documentResult: {
    data: {
      id: string;
      organization_id: string;
      client_id: string;
      template_type: string;
    } | null;
    error: unknown | null;
  },
) =>
() => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(documentResult),
        }),
      }),
    }),
  }),
});

const createAdminStorage = () => ({
  storage: {
    from: () => ({
      upload: () => Promise.resolve({ data: {}, error: null }),
      createSignedUrl: () =>
        Promise.resolve({
          data: { signedUrl: "https://example.supabase.co/generated.pdf" },
          error: null,
        }),
    }),
  },
});

type TestDocumentResult = {
  data: {
    id: string;
    organization_id: string;
    client_id: string;
    template_type: string;
  } | null;
  error: unknown | null;
};

const validDocumentResult = {
  data: {
    id: validPayload.assessment_document_id,
    organization_id: "org-1",
    client_id: "af87b28a-d0cf-4c73-8bce-8f1889b77c34",
    template_type: "caloptima_fba",
  },
  error: null,
};

const createTestHandler = ({
  organizationId = "org-1",
  documentResult = validDocumentResult,
  admin = createAdminStorage(),
}: {
  organizationId?: string | null;
  documentResult?: TestDocumentResult;
  admin?: ReturnType<typeof createAdminStorage>;
} = {}) =>
  createGenerateAssessmentPlanPdfHandler({
    createRequestClient: createRequestClientForDocument(documentResult),
    resolveOrgId: () => Promise.resolve(organizationId),
    supabaseAdmin: admin,
  });

Deno.test("sanitizePdfText normalizes unsupported glyphs for PDF rendering", () => {
  const raw =
    "Caregiver goals ● improve transitions — maintain consistency\n“Smart quotes” and ellipsis…";

  expect(sanitizePdfText(raw)).toBe(
    'Caregiver goals - improve transitions - maintain consistency\n"Smart quotes" and ellipsis...',
  );
});

Deno.test("sanitizePdfText preserves supported Latin-1 characters", () => {
  const raw = "José François Åsa Zoë Crème brûlée";

  expect(sanitizePdfText(raw)).toBe(raw);
});

Deno.test("resolvePdfCheckboxValue preserves explicit unchecked behavior for unsupported glyphs", () => {
  expect(resolvePdfCheckboxValue("☐")).toBe(false);
  expect(resolvePdfCheckboxValue("✗")).toBe(false);
  expect(resolvePdfCheckboxValue("   ")).toBeNull();
});

Deno.test("isPdfCheckboxNotApplicableValue preserves N/A as a distinct checkbox fallback case", () => {
  expect(isPdfCheckboxNotApplicableValue("N/A")).toBe(true);
  expect(isPdfCheckboxNotApplicableValue("not applicable")).toBe(true);
  expect(isPdfCheckboxNotApplicableValue("No")).toBe(false);
});

Deno.test("layoutOverlayText fits text inside the configured field box and flags overflow", () => {
  const font = {
    widthOfTextAtSize: (value: string, size: number) =>
      value.length * size * 0.5,
  };

  const layout = layoutOverlayText(
    {
      placeholder_key: "CALOPTIMA_FBA_CHIEF_COMPLAINT",
      fallback: {
        page: 2,
        x: 64,
        y: 541,
        font_size: 8,
        max_width: 80,
        height: 18,
        line_height: 9,
      },
    },
    "This long complaint must wrap across more than two lines without drawing beyond the box.",
    font,
  );

  expect(layout.lines.length).toBe(2);
  expect(layout.warning?.placeholder_key).toBe("CALOPTIMA_FBA_CHIEF_COMPLAINT");
  expect(layout.warning?.reason).toBe("overflow");
});

Deno.test("wrapOverlayText does not insert spaces into long unbroken tokens", () => {
  const font = {
    widthOfTextAtSize: (value: string, size: number) => value.length * size,
  };
  const rawToken = "CIN1234567890";
  const lines = wrapOverlayText(rawToken, 36, font, 6);

  expect(lines.join("")).toBe(rawToken);
  expect(lines.join(" ")).not.toBe(rawToken);
});

Deno.test("isAllowedAssessmentPlanPdfOutputTarget only allows scoped generated assessment PDFs", () => {
  const clientId = "af87b28a-d0cf-4c73-8bce-8f1889b77c34";
  const assessmentDocumentId = "41df4f57-1a22-4df1-b05f-cf8f3675267c";
  const objectPath =
    `clients/${clientId}/assessments/generated-caloptima-plan-${assessmentDocumentId}-1778712054626.pdf`;

  expect(
    isAllowedAssessmentPlanPdfOutputTarget({
      bucketId: "client-documents",
      objectPath,
      clientId,
      assessmentDocumentId,
    }),
  ).toBe(true);
  expect(
    isAllowedAssessmentPlanPdfOutputTarget({
      bucketId: "avatars",
      objectPath,
      clientId,
      assessmentDocumentId,
    }),
  ).toBe(false);
  expect(
    isAllowedAssessmentPlanPdfOutputTarget({
      bucketId: "client-documents",
      objectPath: objectPath.replace(clientId, "different-client"),
      clientId,
      assessmentDocumentId,
    }),
  ).toBe(false);
  expect(
    isAllowedAssessmentPlanPdfOutputTarget({
      bucketId: "client-documents",
      objectPath:
        `clients/${clientId}/assessments/generated-caloptima-plan-${assessmentDocumentId}-../escape.pdf`,
      clientId,
      assessmentDocumentId,
    }),
  ).toBe(false);
});

Deno.test("generateAssessmentPlanPdfHandler requires organization context", async () => {
  const handler = createTestHandler({ organizationId: null });
  const response = await handler(postRequest(validPayload));

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Organization context required",
  });
});

Deno.test("generateAssessmentPlanPdfHandler rejects out-of-scope assessment documents", async () => {
  const handler = createTestHandler({
    documentResult: { data: null, error: null },
  });
  const response = await handler(postRequest(validPayload));

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "assessment_document_id is not in scope for this organization",
  });
});

Deno.test("generateAssessmentPlanPdfHandler rejects mismatched template types", async () => {
  const handler = createTestHandler({
    documentResult: {
      data: { ...validDocumentResult.data, template_type: "iehp_fba" },
      error: null,
    },
  });
  const response = await handler(postRequest(validPayload));

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "PDF generation is not supported for this assessment template.",
  });
});

Deno.test("generateAssessmentPlanPdfHandler rejects invalid generated PDF storage targets", async () => {
  const handler = createTestHandler();
  const response = await handler(
    postRequest({ ...validPayload, output_bucket_id: "avatars" }),
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Invalid generated PDF storage target.",
  });
});
