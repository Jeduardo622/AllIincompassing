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

  it("gates trial-event reads through the trial-event capture capability", () => {
    expect(trialEventsSource).toContain("import { createRequestClient, supabaseAdmin }");
    expect(trialEventsSource).toContain("const scopeDb = supabaseAdmin;");
    expect(trialEventsSource).toContain("const readScope = await resolveTrialEventReadScope(scopeDb, orgId, req, sessionId, targetId);");
    expect(trialEventsSource).toContain("const canRead = await canCaptureTrialEvent(db, orgId, readScope.scope.clientId);");
    expect(trialEventsSource).toContain("current_user_can_capture_trial_event");
    expect(trialEventsSource).toContain("if (canRead.upstreamError) return json(req, { error: \"Unable to validate trial-event read access\" }, 502);");
    expect(trialEventsSource).toContain("if (!canRead.allowed) return json(req, { error: \"Forbidden\" }, 403);");
  });

  it("rejects negative trial-event values at the edge boundary", () => {
    expect(trialEventsSource).toContain("value: z.number().nonnegative().optional().nullable()");
  });

  it("keeps response-based and value-based trial-event payloads mutually exclusive", () => {
    expect(trialEventsSource).toContain("const valueRequiredMeasurementTypes = new Set([\"frequency\", \"rate\", \"duration\", \"timeSample\", \"latency\", \"IRT\"]);");
    expect(trialEventsSource).toContain("return \"value is not allowed for this target measurement type\";");
    expect(trialEventsSource).toContain("return \"value is required for this target measurement type\";");
    expect(trialEventsSource).toContain("return \"response is not allowed for this target measurement type\";");
  });
});
