import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const goalTargetsSource = readFileSync(
  path.join(process.cwd(), "supabase", "functions", "goal-targets", "index.ts"),
  "utf8",
);
const trialEventsSource = readFileSync(
  path.join(process.cwd(), "supabase", "functions", "trial-events", "index.ts"),
  "utf8",
);

describe("goal target and trial event edge access boundaries", () => {
  it("does not collapse program-goal capability RPC failures into normal forbidden responses", () => {
    expect(goalTargetsSource).toContain("type CapabilityResult = { allowed: boolean; upstreamError: boolean }");
    expect(goalTargetsSource).toContain("if (allowed.upstreamError) return json(req, { error: \"Unable to validate program-goal access\" }, 502);");
  });

  it("does not collapse trial-event data-taking or lock RPC failures into normal denials", () => {
    expect(trialEventsSource).toContain("type CapabilityResult = { allowed: boolean; upstreamError: boolean }");
    expect(trialEventsSource).toContain("type LockStateResult = { locked: boolean; upstreamError: boolean }");
    expect(trialEventsSource).toContain("if (canCapture.upstreamError) return json(req, { error: \"Unable to validate trial-event capture access\" }, 502);");
    expect(trialEventsSource).toContain("if (lockState.upstreamError) return json(req, { error: \"Unable to validate session lock state\" }, 502);");
    expect(trialEventsSource).toContain("if (canManageLocked.upstreamError) return json(req, { error: \"Unable to validate locked-session trial-event access\" }, 502);");
  });

  it("rejects negative trial-event values at the edge boundary", () => {
    expect(trialEventsSource).toContain("value: z.number().nonnegative().optional().nullable()");
  });
});
