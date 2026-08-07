import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("readSelectedSessionPlanIds", () => {
  it("reads selected ids when executed through the Playwright tsx runtime", () => {
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/tsx/dist/cli.mjs"),
        resolve("tests/scripts/fixtures/read-selected-session-plan-ids.ts"),
      ],
      { encoding: "utf8" },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      programIds: ["program-selected"],
      goalIds: ["goal-selected"],
    });
  });

  it("reveals mobile disclosures before selecting program and goal controls", () => {
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/tsx/dist/cli.mjs"),
        resolve("tests/scripts/fixtures/select-mobile-session-plan-controls.ts"),
      ],
      { encoding: "utf8" },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      selected: true,
      programDisclosureOpen: true,
      goalDisclosureOpen: true,
    });
  });
});
