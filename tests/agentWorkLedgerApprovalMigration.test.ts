import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const coreSql = readFileSync(
  "supabase/migrations/20260801090000_agent_work_ledger_core.sql",
  "utf8",
);
const queueSql = readFileSync(
  "supabase/migrations/20260801093000_agent_work_ledger_queue.sql",
  "utf8",
);
const itemFunctionSource = readFileSync(
  "supabase/functions/agent-work-items/index.ts",
  "utf8",
);

describe("agent work approval migration contract", () => {
  it("provides service-role-only handoff and CAS decision RPCs", () => {
    expect(coreSql).toContain("request_agent_work_approval_handoff");
    expect(coreSql).toContain("decide_agent_work_approval");
    expect(coreSql).toMatch(/grant execute on function public\.request_agent_work_approval_handoff[\s\S]+to service_role/i);
    expect(coreSql).toMatch(/grant execute on function public\.decide_agent_work_approval[\s\S]+to service_role/i);
    expect(coreSql).toMatch(/revoke all on function public\.request_agent_work_approval_handoff[\s\S]+from public, anon, authenticated/i);
  });

  it("binds requests to canonical hashes, an owner, expiry, and reason code", () => {
    expect(coreSql).toContain("request_reason_code");
    expect(coreSql).toContain("assigned_to");
    expect(coreSql).toContain("approval_hash");
    expect(coreSql).toContain("extensions.digest");
    expect(coreSql).toContain("approval.requested");
    expect(coreSql).toContain("clinical_review_handoff");
  });

  it("re-reads role and tenant authority and handles stale state atomically", () => {
    expect(coreSql).toContain("for update");
    expect(coreSql).toContain("approval.conflict");
    expect(coreSql).toContain("approval.revoked");
    expect(coreSql).toContain("approval.decided");
    expect(coreSql).toMatch(/coalesce\(decider_role\.is_active, true\) = true/i);
    expect(coreSql).toMatch(/profile\.organization_id = p_organization_id/i);
    expect(coreSql).toContain("input_hash_changed");
    expect(coreSql).toContain("evidence_hash_changed");
    expect(coreSql).toContain("owner_authority_lost");
    expect(coreSql).toContain("agent_work_user_has_client_access");
    expect(coreSql).toContain("workflow_version_changed");
    expect(coreSql).toContain("work_cancelled");
    expect(coreSql).toContain("step_not_current");
    expect(coreSql).toContain("approval.expired");
    expect(coreSql).toMatch(/v_approval\.decided_by = p_actor_user_id/i);
    expect(coreSql).toMatch(/v_approval\.decision_reason_code = v_reason/i);
    expect(coreSql).toMatch(/owner_user_id = p_assigned_owner_user_id/i);
  });

  it("sweeps stale live approvals instead of relying on UI authority checks", () => {
    expect(queueSql).toContain("revoke_stale_agent_work_approvals");
    expect(queueSql).toContain("agent_work_approvals_stale_sweep_idx");
    expect(queueSql).toContain("owner_authority_lost");
    expect(queueSql).toContain("workflow_version_changed");
    expect(queueSql).toContain("input_hash_changed");
    expect(queueSql).toContain("evidence_hash_changed");
    expect(queueSql).toContain("work_cancelled");
    expect(queueSql).toContain("step_not_current");
    expect(queueSql).toContain("approval.revoked");
  });

  it("keeps approval governance on the current step and manager-only event surface", () => {
    expect(coreSql).toContain("v_item.current_step_id is distinct from v_step.id");
    expect(coreSql).toContain("event_type not like 'approval.%'");
    expect(coreSql).toContain("app.current_user_can_manage_agent_work_row(organization_id, client_id)");
    expect(coreSql).toContain("assigned_to = auth.uid()");
  });

  it("routes assigned-approver RLS through the caller-bound authority wrapper", () => {
    const approvalPolicy = coreSql.match(
      /create policy agent_work_approvals_org_read[\s\S]+?;\s*\n\s*create policy/i,
    )?.[0];

    expect(approvalPolicy).toContain("current_user_can_decide_agent_work_approval(id)");
    expect(approvalPolicy).not.toContain("agent_work_user_has_exact_role");
    expect(approvalPolicy).not.toContain("agent_work_user_has_client_access");
    expect(coreSql).toMatch(
      /revoke all on function public\.agent_work_user_has_exact_role[\s\S]+from public, anon, authenticated, service_role/i,
    );
    expect(coreSql).toMatch(
      /revoke all on function public\.agent_work_user_has_client_access[\s\S]+from public, anon, authenticated, service_role/i,
    );
  });

  it("preserves approval history while keeping sweeps indexed and consumed decisions final", () => {
    expect(coreSql).toMatch(/agent_work_approvals_live_step_uidx[\s\S]+status in \('pending', 'approved'\)/i);
    expect(queueSql).toContain("approval_consumed");
    expect(queueSql).toContain("agent_work_approvals_expiry_sweep_idx");
  });

  it("batches decision authority and omits approval owner identities from browser DTOs", () => {
    expect(coreSql).toContain("current_user_decidable_agent_work_approval_ids");
    expect(itemFunctionSource).toContain('"current_user_decidable_agent_work_approval_ids"');
    expect(itemFunctionSource).not.toContain('"current_user_can_decide_agent_work_approval"');
    expect(itemFunctionSource).not.toContain("assignedOwnerUserId: approval.assigned_to");
  });

  it("builds decision responses from a bounded service reread after the service-only RPC", () => {
    const decisionRuntime = itemFunctionSource.match(
      /decideApproval: async \(input\) => \{[\s\S]+?\n\s*\},\n\s*\}\)\(request\)/,
    )?.[0];

    expect(decisionRuntime).toMatch(
      /serviceClient\s*\.from\("agent_work_approvals"\)/,
    );
    expect(decisionRuntime).toContain('.eq("work_item_id", input.workItemId)');
    expect(decisionRuntime).toContain('.eq("id", input.approvalId)');
    expect(decisionRuntime).not.toContain("getDetail(input.workItemId)");
  });

  it("keeps direct DML closed and IEHP outcomes advisory", () => {
    expect(coreSql).toContain("terminal_state', 'needs_review'");
    expect(coreSql).not.toContain("approval.publish");
    expect(coreSql).not.toContain("approval.bill");
  });
});
