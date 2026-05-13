import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCalOptimaChecklistTemplateRows } from "../assessmentChecklistTemplate";
import { buildCalOptimaTemplatePayload, loadCalOptimaPdfRenderMap } from "../assessmentPlanPdf";

const registryPath = resolve(process.cwd(), "docs", "fill_docs", "caloptima_fba_template_field_map.json");
const checklistPath = resolve(process.cwd(), "docs", "fill_docs", "caloptima_fba_field_extraction_checklist.json");
const renderMapPath = resolve(process.cwd(), "docs", "fill_docs", "caloptima_fba_pdf_render_map.json");
const extractorPath = resolve(process.cwd(), "supabase", "functions", "extract-assessment-fields", "index.ts");

const readJsonFile = async (path: string): Promise<Record<string, unknown>> => {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
};

const asRecordArray = (value: unknown): Record<string, unknown>[] => {
  return Array.isArray(value) ? value.map(asRecord) : [];
};

const asStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
};

const placeholderKeys = (entries: Record<string, unknown>[]): string[] => {
  return entries.map((entry) => entry.placeholder_key).filter((key): key is string => typeof key === "string");
};

describe("CalOptima PDF render map", () => {
  it("contains entries for every checklist placeholder key", async () => {
    const [checklistRows, renderMap] = await Promise.all([
      loadCalOptimaChecklistTemplateRows(),
      loadCalOptimaPdfRenderMap(),
    ]);

    const checklistKeys = new Set(checklistRows.map((row) => row.placeholder_key));
    const renderMapKeys = new Set(renderMap.map((entry) => entry.placeholder_key));

    const missingKeys = Array.from(checklistKeys).filter((key) => !renderMapKeys.has(key));
    expect(missingKeys).toEqual([]);
  });

  it("bounds every exported PDF overlay fallback so rendered text cannot cross template fields", async () => {
    const renderMap = await loadCalOptimaPdfRenderMap();

    renderMap.forEach((entry) => {
      expect(entry.fallback.page).toBeGreaterThanOrEqual(1);
      expect(entry.fallback.page).toBeLessThanOrEqual(28);
      expect(entry.fallback.x).toBeGreaterThanOrEqual(0);
      expect(entry.fallback.y).toBeGreaterThanOrEqual(0);
      expect(entry.fallback.max_width).toBeGreaterThan(0);
      expect(entry.fallback.height).toBeGreaterThan(0);
      expect(entry.fallback.line_height).toBeGreaterThan(0);
      expect(entry.fallback.max_lines).toBeGreaterThan(0);
      expect(entry.fallback.field_kind).toEqual(expect.any(String));
    });
  });

  it("keeps registry, checklist, and render placeholder keys in parity", async () => {
    const [registry, checklist, renderMap] = await Promise.all([
      readJsonFile(registryPath),
      readJsonFile(checklistPath),
      readJsonFile(renderMapPath),
    ]);

    const registryLabels = asRecordArray(asRecord(registry.FBA).labels);
    const checklistRows = asRecordArray(checklist.rows);
    const renderEntries = asRecordArray(renderMap.entries);

    expect(placeholderKeys(checklistRows).sort()).toEqual(placeholderKeys(registryLabels).sort());
    expect(placeholderKeys(renderEntries).sort()).toEqual(placeholderKeys(registryLabels).sort());
  });

  it("defines implementation metadata for every registry field", async () => {
    const registry = await readJsonFile(registryPath);
    const registryLabels = asRecordArray(asRecord(registry.FBA).labels);

    registryLabels.forEach((label) => {
      const pdfRender = asRecord(label.pdf_render);

      expect(label.placeholder_key).toEqual(expect.stringMatching(/^CALOPTIMA_FBA_/));
      expect(label.input_type).toEqual(expect.any(String));
      expect(label.destination).toEqual(expect.any(String));
      expect(pdfRender.target).toEqual("caloptima_fba_pdf_render_map");
      expect(typeof pdfRender.not_exported).toBe("boolean");
      expect(label.review_behavior).toEqual(expect.any(String));
    });
  });

  it("keeps CalOptima extraction metadata deterministic and alias-backed for redacted report headings", async () => {
    const [registry, checklist] = await Promise.all([readJsonFile(registryPath), readJsonFile(checklistPath)]);
    const registryLabels = asRecordArray(asRecord(registry.FBA).labels);
    const checklistRows = asRecordArray(checklist.rows);
    const rowsByKey = new Map(checklistRows.map((row) => [row.placeholder_key, row]));
    const aliasRequiredKeys = [
      "CALOPTIMA_FBA_ADMIN_CONTACT_NAME_TITLE",
      "CALOPTIMA_FBA_CHIEF_COMPLAINT",
      "CALOPTIMA_FBA_RECORDS_REVIEWED",
      "CALOPTIMA_FBA_HAS_IEP",
      "CALOPTIMA_FBA_IEP_DATE",
      "CALOPTIMA_FBA_COORDINATION_OF_CARE",
      "CALOPTIMA_FBA_VINELAND_DOMAIN_SCORES",
      "CALOPTIMA_FBA_TARGET_BEHAVIOR_BLOCKS",
      "CALOPTIMA_FBA_BIP_BLOCKS",
      "CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS",
      "CALOPTIMA_FBA_PARENT_INVOLVEMENT",
      "CALOPTIMA_FBA_SIGNATURES",
    ];

    checklistRows.forEach((row) => {
      expect(JSON.stringify(row).toLowerCase()).not.toContain("openai");
      expect(String(row.extraction_method).toLowerCase()).not.toContain("ai");
    });

    aliasRequiredKeys.forEach((key) => {
      const registryLabel = asRecord(registryLabels.find((label) => label.placeholder_key === key));
      const checklistRow = asRecord(rowsByKey.get(key));

      expect(asStringArray(registryLabel.extraction_aliases).length).toBeGreaterThan(0);
      expect(asStringArray(checklistRow.extraction_aliases).length).toBeGreaterThan(0);
    });
  });

  it("keeps deterministic structured extraction metadata aligned with runtime structured outputs", async () => {
    const checklist = await readJsonFile(checklistPath);
    const rowsByKey = new Map(asRecordArray(checklist.rows).map((row) => [row.placeholder_key, row]));
    const deterministicStructuredKeys = [
      "CALOPTIMA_FBA_COORDINATION_OF_CARE",
      "CALOPTIMA_FBA_VINELAND_DOMAIN_SCORES",
      "CALOPTIMA_FBA_TARGET_BEHAVIOR_BLOCKS",
      "CALOPTIMA_FBA_BIP_BLOCKS",
      "CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS",
      "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
      "CALOPTIMA_FBA_PARENT_GOALS",
      "CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS",
      "CALOPTIMA_FBA_SIGNATURES",
    ];

    deterministicStructuredKeys.forEach((key) => {
      expect(asRecord(rowsByKey.get(key)).extraction_method).toBe("deterministic_structured_extraction_plus_review");
    });
  });

  it("guards CalOptima parser section boundaries for redacted-template headings", async () => {
    const extractorSource = await readFile(extractorPath, "utf8");

    expect(extractorSource).not.toContain("isTargetBehaviorBlock");
    expect(extractorSource).not.toContain('field_key: "CALOPTIMA_FBA_TRANSITION_PLAN"');
    expect(extractorSource).toContain('/XII\\.\\s+/i');
    expect(extractorSource).toContain('/\\*\\*\\s+By\\s+signing/i');
    expect(extractorSource).toContain('"CALOPTIMA_FBA_HCPCS_RECOMMENDATION_ROWS"');
    expect(extractorSource).not.toContain("CALOPTIMA_FBA_HCPCS_RECOMMENDATIONS");
    expect(extractorSource).not.toContain("CALOPTIMA_FBA_DAILY_SCHEDULES");
  });

  it("represents structured section keys consistently across registry, checklist, and render map", async () => {
    const [registry, checklist, renderMap] = await Promise.all([
      readJsonFile(registryPath),
      readJsonFile(checklistPath),
      readJsonFile(renderMapPath),
    ]);

    const registryLabels = asRecordArray(asRecord(registry.FBA).labels);
    const checklistRowsByKey = new Map(asRecordArray(checklist.rows).map((row) => [row.placeholder_key, row]));
    const renderEntriesByKey = new Map(asRecordArray(renderMap.entries).map((entry) => [entry.placeholder_key, entry]));
    const structuredLabels = registryLabels.filter((label) => typeof label.structured_section === "string");

    expect(structuredLabels.length).toBeGreaterThan(0);

    structuredLabels.forEach((label) => {
      const key = label.placeholder_key;
      const checklistRow = asRecord(checklistRowsByKey.get(key));
      const renderEntry = asRecord(renderEntriesByKey.get(key));

      expect(label.input_type).toEqual("structured_section");
      expect(label.destination).toEqual("assessment_checklist.value_json");
      expect(label.review_behavior).toEqual("structured_clinical_review_required");
      expect(checklistRow.structured_section).toEqual(label.structured_section);
      expect(checklistRow.input_type).toEqual(label.input_type);
      expect(checklistRow.destination).toEqual(label.destination);
      expect(renderEntry.not_exported).toBe(false);
      expect(renderEntry.target).toEqual("caloptima_fba_pdf_overlay");
    });
  });

  it("prefers approved structured sections over checklist summary values for the same placeholder", async () => {
    const payload = await buildCalOptimaTemplatePayload({
      checklistItems: [
        {
          placeholder_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
          required: true,
          status: "approved",
          value_text: "1 structured sections extracted",
          value_json: { title: "Unreviewed summary payload" },
        },
      ],
      structuredSections: [
        {
          field_key: "CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS",
          section_key: "goals_treatment_planning",
          section_index: 0,
          payload: {
            title: "Reviewed communication goal",
            baseline: "Requests help in 1 of 5 opportunities.",
          },
          status: "approved",
          required: true,
        },
      ],
      client: { full_name: "Test Client" },
      writer: { full_name: "Test Writer" },
      acceptedProgram: null,
      acceptedGoals: [],
    });

    expect(payload.values.CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS).toContain("Reviewed communication goal");
    expect(payload.values.CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS).not.toContain("structured sections extracted");
    expect(payload.values.CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS).not.toContain("Unreviewed summary payload");
  });
});
