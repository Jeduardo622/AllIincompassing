import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  assertBrowserOnlyTarget,
  assertRedactedQaFixture,
  assertSupportedClinicalQaSourceTextFixture,
  buildClinicalQaRoute,
  buildClinicalQaGeneratedOutputArtifactPath,
  buildClinicalQaReportMarkdown,
  buildClinicalQaTextEvidenceSections,
  captureClinicalQaGeneratedOutputArtifact,
  deriveClinicalQaExpectationsFromSourceText,
  evaluateClinicalQaChecklist,
  evaluateClinicalDataParity,
  parseClinicalQaGeneratedOutputResponse,
  parseClinicalQaExpectations,
  readClinicalQaOutputFixtureText,
  readClinicalQaSourceFixtureText,
  requireClinicalQaClientId,
  selectClinicalQaCredentials,
} from "../../scripts/lib/clinical-data-parity-agent";
import { routeMatchesPathname } from "../../scripts/lib/playwright-smoke";

const crc32Table = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const buildZip = (files: Record<string, string>): Buffer => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const contentBuffer = Buffer.from(content);
    const compressed = deflateRawSync(contentBuffer);
    const checksum = crc32(contentBuffer);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(contentBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(localHeader, nameBuffer, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(contentBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
};

const buildRedactedDocxFixture = (text: string): Buffer =>
  buildZip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />',
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  });

const buildRedactedPdfFixture = (text: string): Buffer => {
  const escapedText = text.replace(/[()\\]/g, (match) => `\\${match}`);
  return Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length ${escapedText.length + 34} >>
stream
BT /F1 12 Tf 72 720 Td (${escapedText}) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000241 00000 n
0000000311 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
456
%%EOF
`);
};

describe("clinical data parity agent helpers", () => {
  it("selects dedicated clinical QA credentials before admin fallback", () => {
    const credentials = selectClinicalQaCredentials([
      {
        email: " qa@example.com ",
        password: "qa-password",
        label: "clinical",
      },
      {
        email: "admin@example.com",
        password: "admin-password",
        label: "admin",
      },
    ]);

    expect(credentials).toEqual({
      email: "qa@example.com",
      password: "qa-password",
      label: "clinical",
    });
  });

  it("rejects missing and placeholder credentials", () => {
    expect(() => selectClinicalQaCredentials([{ label: "clinical" }])).toThrow(
      "Missing clinical QA browser credentials",
    );
    expect(() =>
      selectClinicalQaCredentials([
        {
          email: "qa@example.com",
          password: "****",
          label: "clinical",
        },
      ]),
    ).toThrow('cannot use placeholder password "****"');
  });

  it("keeps the browser target constrained to app routes", () => {
    expect(assertBrowserOnlyTarget("/clients/client-1?tab=programs-goals")).toBe(
      "/clients/client-1?tab=programs-goals",
    );
    expect(() => assertBrowserOnlyTarget("clients/client-1")).toThrow("starts with '/'");
    expect(() => assertBrowserOnlyTarget("/api/assessment-documents")).toThrow("not an API route");
    expect(() => assertBrowserOnlyTarget("/admin/users")).toThrow("must not target admin-only routes");
  });

  it("builds the default client programs/goals route when a smoke client is configured", () => {
    expect(buildClinicalQaRoute({ clientId: "client id" })).toBe(
      "/clients/client%20id?tab=programs-goals",
    );
    expect(buildClinicalQaRoute({ routePath: "/dashboard", clientId: "client id" })).toBe("/dashboard");
    expect(buildClinicalQaRoute({})).toBe("/");
  });

  it("matches route reachability by pathname when the expected route includes a query string", () => {
    expect(routeMatchesPathname("/clients/client%20id", "/clients/client%20id?tab=programs-goals")).toBe(true);
  });

  it("requires redacted or synthetic fixture names for document comparisons", () => {
    expect(assertRedactedQaFixture(undefined, "fixture")).toBeNull();
    expect(assertRedactedQaFixture("fixtures/redacted-iehp-fba.docx", "fixture")).toBe(
      "fixtures/redacted-iehp-fba.docx",
    );
    expect(() => assertRedactedQaFixture("fixtures/real-client-iehp-fba.docx", "fixture")).toThrow(
      "clearly redacted",
    );
  });

  it("allows redacted text, DOCX, and PDF fixtures for source-derived expectations", () => {
    expect(assertSupportedClinicalQaSourceTextFixture("fixtures/redacted-iehp-source.txt")).toBe(
      "fixtures/redacted-iehp-source.txt",
    );
    expect(assertSupportedClinicalQaSourceTextFixture("fixtures/synthetic-iehp-source.md")).toBe(
      "fixtures/synthetic-iehp-source.md",
    );
    expect(assertSupportedClinicalQaSourceTextFixture("fixtures/redacted-iehp-source.docx")).toBe(
      "fixtures/redacted-iehp-source.docx",
    );
    expect(assertSupportedClinicalQaSourceTextFixture("fixtures/redacted-iehp-source.pdf")).toBe(
      "fixtures/redacted-iehp-source.pdf",
    );
    expect(() => assertSupportedClinicalQaSourceTextFixture("fixtures/redacted-iehp-source.png")).toThrow(
      "supports .txt, .md, .docx, or .pdf fixtures",
    );
  });

  it("normalizes optional client IDs", () => {
    expect(requireClinicalQaClientId(undefined)).toBeNull();
    expect(requireClinicalQaClientId("  client-1  ")).toBe("client-1");
  });

  it("evaluates required visible data surfaces from page text", () => {
    const results = evaluateClinicalQaChecklist(
      "Client assessment page with FBA upload and program goal review",
    );

    expect(results.every((result) => result.status === "pass")).toBe(true);
    expect(evaluateClinicalQaChecklist("Dashboard only").filter((result) => result.status === "fail")).toHaveLength(3);
  });

  it("parses redacted parity expectations and flags missing clinically important terms", () => {
    const expectations = parseClinicalQaExpectations(
      JSON.stringify({
        expectations: [
          {
            key: "target_behaviors",
            label: "Target behaviors",
            sourceSection: "Behavioral Observations",
            expectedTerms: ["elopement", "property destruction"],
            observedSectionTerms: ["Programs and Goals"],
            severity: "high",
            humanReviewBlocker: true,
          },
          {
            key: "replacement_behavior",
            label: "Replacement behavior",
            expectedTerms: ["functional communication"],
          },
        ],
      }),
      "fixtures/redacted-iehp-expectations.json",
    );

    const findings = evaluateClinicalDataParity(
      "Programs and goals include elopement and functional communication. Logged in as qa@example.com.",
      expectations,
    );

    expect(findings).toEqual([
      {
        key: "target_behaviors",
        label: "Target behaviors",
        status: "fail",
        mismatchType: "partial",
        sourceSection: "Behavioral Observations",
        severity: "high",
        expectedTerms: ["elopement", "property destruction"],
        matchedTerms: ["elopement"],
        missingTerms: ["property destruction"],
        observedSectionTerms: ["Programs and Goals"],
        observedSectionMatchedTerms: ["Programs and Goals"],
        observedSectionMissingTerms: [],
        observedTextSnippet:
          "Programs and goals include elopement and functional communication. Logged in as [redacted-email].",
        humanReviewBlocker: true,
      },
      {
        key: "replacement_behavior",
        label: "Replacement behavior",
        status: "pass",
        mismatchType: "match",
        sourceSection: null,
        severity: "medium",
        expectedTerms: ["functional communication"],
        matchedTerms: ["functional communication"],
        missingTerms: [],
        observedSectionTerms: [],
        observedSectionMatchedTerms: [],
        observedSectionMissingTerms: [],
        observedTextSnippet:
          "Programs and goals include elopement and functional communication. Logged in as [redacted-email].",
        humanReviewBlocker: false,
      },
    ]);
  });

  it("distinguishes page-level matches from expected section evidence", () => {
    const expectations = parseClinicalQaExpectations(
      JSON.stringify({
        expectations: [
          {
            key: "target_behaviors",
            label: "Target behaviors",
            sourceSection: "FBA target behavior summary",
            expectedTerms: ["elopement", "property destruction"],
            observedSectionTerms: ["Programs", "Goals"],
            severity: "high",
            humanReviewBlocker: true,
          },
        ],
      }),
      "fixtures/redacted-iehp-expectations.json",
    );

    const findings = evaluateClinicalDataParity(
      "Assessment summary mentions elopement and property destruction. Programs and Goals only mention replacement skills.",
      expectations,
      [
        {
          label: "Assessment",
          text: "Assessment summary mentions elopement and property destruction.",
        },
        {
          label: "Programs and Goals",
          text: "Programs and Goals only mention replacement skills.",
        },
      ],
    );

    expect(findings[0]).toMatchObject({
      status: "pass",
      mismatchType: "match",
      matchedTerms: ["elopement", "property destruction"],
      sectionEvidenceStatus: "missing",
      sectionEvidence: [
        {
          sectionLabel: "Programs and Goals",
          matchedTerms: [],
          missingTerms: ["elopement", "property destruction"],
        },
      ],
    });
  });

  it("evaluates generated output parity against output section evidence", () => {
    const expectations = parseClinicalQaExpectations(
      JSON.stringify({
        expectations: [
          {
            key: "target_behaviors",
            label: "Target behaviors",
            sourceSection: "FBA target behavior summary",
            expectedTerms: ["elopement", "property destruction"],
            observedSectionTerms: ["Target behaviors"],
            severity: "high",
            humanReviewBlocker: true,
          },
        ],
      }),
      "fixtures/redacted-iehp-expectations.json",
    );
    const outputText = `
      Target behaviors
      Elopement is included in the generated plan.

      Intervention plan
      Property destruction appears only in the intervention discussion.
    `;
    const outputSections = buildClinicalQaTextEvidenceSections(outputText);

    expect(outputSections).toEqual([
      {
        label: "Target behaviors",
        text: "Elopement is included in the generated plan.",
      },
      {
        label: "Intervention plan",
        text: "Property destruction appears only in the intervention discussion.",
      },
    ]);

    const findings = evaluateClinicalDataParity(outputText, expectations, outputSections);

    expect(findings[0]).toMatchObject({
      status: "pass",
      mismatchType: "match",
      matchedTerms: ["elopement", "property destruction"],
      sectionEvidenceStatus: "partial",
      sectionEvidence: [
        {
          sectionLabel: "Target behaviors",
          matchedTerms: ["elopement"],
          missingTerms: ["property destruction"],
        },
      ],
    });
  });

  it("derives parity expectations from redacted source text sections", () => {
    const expectations = deriveClinicalQaExpectationsFromSourceText(`
      FBA target behavior summary
      Target behaviors: elopement; property destruction

      Replacement behavior plan
      Replacement behavior: functional communication

      Goals and measurement criteria
      Measurement terms: baseline, mastery, maintenance, generalization

      ABC and function summary
      Antecedents: transition demand; denied access
      Consequences: adult attention; escape from task
      Functions: escape; access to attention

      Intervention plan
      Interventions: visual schedule; first then board

      Authorization and client metadata
      Client identifiers: test client 01; redacted medicaid id
      Authorization details: 97153; 12 units weekly
    `);

    expect(expectations).toEqual([
      {
        key: "target_behaviors",
        label: "Target behaviors",
        sourceSection: "FBA target behavior summary",
        expectedTerms: ["elopement", "property destruction"],
        observedSectionTerms: ["Programs", "Goals"],
        severity: "high",
        humanReviewBlocker: true,
      },
      {
        key: "replacement_behavior",
        label: "Replacement behavior",
        sourceSection: "Replacement behavior plan",
        expectedTerms: ["functional communication"],
        observedSectionTerms: ["Programs", "Goals"],
        severity: "medium",
        humanReviewBlocker: false,
      },
      {
        key: "program_goal_measurement",
        label: "Program goal measurement",
        sourceSection: "Goals and measurement criteria",
        expectedTerms: ["baseline", "mastery", "maintenance", "generalization"],
        observedSectionTerms: ["Programs", "Goals"],
        severity: "medium",
        humanReviewBlocker: false,
      },
      {
        key: "antecedents",
        label: "Antecedents",
        sourceSection: "ABC and function summary",
        expectedTerms: ["transition demand", "denied access"],
        observedSectionTerms: ["Assessment", "Programs", "Goals"],
        severity: "high",
        humanReviewBlocker: true,
      },
      {
        key: "consequences",
        label: "Consequences",
        sourceSection: "ABC and function summary",
        expectedTerms: ["adult attention", "escape from task"],
        observedSectionTerms: ["Assessment", "Programs", "Goals"],
        severity: "high",
        humanReviewBlocker: true,
      },
      {
        key: "functions",
        label: "Behavior functions",
        sourceSection: "ABC and function summary",
        expectedTerms: ["escape", "access to attention"],
        observedSectionTerms: ["Assessment", "Programs", "Goals"],
        severity: "high",
        humanReviewBlocker: true,
      },
      {
        key: "interventions",
        label: "Interventions",
        sourceSection: "Intervention plan",
        expectedTerms: ["visual schedule", "first then board"],
        observedSectionTerms: ["Programs", "Goals"],
        severity: "medium",
        humanReviewBlocker: false,
      },
      {
        key: "client_metadata",
        label: "Client metadata",
        sourceSection: "Authorization and client metadata",
        expectedTerms: ["test client 01", "redacted medicaid id"],
        observedSectionTerms: ["Client", "Assessment"],
        severity: "medium",
        humanReviewBlocker: false,
      },
      {
        key: "authorization_metadata",
        label: "Authorization metadata",
        sourceSection: "Authorization and client metadata",
        expectedTerms: ["97153", "12 units weekly"],
        observedSectionTerms: ["Authorization", "Client"],
        severity: "medium",
        humanReviewBlocker: false,
      },
    ]);
  });

  it("extracts source text from redacted DOCX and PDF fixtures before deriving expectations", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "clinical-qa-redacted-"));
    const sourceLine = "Target behaviors: elopement; property destruction";
    const docxPath = path.join(tempDir, "redacted-iehp-source.docx");
    const pdfPath = path.join(tempDir, "redacted-iehp-source.pdf");

    try {
      await writeFile(docxPath, buildRedactedDocxFixture(sourceLine));
      await writeFile(pdfPath, buildRedactedPdfFixture(sourceLine));

      await expect(readClinicalQaSourceFixtureText(docxPath)).resolves.toContain(sourceLine);
      await expect(readClinicalQaSourceFixtureText(pdfPath)).resolves.toContain(sourceLine);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("extracts output text from redacted text, DOCX, and PDF fixtures before comparing expectations", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "clinical-qa-redacted-output-"));
    const outputLine = "Replacement behavior: functional communication";
    const textPath = path.join(tempDir, "redacted-iehp-output.txt");
    const docxPath = path.join(tempDir, "redacted-iehp-output.docx");
    const pdfPath = path.join(tempDir, "redacted-iehp-output.pdf");

    try {
      await writeFile(textPath, outputLine);
      await writeFile(docxPath, buildRedactedDocxFixture(outputLine));
      await writeFile(pdfPath, buildRedactedPdfFixture(outputLine));

      await expect(readClinicalQaOutputFixtureText(textPath)).resolves.toContain(outputLine);
      await expect(readClinicalQaOutputFixtureText(docxPath)).resolves.toContain(outputLine);
      await expect(readClinicalQaOutputFixtureText(pdfPath)).resolves.toContain(outputLine);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("parses generated output metadata and saves artifacts under redacted names", () => {
    const metadata = parseClinicalQaGeneratedOutputResponse({
      generated_file_type: "docx",
      signed_url: "https://example.test/generated-iehp-fba.docx?token=redacted",
      filename: "generated-iehp-fba.docx",
    });

    expect(metadata).toEqual({
      generatedFileType: "docx",
      signedUrl: "https://example.test/generated-iehp-fba.docx?token=redacted",
      filename: "generated-iehp-fba.docx",
    });
    expect(
      buildClinicalQaGeneratedOutputArtifactPath("artifacts/latest", 1234, metadata),
    ).toBe(path.join("artifacts/latest", "redacted-clinical-qa-generated-output-1234.docx"));
    expect(() => parseClinicalQaGeneratedOutputResponse({ signed_url: "https://example.test/file.exe" })).toThrow(
      "generated_file_type",
    );
    expect(() =>
      parseClinicalQaGeneratedOutputResponse({ generated_file_type: "pdf", signed_url: "" }),
    ).toThrow("signed_url");
  });

  it("captures generated output artifacts through the browser response path", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "clinical-qa-redacted-generated-"));
    const events: string[] = [];
    const artifactBody = Buffer.from("Generated output includes functional communication.");
    const response = {
      url: () => "https://app.example.test/api/assessment-plan-pdf",
      request: () => ({ method: () => "POST" }),
      json: async () => ({
        generated_file_type: "pdf",
        signed_url: "https://storage.example.test/generated.pdf?token=secret",
        filename: "generated-iehp-fba.pdf",
      }),
      ok: () => true,
    };
    let closedPopup = false;

    const page = {
      waitForResponse: async (predicate: (candidate: typeof response) => boolean) => {
        events.push("waitForResponse");
        expect(predicate(response)).toBe(true);
        return response;
      },
      waitForEvent: async (eventName: string, options: { timeout: number }) => {
        events.push(`waitForEvent:${eventName}:${options.timeout}`);
        return {
          close: async () => {
            closedPopup = true;
          },
        };
      },
      locator: (selector: string) => {
        expect(selector).toBe("[data-testid='generate-final-output']");
        return {
          click: async (options: { timeout: number }) => {
            events.push(`click:${options.timeout}`);
          },
        };
      },
      context: () => ({
        request: {
          get: async (url: string) => {
            events.push("download");
            expect(url).toBe("https://storage.example.test/generated.pdf?token=secret");
            return {
              ok: () => true,
              status: () => 200,
              body: async () => artifactBody,
            };
          },
        },
      }),
    };

    try {
      const captured = await captureClinicalQaGeneratedOutputArtifact({
        page,
        selector: "[data-testid='generate-final-output']",
        latestDir: tempDir,
        runId: 42,
        readOutputText: async (artifactPath) => `extracted text from ${path.basename(artifactPath)}`,
      });

      expect(events).toEqual([
        "waitForResponse",
        "waitForEvent:popup:5000",
        "click:10000",
        "download",
      ]);
      expect(closedPopup).toBe(true);
      expect(captured).toEqual({
        artifactPath: path.join(tempDir, "redacted-clinical-qa-generated-output-42.pdf"),
        generatedFileType: "pdf",
        filename: "generated-iehp-fba.pdf",
        text: "extracted text from redacted-clinical-qa-generated-output-42.pdf",
      });
      await expect(readFile(captured.artifactPath)).resolves.toEqual(artifactBody);
      expect(JSON.stringify(captured)).not.toContain("token=secret");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("builds a durable markdown report without leaking browser-visible emails", () => {
    const markdown = buildClinicalQaReportMarkdown({
      generatedAt: "2026-06-15T17:30:00.000Z",
      baseUrl: "https://app.example.test",
      routePath: "/clients/test-client?tab=programs-goals",
      credentialLabel: "PW_CLINICAL_QA_EMAIL + PW_CLINICAL_QA_PASSWORD",
      screenshotPath: "artifacts/latest/clinical-data-parity-agent-test.png",
      checklist: [
        {
          key: "program_goal_surface",
          label: "Programs/goals review surface is visible",
          status: "pass",
          missingTerms: [],
        },
      ],
      dataParityFindings: [
        {
          key: "target_behaviors",
          label: "Target behaviors",
          sourceSection: "Behavioral Observations",
          expectedTerms: ["elopement", "property destruction"],
          observedSectionTerms: ["Programs and Goals"],
          severity: "high",
          humanReviewBlocker: true,
          status: "fail",
          mismatchType: "partial",
          matchedTerms: ["elopement"],
          missingTerms: ["property destruction"],
          observedSectionMatchedTerms: ["Programs and Goals"],
          observedSectionMissingTerms: [],
          observedTextSnippet: "Observed by qa@example.com near Programs and Goals.",
        },
      ],
      outputDataParityFindings: [
        {
          key: "replacement_behavior",
          label: "Replacement behavior",
          sourceSection: "Replacement behavior plan",
          expectedTerms: ["functional communication"],
          observedSectionTerms: [],
          severity: "medium",
          humanReviewBlocker: false,
          status: "pass",
          mismatchType: "match",
          matchedTerms: ["functional communication"],
          missingTerms: [],
          observedSectionMatchedTerms: [],
          observedSectionMissingTerms: [],
          observedTextSnippet: "Generated report includes functional communication.",
        },
      ],
      outputFindingsHeading: "Generated Output Parity Findings",
      disclaimer: "QA evidence only. This is not BCBA approval or clinical sign-off.",
    });

    expect(markdown).toContain("# Clinical Data Parity Agent Report");
    expect(markdown).toContain("target route: `/clients/test-client?tab=programs-goals`");
    expect(markdown).toContain("screenshot: `artifacts/latest/clinical-data-parity-agent-test.png`");
    expect(markdown).toContain("Target behaviors");
    expect(markdown).toContain("missing: property destruction");
    expect(markdown).toContain("## Generated Output Parity Findings");
    expect(markdown).toContain("Generated report includes functional communication.");
    expect(markdown).toContain("human review blocker: yes");
    expect(markdown).toContain("[redacted-email]");
    expect(markdown).not.toContain("qa@example.com");
  });
});
