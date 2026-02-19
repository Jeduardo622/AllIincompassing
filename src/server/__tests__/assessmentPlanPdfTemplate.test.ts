import { describe, expect, it } from "vitest";
import { loadCalOptimaChecklistTemplateRows } from "../assessmentChecklistTemplate";
import { loadCalOptimaPdfRenderMap } from "../assessmentPlanPdf";

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
});
