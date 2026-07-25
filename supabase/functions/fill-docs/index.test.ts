import { expect } from "jsr:@std/expect";

Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("SUPABASE_PUBLISHABLE_KEY", "anon-key");

const {
  createFillDocsHandler,
  default: fillDocsRoute,
  TEMPLATES,
  TEMPLATE_STATIC_FILES,
} = await import("./index.ts");

const postRequest = (payload: unknown): Request =>
  new Request("https://edge.test/fill-docs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
      apikey: "anon",
    },
    body: JSON.stringify(payload),
  });

const fillDocsConfigBlock = await (async () => {
  const configToml = await Deno.readTextFile(
    new URL("../../config.toml", import.meta.url),
  );
  const match = configToml.match(/\[functions\.fill-docs\][\s\S]*?(?=\n\[|$)/);
  return match?.[0] ?? "";
})();

Deno.test("fill-docs bundled template references resolve to tracked assets and config static_files", async () => {
  expect(TEMPLATE_STATIC_FILES).toEqual(
    Object.values(TEMPLATES).map((template) => template.staticFile),
  );

  for (const template of Object.values(TEMPLATES)) {
    await expect(Deno.stat(template.fileUrl)).resolves.toMatchObject({
      isFile: true,
    });
    expect(fillDocsConfigBlock).toContain(template.staticFile);
  }
});

Deno.test("fill-docs protected route answers OPTIONS before authentication", async () => {
  const response = await fillDocsRoute(
    new Request("https://edge.test/functions/v1/fill-docs", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.allincompassing.ai",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    }),
  );

  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
    "https://app.allincompassing.ai",
  );
  expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
    "OPTIONS",
  );
  expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
    "Authorization",
  );
});

Deno.test("fillDocsHandler returns backward-compatible base64 JSON without persistence metadata", async () => {
  const handler = createFillDocsHandler({
    readTemplateBytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    fillDocxTemplate: () => Promise.resolve(new Uint8Array([4, 5, 6])),
  });

  const response = await handler(postRequest({
    template: "FBA",
    fields: { CLIENT_NAME: "Synthetic Client" },
    outputFileName: "synthetic-output",
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    success: true,
    template: "FBA",
    filename: "synthetic-output.docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    base64: btoa(String.fromCharCode(4, 5, 6)),
  });
});

Deno.test("fill-docs source no longer carries storage persistence code paths", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );

  expect(source).not.toContain("therapist_documents");
  expect(source).not.toContain(".upload(");
  expect(source).not.toContain("createSignedUrl");
  expect(source).not.toContain("requireOrg");
  expect(source).not.toContain("resolveTherapistIdForUser");
  expect(source).not.toContain("supabaseAdmin");
});
