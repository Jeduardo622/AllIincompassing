import { expect } from "jsr:@std/expect";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");

const { createGenerateAssessmentPlanDocxHandler, applyPlaceholdersToXml, fillDocxTemplate, isAllowedAssessmentPlanDocxOutputTarget } =
  await import("./index.ts");

const validPayload = {
  assessment_document_id: "41df4f57-1a22-4df1-b05f-cf8f3675267c",
  template_type: "iehp_fba",
  field_values: {
    IEHP_FBA_FIRST_NAME: "Client & <One>",
  },
  field_layouts: [{ field_key: "IEHP_FBA_FIRST_NAME", layout_json: { table_index: 0, row: 0, column: 1 } }],
  output_bucket_id: "client-documents",
  output_object_path:
    "clients/af87b28a-d0cf-4c73-8bce-8f1889b77c34/assessments/generated-iehp-fba-41df4f57-1a22-4df1-b05f-cf8f3675267c-1778712054626.docx",
};

const postRequest = (payload: unknown): Request =>
  new Request("https://edge.test/generate-assessment-plan-docx", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
      apikey: "anon",
    },
    body: JSON.stringify(payload),
  });

const validDocumentResult = {
  data: {
    id: validPayload.assessment_document_id,
    organization_id: "org-1",
    client_id: "af87b28a-d0cf-4c73-8bce-8f1889b77c34",
    template_type: "iehp_fba",
  },
  error: null,
};

const createRequestClientForDocument = (documentResult = validDocumentResult) =>
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
          data: { signedUrl: "https://example.supabase.co/generated.docx" },
          error: null,
        }),
    }),
  },
});

const createTestHandler = ({
  organizationId = "org-1",
  documentResult = validDocumentResult,
  templateBytes = new Uint8Array([1, 2, 3]),
  fillDocx = () =>
    Promise.resolve({
      bytes: new Uint8Array([4, 5, 6]),
      unresolved_placeholder_count: 0,
      unresolved_placeholders: [],
      changed_field_count: 1,
    }),
  admin = createAdminStorage(),
}: {
  organizationId?: string | null;
  documentResult?: typeof validDocumentResult;
  templateBytes?: Uint8Array;
  fillDocx?: (templateBytes: Uint8Array, fields: Record<string, string>) => Promise<{
    bytes: Uint8Array;
    unresolved_placeholder_count: number;
    unresolved_placeholders: string[];
  }>;
  admin?: ReturnType<typeof createAdminStorage>;
} = {}) =>
  createGenerateAssessmentPlanDocxHandler({
    createRequestClient: createRequestClientForDocument(documentResult),
    resolveOrgId: () => Promise.resolve(organizationId),
    supabaseAdmin: admin,
    readTemplateBytes: () => Promise.resolve(templateBytes),
    fillDocx,
  });

Deno.test("applyPlaceholdersToXml escapes XML text values", () => {
  const xml = "<w:t>{{IEHP_FBA_FIRST_NAME}}</w:t><w:t>{{MISSING_FIELD}}</w:t>";
  const result = applyPlaceholdersToXml(xml, {
    IEHP_FBA_FIRST_NAME: "Client & <One>",
  });

  expect(result.xml).toContain("Client &amp; &lt;One&gt;");
  expect(result.unresolved_placeholders).toEqual(["MISSING_FIELD"]);
});

Deno.test("isAllowedAssessmentPlanDocxOutputTarget only allows scoped generated IEHP DOCX files", () => {
  const clientId = "af87b28a-d0cf-4c73-8bce-8f1889b77c34";
  const assessmentDocumentId = "41df4f57-1a22-4df1-b05f-cf8f3675267c";
  const objectPath =
    `clients/${clientId}/assessments/generated-iehp-fba-${assessmentDocumentId}-1778712054626.docx`;

  expect(isAllowedAssessmentPlanDocxOutputTarget({ bucketId: "client-documents", objectPath, clientId, assessmentDocumentId })).toBe(true);
  expect(isAllowedAssessmentPlanDocxOutputTarget({ bucketId: "avatars", objectPath, clientId, assessmentDocumentId })).toBe(false);
  expect(
    isAllowedAssessmentPlanDocxOutputTarget({
      bucketId: "client-documents",
      objectPath: objectPath.replace(clientId, "different-client"),
      clientId,
      assessmentDocumentId,
    }),
  ).toBe(false);
});

Deno.test("generateAssessmentPlanDocxHandler rejects invalid storage scope", async () => {
  const handler = createTestHandler();
  const response = await handler(postRequest({ ...validPayload, output_bucket_id: "avatars" }));

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "Invalid generated DOCX storage target." });
});

Deno.test("generateAssessmentPlanDocxHandler uploads to client-documents and returns signed DOCX metadata", async () => {
  const handler = createTestHandler();
  const response = await handler(postRequest(validPayload));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    bucket_id: "client-documents",
    object_path: validPayload.output_object_path,
    signed_url: "https://example.supabase.co/generated.docx",
    filename: "generated-iehp-fba-41df4f57-1a22-4df1-b05f-cf8f3675267c-1778712054626.docx",
    content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    unresolved_placeholder_count: 0,
    unresolved_placeholders: [],
    changed_field_count: 1,
  });
});

Deno.test("fillDocxTemplate changes the committed IEHP template when table layouts are provided", async () => {
  const templateBytes = await Deno.readFile(new URL("./fill_docs/Updated FBA -IEHP.docx", import.meta.url));
  const filled = await fillDocxTemplate(
    templateBytes,
    { IEHP_FBA_FIRST_NAME: "SyntheticFirst", IEHP_FBA_REASON_FOR_REFERRAL: "Synthetic referral narrative" },
    [{ field_key: "IEHP_FBA_FIRST_NAME", layout_json: { table_index: 0, row: 0, column: 1 } }],
  );

  expect(filled.changed_field_count).toBe(2);
  const { default: JSZip } = await import("npm:jszip@3.10.1");
  const zip = await JSZip.loadAsync(filled.bytes);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  expect(documentXml).toContain("SyntheticFirst");
  expect(documentXml).toContain("IEHP_FBA_REASON_FOR_REFERRAL: Synthetic referral narrative");
});
