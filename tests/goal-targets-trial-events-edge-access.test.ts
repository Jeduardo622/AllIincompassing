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

  it("uses the exact goal-target delete capability and preserves its upstream failure distinction", () => {
    expect(goalTargetsSource).toContain('db.rpc("current_user_can_delete_goal_targets", {');
    expect(goalTargetsSource).toContain("target_organization_id: orgId");
    expect(goalTargetsSource).toContain(
      'if (canDelete.upstreamError) return json(req, { error: "Unable to validate goal-target delete access" }, 502);',
    );
    expect(goalTargetsSource).toContain('if (!canDelete.allowed) return json(req, { error: "Forbidden" }, 403);');
  });

  it("implements DELETE through the request-scoped client and same-organization RLS filters", () => {
    expect(goalTargetsSource).toContain('if (req.method === "DELETE")');
    expect(goalTargetsSource).toContain('const db = createRequestClient(req);');
    expect(goalTargetsSource).not.toContain("supabaseAdmin");
    expect(goalTargetsSource).toMatch(
      /from\("goal_targets"\)[\s\S]*\.delete\(\)[\s\S]*\.eq\("organization_id", orgId\)[\s\S]*\.eq\("id", targetId\)/,
    );
  });

  it("preflights archived status and maps preserved trial history to actionable conflicts", () => {
    expect(goalTargetsSource).toContain('select("id,status")');
    expect(goalTargetsSource).toContain('target.status !== "archived"');
    expect(goalTargetsSource).toContain('json(req, { error: "Only archived goal targets can be deleted" }, 409)');
    expect(goalTargetsSource).toContain('error.code === "23503"');
    expect(goalTargetsSource).toContain(
      'json(req, { error: "Goal target has trial history and cannot be deleted" }, 409)',
    );
    expect(goalTargetsSource).toContain(
      'json(req, { error: "Goal target has trial history or is no longer eligible for deletion" }, 409)',
    );
  });

  it("distinguishes target absence from upstream lifecycle infrastructure failures", () => {
    expect(goalTargetsSource).toContain('if (!target) return json(req, { error: "Goal target not found" }, 404);');
    expect(goalTargetsSource).toContain('if (targetError) return json(req, { error: "Failed to load goal target" }, 502);');
    expect(goalTargetsSource).toContain('if (error) return json(req, { error: "Failed to delete goal target" }, 502);');
  });

  it("rejects generic archival while a target is current", () => {
    expect(goalTargetsSource).toContain('select("id,is_current,status")');
    expect(goalTargetsSource).toContain('if (currentTarget.is_current)');
    expect(goalTargetsSource).toContain('Select another current target before archiving this target');
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
