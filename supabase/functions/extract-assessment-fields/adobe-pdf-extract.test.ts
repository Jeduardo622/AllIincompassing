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
): ((input: RequestInfo | URL) => Promise<Response>) => {
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
