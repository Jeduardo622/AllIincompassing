import { expect } from "jsr:@std/expect";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

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
      upload: (
        _objectPath: string,
        _bytes: Uint8Array,
        _options: { contentType: string; upsert: boolean },
      ) => Promise.resolve({ data: {}, error: null }),
      createSignedUrl: () =>
        Promise.resolve({
          data: { signedUrl: "https://example.supabase.co/generated.pdf" },
          error: null,
        }),
    }),
  },
});

const createCapturingAdminStorage = () => {
  let uploadedBytes: Uint8Array | null = null;

  return {
    getUploadedBytes: () => uploadedBytes,
    storage: {
      from: () => ({
        upload: (
          _objectPath: string,
          bytes: Uint8Array,
          _options: { contentType: string; upsert: boolean },
        ) => {
          uploadedBytes = bytes;
          return Promise.resolve({ data: {}, error: null });
        },
        createSignedUrl: () =>
          Promise.resolve({
            data: { signedUrl: "https://example.supabase.co/generated.pdf" },
            error: null,
          }),
      }),
    },
  };
};

const createPdfWithFieldsBase64 = async (): Promise<string> => {
  const pdfDoc = await PDFDocument.create();
  const textPage = pdfDoc.addPage([612, 792]);
  const checkboxPage = pdfDoc.addPage([612, 792]);
  pdfDoc.addPage([612, 792]);
  pdfDoc.addPage([612, 792]);

  const form = pdfDoc.getForm();
  const textField = form.createTextField("Member Name");
  textField.addToPage(textPage, {
    x: 10,
    y: 740,
    width: 120,
    height: 20,
  });

  const checkbox = form.createCheckBox("Has IEP");
  checkbox.addToPage(checkboxPage, {
    x: 10,
    y: 740,
    width: 12,
    height: 12,
  });

  const bytes = await pdfDoc.save();
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

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

Deno.test("generateAssessmentPlanPdfHandler reports filled_pages from visible rendered fields only", async () => {
  const templatePdfBase64 = await createPdfWithFieldsBase64();
  const payload = {
    ...validPayload,
    template_pdf_base64: templatePdfBase64,
    render_map_entries: [
      {
        placeholder_key: "VISIBLE_TEXT",
        form_field_candidates: ["Member Name"],
        fallback: {
          page: 1,
          x: 10,
          y: 740,
          font_size: 10,
          max_width: 120,
          height: 20,
          line_height: 12,
          max_lines: 1,
          field_kind: "text",
        },
      },
      {
        placeholder_key: "UNCHECKED_BOX",
        form_field_candidates: ["Has IEP"],
        fallback: {
          page: 2,
          x: 10,
          y: 740,
          font_size: 10,
          max_width: 12,
          height: 12,
          line_height: 12,
          max_lines: 1,
          field_kind: "checkbox",
        },
      },
      {
        placeholder_key: "SANITIZED_EMPTY_OVERLAY",
        form_field_candidates: ["Missing Sanitized Empty"],
        fallback: {
          page: 3,
          x: 10,
          y: 740,
          font_size: 10,
          max_width: 120,
          height: 20,
          line_height: 12,
          max_lines: 1,
          field_kind: "text",
        },
      },
      {
        placeholder_key: "VISIBLE_OVERLAY",
        form_field_candidates: ["Missing Overlay"],
        fallback: {
          page: 4,
          x: 10,
          y: 740,
          font_size: 10,
          max_width: 120,
          height: 20,
          line_height: 12,
          max_lines: 1,
          field_kind: "text",
        },
      },
    ],
    field_values: {
      VISIBLE_TEXT: "Client One",
      UNCHECKED_BOX: "no",
      SANITIZED_EMPTY_OVERLAY: "☢",
      VISIBLE_OVERLAY: "Overlay text",
    },
  };
  const handler = createTestHandler();
  const response = await handler(postRequest(payload));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.filled_pages).toEqual([1, 4]);
  expect(body.fill_mode).toBe("mixed");
});

Deno.test("generateAssessmentPlanPdfHandler appends readable goal appendix pages without layout warnings", async () => {
  const templatePdfBase64 = await createPdfWithFieldsBase64();
  const admin = createCapturingAdminStorage();
  const payload = {
    ...validPayload,
    template_pdf_base64: templatePdfBase64,
    render_map_entries: [
      {
        placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
        form_field_candidates: ["Missing Skill Goals"],
        fallback: {
          page: 1,
          x: 20,
          y: 720,
          font_size: 8,
          max_width: 260,
          height: 20,
          line_height: 10,
          max_lines: 2,
          field_kind: "structured_section",
        },
      },
    ],
    field_values: {
      CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS:
        "See Goal Detail Appendix for 2 complete skill acquisition goals.",
      CALOPTIMA_FBA_GOAL_DETAIL_APPENDIX: [
        "Skill acquisition goals",
        "1. Communication goal: request help independently across three settings.",
        "2. Daily living goal: complete hygiene routine with visual supports.",
        ...Array.from(
          { length: 120 },
          (_, index) =>
            `${index + 3}. Continuation detail ${
              index + 1
            }: maintain clinically reviewed goal details across appended PDF pages.`,
        ),
      ].join("\n"),
    },
  };
  const handler = createTestHandler({ admin });
  const response = await handler(postRequest(payload));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.overflow_keys).toEqual([]);
  expect(body.layout_warnings).toEqual([]);

  const uploadedBytes = admin.getUploadedBytes();
  if (!uploadedBytes) {
    throw new Error("Expected generated PDF bytes to be uploaded.");
  }
  const pdfDoc = await PDFDocument.load(uploadedBytes);
  expect(pdfDoc.getPageCount()).toBeGreaterThan(5);
});

Deno.test("generateAssessmentPlanPdfHandler skips appendix pages when appendix content sanitizes to empty", async () => {
  const templatePdfBase64 = await createPdfWithFieldsBase64();
  const admin = createCapturingAdminStorage();
  const payload = {
    ...validPayload,
    template_pdf_base64: templatePdfBase64,
    render_map_entries: [
      {
        placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
        form_field_candidates: ["Missing Skill Goals"],
        fallback: {
          page: 1,
          x: 20,
          y: 720,
          font_size: 8,
          max_width: 260,
          height: 20,
          line_height: 10,
          max_lines: 2,
          field_kind: "structured_section",
        },
      },
    ],
    field_values: {
      CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS:
        "See Goal Detail Appendix for 1 complete skill acquisition goal.",
      CALOPTIMA_FBA_GOAL_DETAIL_APPENDIX: "☢",
    },
  };
  const handler = createTestHandler({ admin });
  const response = await handler(postRequest(payload));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.overflow_keys).toEqual([]);
  expect(body.layout_warnings).toEqual([]);

  const uploadedBytes = admin.getUploadedBytes();
  if (!uploadedBytes) {
    throw new Error("Expected generated PDF bytes to be uploaded.");
  }
  const pdfDoc = await PDFDocument.load(uploadedBytes);
  expect(pdfDoc.getPageCount()).toBe(4);
});
