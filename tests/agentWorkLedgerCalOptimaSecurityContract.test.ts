import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const script = readFileSync(
  path.join(process.cwd(), "scripts", "agent-work-ledger-security-contract.mjs"),
  "utf8",
);

const lifecycle = script.match(
  /const assertCalOptimaDraftReviewLifecycle = async \(client\) => \{[^]*?(?=\nconst createWorkItems)/,
)?.[0] ?? "";

describe("CalOptima Agent Work Ledger security lifecycle contract", () => {
  it("runs the complete advisory-only lifecycle from the fresh local security contract", () => {
    expect(lifecycle).not.toBe("");
    expect(lifecycle).toMatch(/create_agent_caloptima_draft_review_work_item/i);
    expect(lifecycle).toMatch(/read_agent_work_advisory_projection_descriptor/i);
    expect(lifecycle).toMatch(/claim_queued_agent_work_step/i);
    expect(lifecycle).toMatch(/record_agent_work_advisory_projection_effect/i);
    expect(lifecycle).toMatch(/finalize_agent_work_advisory_projection_effect/i);
    expect(lifecycle).toMatch(/begin_agent_work_caloptima_model_attempt/i);
    expect(lifecycle).toMatch(/complete_agent_work_caloptima_model_attempt/i);
    expect(lifecycle).toMatch(/runtime kill switch/i);
    expect(lifecycle).toMatch(/actions_disabled = true/i);
    expect(lifecycle).toMatch(/fail_agent_work_caloptima_model_attempt/i);
    expect(lifecycle).toMatch(/authoritative_payload_unavailable/i);
    expect(lifecycle).toMatch(/packet_hash/i);
    expect(lifecycle).toMatch(/allowed_tools/i);
    expect(lifecycle).toMatch(/guarded_tools/i);
    expect(lifecycle).toMatch(/request_agent_work_approval_handoff/i);
    expect(lifecycle).toMatch(/decide_agent_work_approval/i);
    expect(lifecycle).toMatch(/refresh_agent_work_caloptima_evidence/i);
    expect(lifecycle).toMatch(/evidence_hash_changed/i);
    expect(lifecycle).toMatch(/cross-org|cross-tenant/i);
    expect(lifecycle).toMatch(/no promotion|did not promote/i);
    expect(script).toMatch(/await assertCalOptimaDraftReviewLifecycle\(client\)/);
  });

  it("stages only assessment drafts and never mutates authoritative program or goal tables", () => {
    expect(lifecycle).toMatch(/assessment_draft_programs/i);
    expect(lifecycle).toMatch(/assessment_draft_goals/i);
    expect(lifecycle).not.toMatch(
      /(insert into|update|delete from)\s+public\.(programs|goals)\b/i,
    );
    expect(lifecycle).not.toMatch(/\b(fetch|https?:\/\/|openai)\b/i);
  });
});
