import { describe, expect, it } from "vitest";
import { loadChecklistTemplateRows } from "../assessmentChecklistTemplate";
import { loadIehpLayoutManifest } from "../assessmentTemplateLayout";

describe("IEHP FBA layout manifest", () => {
  it("covers the 30-page DOCX template, 22 DOCX tables, and all checklist keys", async () => {
    const [manifest, checklistRows] = await Promise.all([
      loadIehpLayoutManifest(),
      loadChecklistTemplateRows("iehp_fba"),
    ]);

    expect(manifest.page_count).toBe(30);
    expect(manifest.pages).toHaveLength(30);
    expect(manifest.table_count).toBe(22);

    const fieldKeys = new Set(manifest.fields.map((field) => field.field_key));
    const missingChecklistKeys = checklistRows
      .map((row) => row.placeholder_key)
      .filter((placeholderKey) => !fieldKeys.has(placeholderKey));
    expect(missingChecklistKeys).toEqual([]);
  });
});

