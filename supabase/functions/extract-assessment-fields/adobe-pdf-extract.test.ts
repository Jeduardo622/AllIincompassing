import { expect } from "jsr:@std/expect";
import {
  AdobePdfExtractError,
  extractPdfWithAdobe,
  getAdobePdfExtractCredentials,
  normalizeAdobeExtractZip,
  normalizeAdobeStructuredData,
} from "./adobe-pdf-extract.ts";

const ADOBE_US_STORAGE_URL =
  "https://dcplatformstorageservice-prod-us-east-1.s3-accelerate.amazonaws.com/upload.pdf?X-Amz-Signature=test";

const envFrom = (values: Record<string, string | undefined>) => ({
  get(name: string): string | undefined {
    return values[name];
  },
});

const zipStructuredData = async (
  structuredData: unknown,
): Promise<Uint8Array> => {
  const { default: JSZip } = await import("npm:jszip@3.10.1");
  const zip = new JSZip();
  zip.file("structuredData.json", JSON.stringify(structuredData));
  return await zip.generateAsync({ type: "uint8array" });
};

const successfulFetchForDownloadUri = (
  downloadUri: string,
  zipBytes: Uint8Array,
): (input: RequestInfo | URL) => Promise<Response> => {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/token")) {
      return Response.json({ access_token: "token-1" });
    }
    if (url.endsWith("/assets")) {
      return Response.json({
        uploadUri: ADOBE_US_STORAGE_URL,
        assetID: "asset-1",
      });
    }
    if (url === ADOBE_US_STORAGE_URL) {
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/operation/extractpdf")) {
      return new Response(null, {
        status: 201,
        headers: {
          location:
            "https://pdf-services.adobe.io/operation/extractpdf/job-1/status",
        },
      });
    }
    if (url.endsWith("/job-1/status")) {
      return Response.json({ status: "done", downloadUri });
    }
    if (url === downloadUri) {
      return new Response(
        zipBytes.buffer.slice(
          zipBytes.byteOffset,
          zipBytes.byteOffset + zipBytes.byteLength,
        ) as ArrayBuffer,
        { status: 200 },
      );
    }
    return new Response("unexpected", { status: 500 });
  };
};

Deno.test("getAdobePdfExtractCredentials supports Adobe aliases and sample env names", () => {
  expect(
    getAdobePdfExtractCredentials(
      envFrom({
        ADOBE_PDF_SERVICES_CLIENT_ID: " alias-client ",
        ADOBE_PDF_SERVICES_CLIENT_SECRET: " alias-secret ",
        PDF_SERVICES_CLIENT_ID: "sample-client",
        PDF_SERVICES_CLIENT_SECRET: "sample-secret",
      }),
    ),
  ).toEqual({ clientId: "alias-client", clientSecret: "alias-secret" });

  expect(
    getAdobePdfExtractCredentials(
      envFrom({
        PDF_SERVICES_CLIENT_ID: "sample-client",
        PDF_SERVICES_CLIENT_SECRET: "sample-secret",
      }),
    ),
  ).toEqual({ clientId: "sample-client", clientSecret: "sample-secret" });
});

Deno.test("getAdobePdfExtractCredentials fails closed when Adobe credentials are missing", () => {
  expect(() => getAdobePdfExtractCredentials(envFrom({}))).toThrow(
    AdobePdfExtractError,
  );
});

Deno.test("extractPdfWithAdobe reports a sanitized token failure stage", async () => {
  const upstreamBody = "provider-response-must-not-leak";

  try {
    await extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
      env: envFrom({
        PDF_SERVICES_CLIENT_ID: "client-id",
        PDF_SERVICES_CLIENT_SECRET: "client-secret",
      }),
      fetchImpl: () =>
        Promise.resolve(new Response(upstreamBody, { status: 401 })),
    });
    throw new Error("Expected Adobe extraction to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(AdobePdfExtractError);
    const adobeError = error as AdobePdfExtractError & {
      stage?: string;
      upstreamStatus?: number | null;
    };
    expect(adobeError.stage).toBe("token");
    expect(adobeError.upstreamStatus).toBe(401);
    expect(adobeError.message).not.toContain(upstreamBody);
  }
});

Deno.test("extractPdfWithAdobe sanitizes transport failures before logging", async () => {
  const sensitiveTransportDetail =
    "https://storage.example.test/upload?X-Amz-Signature=must-not-leak";

  try {
    await extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
      env: envFrom({
        PDF_SERVICES_CLIENT_ID: "client-id",
        PDF_SERVICES_CLIENT_SECRET: "client-secret",
      }),
      fetchImpl: () => Promise.reject(new Error(sensitiveTransportDetail)),
    });
    throw new Error("Expected Adobe extraction to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(AdobePdfExtractError);
    const adobeError = error as AdobePdfExtractError & {
      stage?: string;
      upstreamStatus?: number | null;
    };
    expect(adobeError.stage).toBe("token");
    expect(adobeError.upstreamStatus).toBeNull();
    expect(adobeError.message).not.toContain(sensitiveTransportDetail);
  }
});

Deno.test("AdobePdfExtractError exposes only allowlisted public diagnostics", () => {
  const sensitiveInternalDetail = "provider-body-must-not-leak";
  const error = new AdobePdfExtractError(
    "adobe_pdf_extract_failed",
    sensitiveInternalDetail,
    502,
    "token",
    401,
  );
  const diagnostics = (error as AdobePdfExtractError & {
    toPublicDiagnostics?: () => Record<string, unknown>;
  }).toPublicDiagnostics?.();

  expect(diagnostics).toEqual({
    stage: "token",
    upstream_status: 401,
  });
  expect(JSON.stringify(diagnostics)).not.toContain(sensitiveInternalDetail);
});

Deno.test("extractPdfWithAdobe sanitizes JSON body read failures", async () => {
  const sensitiveReadDetail = "token-stream-detail-must-not-leak";
  const response = Response.json({ access_token: "unused" });
  Object.defineProperty(response, "text", {
    value: () => Promise.reject(new Error(sensitiveReadDetail)),
  });

  try {
    await extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
      env: envFrom({
        PDF_SERVICES_CLIENT_ID: "client-id",
        PDF_SERVICES_CLIENT_SECRET: "client-secret",
      }),
      fetchImpl: () => Promise.resolve(response),
    });
    throw new Error("Expected Adobe extraction to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(AdobePdfExtractError);
    const adobeError = error as AdobePdfExtractError;
    expect(adobeError.stage).toBe("token");
    expect(adobeError.upstreamStatus).toBe(200);
    expect(adobeError.message).not.toContain(sensitiveReadDetail);
  }
});

Deno.test("extractPdfWithAdobe sanitizes result download body read failures", async () => {
  const sensitiveReadDetail = "download-stream-detail-must-not-leak";
  const downloadUri =
    "https://dcplatformstorageservice-prod-us-east-1.s3-accelerate.amazonaws.com/result.zip?X-Amz-Signature=test";
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/token")) {
      return Response.json({ access_token: "token-1" });
    }
    if (url.endsWith("/assets")) {
      return Response.json({
        uploadUri: ADOBE_US_STORAGE_URL,
        assetID: "asset-1",
      });
    }
    if (url === ADOBE_US_STORAGE_URL) {
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/operation/extractpdf")) {
      return new Response(null, {
        status: 201,
        headers: {
          location:
            "https://pdf-services.adobe.io/operation/extractpdf/job-1/status",
        },
      });
    }
    if (url.endsWith("/job-1/status")) {
      return Response.json({ status: "done", downloadUri });
    }
    if (url === downloadUri) {
      const response = new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
      });
      Object.defineProperty(response, "arrayBuffer", {
        value: () => Promise.reject(new Error(sensitiveReadDetail)),
      });
      return response;
    }
    return new Response("unexpected", { status: 500 });
  };

  try {
    await extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
      env: envFrom({
        PDF_SERVICES_CLIENT_ID: "client-id",
        PDF_SERVICES_CLIENT_SECRET: "client-secret",
      }),
      fetchImpl,
      sleep: () => Promise.resolve(),
      maxPollAttempts: 1,
    });
    throw new Error("Expected Adobe extraction to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(AdobePdfExtractError);
    const adobeError = error as AdobePdfExtractError;
    expect(adobeError.stage).toBe("result_download");
    expect(adobeError.upstreamStatus).toBe(200);
    expect(adobeError.message).not.toContain(sensitiveReadDetail);
  }
});

Deno.test("extractPdfWithAdobe does not label semantic job failures as HTTP failures", async () => {
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/token")) {
      return Response.json({ access_token: "token-1" });
    }
    if (url.endsWith("/assets")) {
      return Response.json({
        uploadUri: ADOBE_US_STORAGE_URL,
        assetID: "asset-1",
      });
    }
    if (url === ADOBE_US_STORAGE_URL) {
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/operation/extractpdf")) {
      return new Response(null, {
        status: 201,
        headers: {
          location:
            "https://pdf-services.adobe.io/operation/extractpdf/job-1/status",
        },
      });
    }
    if (url.endsWith("/job-1/status")) {
      return Response.json({ status: "failed" });
    }
    return new Response("unexpected", { status: 500 });
  };

  try {
    await extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
      env: envFrom({
        PDF_SERVICES_CLIENT_ID: "client-id",
        PDF_SERVICES_CLIENT_SECRET: "client-secret",
      }),
      fetchImpl,
      sleep: () => Promise.resolve(),
      maxPollAttempts: 1,
    });
    throw new Error("Expected Adobe extraction to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(AdobePdfExtractError);
    const adobeError = error as AdobePdfExtractError;
    expect(adobeError.stage).toBe("job_poll");
    expect(adobeError.upstreamStatus).toBeNull();
  }
});

Deno.test("extractPdfWithAdobe sanitizes Adobe semantic poll failures while preserving allowlisted upstream status", async () => {
  const sensitiveCode = "job_failed_validation";
  const sensitiveMessage = "provider detail must not leak";
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/token")) {
      return Response.json({ access_token: "token-1" });
    }
    if (url.endsWith("/assets")) {
      return Response.json({
        uploadUri: ADOBE_US_STORAGE_URL,
        assetID: "asset-1",
      });
    }
    if (url === ADOBE_US_STORAGE_URL) {
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/operation/extractpdf")) {
      return new Response(null, {
        status: 201,
        headers: {
          location:
            "https://pdf-services.adobe.io/operation/extractpdf/job-1/status",
        },
      });
    }
    if (url.endsWith("/job-1/status")) {
      return Response.json({
        status: "failed",
        error: {
          status: 422,
          code: sensitiveCode,
          message: sensitiveMessage,
        },
      });
    }
    return new Response("unexpected", { status: 500 });
  };

  try {
    await extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
      env: envFrom({
        PDF_SERVICES_CLIENT_ID: "client-id",
        PDF_SERVICES_CLIENT_SECRET: "client-secret",
      }),
      fetchImpl,
      sleep: () => Promise.resolve(),
      maxPollAttempts: 1,
    });
    throw new Error("Expected Adobe extraction to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(AdobePdfExtractError);
    const adobeError = error as AdobePdfExtractError;
    expect(adobeError.stage).toBe("job_poll");
    expect(adobeError.upstreamStatus).toBe(422);
    expect(adobeError.message).not.toContain(sensitiveCode);
    expect(adobeError.message).not.toContain(sensitiveMessage);
    expect(JSON.stringify(adobeError.toPublicDiagnostics())).toContain("422");
    expect(JSON.stringify(adobeError.toPublicDiagnostics())).not.toContain(
      sensitiveCode,
    );
    expect(JSON.stringify(adobeError.toPublicDiagnostics())).not.toContain(
      sensitiveMessage,
    );
  }
});

Deno.test("extractPdfWithAdobe preserves inclusive semantic status bounds and rejects malformed values", async () => {
  const cases: Array<{
    name: string;
    error: unknown;
    expectedStatus: number | null;
  }> = [
    { name: "minimum", error: { status: 100 }, expectedStatus: 100 },
    { name: "maximum", error: { status: 599 }, expectedStatus: 599 },
    {
      name: "absent status",
      error: { code: "job_failed_validation" },
      expectedStatus: null,
    },
    { name: "string", error: { status: "422" }, expectedStatus: null },
    { name: "decimal", error: { status: 422.5 }, expectedStatus: null },
    { name: "low", error: { status: 99 }, expectedStatus: null },
    { name: "high", error: { status: 600 }, expectedStatus: null },
    { name: "null error", error: null, expectedStatus: null },
    { name: "primitive error", error: "failed", expectedStatus: null },
    { name: "missing error", error: undefined, expectedStatus: null },
  ];

  for (const testCase of cases) {
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/token")) {
        return Response.json({ access_token: "token-1" });
      }
      if (url.endsWith("/assets")) {
        return Response.json({
          uploadUri: ADOBE_US_STORAGE_URL,
          assetID: "asset-1",
        });
      }
      if (url === ADOBE_US_STORAGE_URL) {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/operation/extractpdf")) {
        return new Response(null, {
          status: 201,
          headers: {
            location:
              "https://pdf-services.adobe.io/operation/extractpdf/job-1/status",
          },
        });
      }
      if (url.endsWith("/job-1/status")) {
        return Response.json({
          status: "failed",
          ...(testCase.error === undefined ? {} : { error: testCase.error }),
        });
      }
      return new Response("unexpected", { status: 500 });
    };

    try {
      await extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
        env: envFrom({
          PDF_SERVICES_CLIENT_ID: "client-id",
          PDF_SERVICES_CLIENT_SECRET: "client-secret",
        }),
        fetchImpl,
        sleep: () => Promise.resolve(),
        maxPollAttempts: 1,
      });
      throw new Error(
        `Expected Adobe extraction to fail for ${testCase.name}.`,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(AdobePdfExtractError);
      const adobeError = error as AdobePdfExtractError;
      expect(adobeError.stage).toBe("job_poll");
      expect(adobeError.upstreamStatus).toBe(testCase.expectedStatus);
    }
  }
});

Deno.test("normalizeAdobeExtractZip sanitizes invalid ZIP failures", async () => {
  try {
    await normalizeAdobeExtractZip(new Uint8Array([1, 2, 3]));
    throw new Error("Expected Adobe ZIP normalization to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(AdobePdfExtractError);
    const adobeError = error as AdobePdfExtractError;
    expect(adobeError.stage).toBe("result_parse");
  }
});

Deno.test("normalizeAdobeStructuredData builds ordered text and counts table elements", () => {
  const normalized = normalizeAdobeStructuredData({
    elements: [
      { Path: "//Document/H1", Text: "Assessment Title" },
      { Path: "//Document/P", Text: "Member Name: Redacted Client" },
      { Path: "//Document/Table/TR/TD", Text: "H2019 Direct therapy" },
      { Path: "//Document/P", Text: "Date ABA first began: 07/01/2025" },
    ],
  });

  expect(normalized.text).toBe(
    "Assessment Title\nMember Name: Redacted Client\nH2019 Direct therapy\nDate ABA first began: 07/01/2025",
  );
  expect(normalized.element_count).toBe(4);
  expect(normalized.table_count).toBe(1);
});

Deno.test("normalizeAdobeExtractZip reads structuredData.json from Adobe result zip", async () => {
  const zipBytes = await zipStructuredData({
    elements: [{
      Path: "//Document/P",
      Text: "Chief Complaint: Needs support",
    }],
  });

  const normalized = await normalizeAdobeExtractZip(zipBytes);

  expect(normalized.text).toBe("Chief Complaint: Needs support");
  expect(normalized.element_count).toBe(1);
});

Deno.test("extractPdfWithAdobe uses PDF Extract REST flow and requests text plus tables", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const zipBytes = await zipStructuredData({
    elements: [
      { Path: "//Document/P", Text: "Member Name: Redacted Client" },
      { Path: "//Document/Table/TR/TD", Text: "H0032-HN Treatment planning" },
    ],
  });
  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/token")) {
      return Response.json({ access_token: "token-1" });
    }
    if (url.endsWith("/assets")) {
      return Response.json({
        uploadUri: ADOBE_US_STORAGE_URL,
        assetID: "asset-1",
      });
    }
    if (url === ADOBE_US_STORAGE_URL) {
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/operation/extractpdf")) {
      return new Response(null, {
        status: 201,
        headers: {
          location:
            "https://pdf-services.adobe.io/operation/extractpdf/job-1/status",
        },
      });
    }
    if (url.endsWith("/job-1/status")) {
      return Response.json({
        status: "done",
        asset: {
          downloadUri:
            "https://dcplatformstorageservice-prod-us-east-1.s3-accelerate.amazonaws.com/result.zip?X-Amz-Signature=test",
        },
      });
    }
    if (
      url ===
        "https://dcplatformstorageservice-prod-us-east-1.s3-accelerate.amazonaws.com/result.zip?X-Amz-Signature=test"
    ) {
      return new Response(
        zipBytes.buffer.slice(
          zipBytes.byteOffset,
          zipBytes.byteOffset + zipBytes.byteLength,
        ) as ArrayBuffer,
        { status: 200 },
      );
    }
    return new Response("unexpected", { status: 500 });
  };

  const extracted = await extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
    env: envFrom({
      PDF_SERVICES_CLIENT_ID: "client-id",
      PDF_SERVICES_CLIENT_SECRET: "client-secret",
    }),
    fetchImpl,
    sleep: () => Promise.resolve(),
    maxPollAttempts: 1,
  });

  const jobCall = calls.find((call) =>
    call.url.endsWith("/operation/extractpdf")
  );
  expect(JSON.parse(String(jobCall?.init?.body))).toEqual({
    assetID: "asset-1",
    elementsToExtract: ["text", "tables"],
  });
  expect(extracted.text).toContain("Member Name: Redacted Client");
  expect(extracted.table_count).toBe(1);
});

Deno.test("extractPdfWithAdobe accepts Adobe Europe storage download hosts", async () => {
  const zipBytes = await zipStructuredData({
    elements: [{ Path: "//Document/P", Text: "Europe region result" }],
  });
  const uploadUri =
    "https://dcplatformstorageservice-prod-eu-west-1.s3.amazonaws.com/upload.pdf?X-Amz-Signature=test";
  const downloadUri =
    "https://dcplatformstorageservice-prod-eu-west-1.s3.amazonaws.com/result.zip?X-Amz-Signature=test";
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/token")) {
      return Response.json({ access_token: "token-1" });
    }
    if (url.endsWith("/assets")) {
      return Response.json({
        uploadUri,
        assetID: "asset-1",
      });
    }
    if (url === uploadUri) {
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/operation/extractpdf")) {
      return new Response(null, {
        status: 201,
        headers: {
          location:
            "https://pdf-services-ew1.adobe.io/operation/extractpdf/job-1/status",
        },
      });
    }
    if (url.endsWith("/job-1/status")) {
      return Response.json({ status: "done", downloadUri });
    }
    if (url === downloadUri) {
      return new Response(
        zipBytes.buffer.slice(
          zipBytes.byteOffset,
          zipBytes.byteOffset + zipBytes.byteLength,
        ) as ArrayBuffer,
        { status: 200 },
      );
    }
    return new Response("unexpected", { status: 500 });
  };

  const extracted = await extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
    env: envFrom({
      PDF_SERVICES_CLIENT_ID: "client-id",
      PDF_SERVICES_CLIENT_SECRET: "client-secret",
    }),
    fetchImpl,
    sleep: () => Promise.resolve(),
    maxPollAttempts: 1,
  });

  expect(extracted.text).toBe("Europe region result");
});

Deno.test("extractPdfWithAdobe accepts top-level Adobe resource download URI", async () => {
  const zipBytes = await zipStructuredData({
    elements: [{ Path: "//Document/P", Text: "Top-level resource result" }],
  });
  const downloadUri =
    "https://dcplatformstorageservice-prod-us-east-1.s3-accelerate.amazonaws.com/result.zip?X-Amz-Signature=test";
  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/token")) {
      return Response.json({ access_token: "token-1" });
    }
    if (url.endsWith("/assets")) {
      return Response.json({
        uploadUri: ADOBE_US_STORAGE_URL,
        assetID: "asset-1",
      });
    }
    if (url === ADOBE_US_STORAGE_URL) {
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/operation/extractpdf")) {
      return new Response(null, {
        status: 201,
        headers: {
          location:
            "https://pdf-services-ue1.adobe.io/operation/extractpdf/job-1/status",
        },
      });
    }
    if (url.endsWith("/job-1/status")) {
      return Response.json({
        status: "done",
        resource: {
          metadata: { type: "application/zip", size: zipBytes.byteLength },
          downloadUri,
          assetID: "urn:aaid:AS:UE1:result-asset",
        },
      });
    }
    if (url === downloadUri) {
      return new Response(
        zipBytes.buffer.slice(
          zipBytes.byteOffset,
          zipBytes.byteOffset + zipBytes.byteLength,
        ) as ArrayBuffer,
        { status: 200 },
      );
    }
    return new Response(`unexpected ${init?.method ?? "GET"} ${url}`, {
      status: 500,
    });
  };

  const extracted = await extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
    env: envFrom({
      PDF_SERVICES_CLIENT_ID: "client-id",
      PDF_SERVICES_CLIENT_SECRET: "client-secret",
    }),
    fetchImpl,
    sleep: () => Promise.resolve(),
    maxPollAttempts: 1,
  });

  expect(extracted.text).toBe("Top-level resource result");
});

Deno.test("extractPdfWithAdobe accepts Adobe service result download hosts", async () => {
  const zipBytes = await zipStructuredData({
    elements: [{ Path: "//Document/P", Text: "Adobe service result" }],
  });
  const downloadUri =
    "https://pdf-services.adobe.io/operation/extractpdf/job-1/result";

  const extracted = await extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
    env: envFrom({
      PDF_SERVICES_CLIENT_ID: "client-id",
      PDF_SERVICES_CLIENT_SECRET: "client-secret",
    }),
    fetchImpl: successfulFetchForDownloadUri(downloadUri, zipBytes),
    sleep: () => Promise.resolve(),
    maxPollAttempts: 1,
  });

  expect(extracted.text).toBe("Adobe service result");
});

Deno.test("extractPdfWithAdobe rejects unexpected Adobe upload hosts", async () => {
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/token")) {
      return Response.json({ access_token: "token-1" });
    }
    if (url.endsWith("/assets")) {
      return Response.json({
        uploadUri: "https://attacker.example.test/upload.pdf",
        assetID: "asset-1",
      });
    }
    return new Response("unexpected", { status: 500 });
  };

  await expect(
    extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
      env: envFrom({
        PDF_SERVICES_CLIENT_ID: "client-id",
        PDF_SERVICES_CLIENT_SECRET: "client-secret",
      }),
      fetchImpl,
      sleep: () => Promise.resolve(),
    }),
  ).rejects.toThrow(AdobePdfExtractError);
});

Deno.test("extractPdfWithAdobe rejects unexpected Adobe polling hosts", async () => {
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/token")) {
      return Response.json({ access_token: "token-1" });
    }
    if (url.endsWith("/assets")) {
      return Response.json({
        uploadUri: ADOBE_US_STORAGE_URL,
        assetID: "asset-1",
      });
    }
    if (url === ADOBE_US_STORAGE_URL) {
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/operation/extractpdf")) {
      return new Response(null, {
        status: 201,
        headers: { location: "https://attacker.example.test/status" },
      });
    }
    return new Response("unexpected", { status: 500 });
  };

  await expect(
    extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
      env: envFrom({
        PDF_SERVICES_CLIENT_ID: "client-id",
        PDF_SERVICES_CLIENT_SECRET: "client-secret",
      }),
      fetchImpl,
      sleep: () => Promise.resolve(),
    }),
  ).rejects.toThrow(AdobePdfExtractError);
});

Deno.test("extractPdfWithAdobe rejects unexpected Adobe download hosts", async () => {
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/token")) {
      return Response.json({ access_token: "token-1" });
    }
    if (url.endsWith("/assets")) {
      return Response.json({
        uploadUri: ADOBE_US_STORAGE_URL,
        assetID: "asset-1",
      });
    }
    if (url === ADOBE_US_STORAGE_URL) {
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/operation/extractpdf")) {
      return new Response(null, {
        status: 201,
        headers: {
          location:
            "https://pdf-services.adobe.io/operation/extractpdf/job-1/status",
        },
      });
    }
    if (url.endsWith("/job-1/status")) {
      return Response.json({
        status: "done",
        downloadUri: "https://attacker.example.test/result.zip",
      });
    }
    return new Response("unexpected", { status: 500 });
  };

  await expect(
    extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
      env: envFrom({
        PDF_SERVICES_CLIENT_ID: "client-id",
        PDF_SERVICES_CLIENT_SECRET: "client-secret",
      }),
      fetchImpl,
      sleep: () => Promise.resolve(),
      maxPollAttempts: 1,
    }),
  ).rejects.toThrow(AdobePdfExtractError);
});

Deno.test("extractPdfWithAdobe rejects non-HTTPS Adobe download URLs", async () => {
  const zipBytes = await zipStructuredData({
    elements: [{ Path: "//Document/P", Text: "Should not download" }],
  });
  const downloadUri =
    "http://dcplatformstorageservice-prod-us-east-1.s3-accelerate.amazonaws.com/result.zip";

  await expect(
    extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
      env: envFrom({
        PDF_SERVICES_CLIENT_ID: "client-id",
        PDF_SERVICES_CLIENT_SECRET: "client-secret",
      }),
      fetchImpl: successfulFetchForDownloadUri(downloadUri, zipBytes),
      sleep: () => Promise.resolve(),
      maxPollAttempts: 1,
    }),
  ).rejects.toThrow(AdobePdfExtractError);
});

Deno.test("extractPdfWithAdobe rejects Adobe download URLs with embedded credentials", async () => {
  const zipBytes = await zipStructuredData({
    elements: [{ Path: "//Document/P", Text: "Should not download" }],
  });
  const downloadUri =
    "https://user:pass@dcplatformstorageservice-prod-us-east-1.s3-accelerate.amazonaws.com/result.zip";

  await expect(
    extractPdfWithAdobe(new Uint8Array([1, 2, 3]), {
      env: envFrom({
        PDF_SERVICES_CLIENT_ID: "client-id",
        PDF_SERVICES_CLIENT_SECRET: "client-secret",
      }),
      fetchImpl: successfulFetchForDownloadUri(downloadUri, zipBytes),
      sleep: () => Promise.resolve(),
      maxPollAttempts: 1,
    }),
  ).rejects.toThrow(AdobePdfExtractError);
});
