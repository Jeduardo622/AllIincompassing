import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const GOALS_FUNCTION_PATH = path.join(process.cwd(), "supabase", "functions", "goals", "index.ts");
const source = readFileSync(GOALS_FUNCTION_PATH, "utf8");

describe("goals edge access boundaries", () => {
  it("does not gate goal reads behind program-goal management capability", () => {
    const getBlockStart = source.indexOf('if (req.method === "GET")');
    const postBlockStart = source.indexOf('if (req.method === "POST")');

    expect(getBlockStart).toBeGreaterThan(-1);
    expect(postBlockStart).toBeGreaterThan(getBlockStart);
    expect(source.slice(getBlockStart, postBlockStart)).not.toContain("currentUserCanManageProgramsGoals");
  });

  it("keeps program-goal management capability checks on goal writes", () => {
    const postBlockStart = source.indexOf('if (req.method === "POST")');
    const patchBlockStart = source.indexOf('if (req.method === "PATCH")');
    const methodAllowedStart = source.indexOf('return json(req, { error: "Method not allowed" }');

    expect(source.slice(postBlockStart, patchBlockStart)).toContain("currentUserCanManageProgramsGoals");
    expect(source.slice(patchBlockStart, methodAllowedStart)).toContain("currentUserCanManageProgramsGoals");
  });
});
