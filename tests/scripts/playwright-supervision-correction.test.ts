/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assertSyntheticAuthUserDeleted,
  formatSupervisionCorrectionFailure,
  isAuthEmailCollision,
  isMarkerOwnedSyntheticIdentity,
} from "../../scripts/playwright-supervision-correction";

describe("supervision correction hosted proof safeguards", () => {
  it("accepts only explicit marker-bearing synthetic BT and BCBA identities", () => {
    expect(isMarkerOwnedSyntheticIdentity("playwright.ci.bt.bt-aba-proof-1234@example.com", "bt-aba-proof-1234")).toBe(true);
    expect(isMarkerOwnedSyntheticIdentity("playwright.ci.bcba.bt-aba-proof-1234@example.com", "bt-aba-proof-1234")).toBe(true);
    expect(isMarkerOwnedSyntheticIdentity("clinician@example.com", "bt-aba-proof-1234")).toBe(false);
    expect(isMarkerOwnedSyntheticIdentity("playwright.ci.bt.example@example.com", "bt-aba-proof-1234")).toBe(false);
  });

  it("redacts secrets and clinical payloads from correction-proof diagnostics", () => {
    const message = formatSupervisionCorrectionFailure(500, JSON.stringify({
      code: "correction_failed",
      message: "Denied 11111111-1111-4111-8111-111111111111 for playwright.ci.bcba.bt-aba-proof-1234@example.com with eyJhbGciOiJIUzI1NiJ9.payload.signature",
      responses: { client_status: "do not print clinical payload" },
    }));

    expect(message).toContain("status=500");
    expect(message).toContain("code=correction_failed");
    expect(message).toContain("[uuid]");
    expect(message).toContain("[email]");
    expect(message).toContain("[token]");
    expect(message).not.toContain("do not print clinical payload");
  });

  it("accepts only an explicit Auth user-not-found result as deletion proof", () => {
    expect(() => assertSyntheticAuthUserDeleted({
      data: { user: null },
      error: { status: 404, code: "user_not_found" },
    })).not.toThrow();
    expect(() => assertSyntheticAuthUserDeleted({
      data: { user: null },
      error: { status: 500, code: "unexpected_failure" },
    })).toThrow(/unexpected Auth result/i);
    expect(() => assertSyntheticAuthUserDeleted({
      data: { user: { id: "still-present" } },
      error: null,
    })).toThrow(/auth user remains/i);
  });

  it("classifies only explicit duplicate-email errors as marker collisions", () => {
    expect(isAuthEmailCollision({ status: 422, code: "email_exists" })).toBe(true);
    expect(isAuthEmailCollision({ status: 500, code: "unexpected_failure" })).toBe(false);
    expect(isAuthEmailCollision({ status: 422, code: "weak_password" })).toBe(false);
  });

  it("uses browser-authenticated BT -> BCBA -> BT -> BCBA steps plus service-role cleanup verification", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/playwright-supervision-correction.ts"), "utf8");

    expect(source).toContain("PW_BT_DISPOSABLE_ACK");
    expect(source).toContain("PW_BT_DISPOSABLE_BRANCH_TEARDOWN_ACK");
    expect(source).toContain("Refusing production Supabase project");
    expect(source).toContain("Pending Review");
    expect(source).toContain("Correction Required");
    expect(source).toContain("Resubmitted");
    expect(source).toContain("Completed");
    expect(source).toContain("return_supervision_session_note_request_to_bt");
    expect(source).toContain("get_bt_supervision_correction_tasks");
    expect(source).toContain("resubmit_bt_supervision_correction");
    expect(source).toContain("complete_supervision_session_note_request");
    expect(source).toContain("session_note_attestations");
    expect(source).toContain("supervision_session_note_corrections");
    expect(source).toContain("cleanupCorrectionLifecycle");
    expect(source).toContain("Synthetic supervision template remains after cleanup");
    expect(source).toContain("user_therapist_links");
    expect(source).toContain("loginAndAssertSession");
    expect(source).toContain("Sign and Complete Supervision Note");
    expect(source).toContain("complete_supervision_session_note_request");
    expect(source).toContain("Supervision validation failed");
    expect(source).toContain('page.locator(\'[data-field="progress_toward_goals"]\')');
    expect(source).not.toContain('getByLabel("Summary of Progress Toward Treatment Goals"');
    expect(source).toContain("zero retained marker rows");
    expect(source).toContain("getUserById(bcba.id)");
    expect(source).not.toContain("auth.admin.listUsers");
    expect(source).not.toContain("completeReviewThroughRpc");
    expect(source).toContain("finally");
    expect(source.indexOf("if (btPage) {")).toBeLessThan(source.indexOf("else if (bcbaPage) {"));
  });

  it("leaves protected BCBA profile fields to the privileged provisioning RPC", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/playwright-supervision-correction.ts"), "utf8");
    const provisioningBlock = source.slice(
      source.indexOf("const provisionMarkerOwnedBcba"),
      source.indexOf("const resolvePendingRequestFixture"),
    );
    const profileWrite = provisioningBlock.slice(
      provisioningBlock.indexOf('admin.from("profiles")'),
      provisioningBlock.indexOf('admin.from("user_roles")'),
    );

    expect(profileWrite).toContain('admin.from("profiles").update({');
    expect(profileWrite).not.toContain('admin.from("profiles").upsert({');
    expect(profileWrite).not.toContain('role: "bcba"');
    expect(profileWrite).not.toContain("organization_id: organizationId");
    expect(provisioningBlock).toContain('admin.rpc("provision_ci_smoke_bcba_profile"');
  });
});
