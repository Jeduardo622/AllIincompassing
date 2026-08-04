import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const draftReviewMigrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260801104500_agent_work_ledger_caloptima_draft_review.sql",
);

const draftReviewMigrationExists = existsSync(draftReviewMigrationPath);
const draftReviewSql = draftReviewMigrationExists
  ? readFileSync(draftReviewMigrationPath, "utf8")
  : "";
const normalizedDraftReviewSql = draftReviewSql.replace(/\s+/g, " ");

const createWorkItemSql = draftReviewSql.match(
  /create or replace function public\.create_agent_caloptima_draft_review_work_item\([^]*?\$\$;/i,
)?.[0] ?? "";

const assessmentScopeResolverSql = draftReviewSql.match(
  /create or replace function public\.resolve_agent_work_assessment_scope\([^]*?\$\$;/i,
)?.[0] ?? "";

const caloptimaDescriptorSql = draftReviewSql.match(
  /create or replace function public\.agent_work_caloptima_advisory_projection_descriptor\([^]*?\$\$;/i,
)?.[0] ?? "";

const genericDescriptorSql = draftReviewSql.match(
  /create or replace function public\.agent_work_advisory_projection_descriptor\([^]*?\$\$;/i,
)?.[0] ?? "";

const canonicalEffectKeySql = draftReviewSql.match(
  /create or replace function public\.agent_work_canonical_effect_key\([^]*?\$\$;/i,
)?.[0] ?? "";

const beginAttemptSql = draftReviewSql.match(
  /create or replace function public\.begin_agent_work_caloptima_model_attempt\([^]*?\$\$;/i,
)?.[0] ?? "";

const completeAttemptSql = draftReviewSql.match(
  /create or replace function public\.complete_agent_work_caloptima_model_attempt\([^]*?\$\$;/i,
)?.[0] ?? "";

const failAttemptSql = draftReviewSql.match(
  /create or replace function public\.fail_agent_work_caloptima_model_attempt\([^]*?\$\$;/i,
)?.[0] ?? "";

const snapshotDraftPacketSql = draftReviewSql.match(
  /create or replace function public\.snapshot_agent_work_caloptima_draft_packet\([^]*?\$\$;/i,
)?.[0] ?? "";

const refreshEvidenceSql = draftReviewSql.match(
  /create or replace function public\.refresh_agent_work_caloptima_evidence\([^]*?\$\$;/i,
)?.[0] ?? "";

const replayPacketSql = draftReviewSql.match(
  /create or replace function public\.read_agent_work_caloptima_draft_packet\([^]*?\$\$;/i,
)?.[0] ?? "";

const effectEvidenceTriggerSql = draftReviewSql.match(
  /create or replace function public\.agent_work_capture_caloptima_projection_evidence\([^]*?\$\$;/i,
)?.[0] ?? "";

const syncEvidenceSql = draftReviewSql.match(
  /create or replace function public\.sync_agent_work_caloptima_projection_evidence\([^]*?\$\$;/i,
)?.[0] ?? "";

describe("agent work ledger CalOptima draft review migration contract", () => {
  it("adds the bounded Task 16 migration file", () => {
    expect(draftReviewMigrationExists).toBe(true);
  });

  it("keeps the fixed six-step workflow graph and exact human role boundaries", () => {
    expect(createWorkItemSql).toMatch(/security definer/i);
    expect(createWorkItemSql).toMatch(/set search_path = ''/i);
    expect(createWorkItemSql).toMatch(/app\.actor_can_manage_agent_work_row/i);
    expect(createWorkItemSql).toMatch(/template_type\s*=\s*'caloptima_fba'/i);
    expect(createWorkItemSql).toMatch(/workflow_version\s*=\s*1/i);
    expect(createWorkItemSql).toMatch(/'assessment\.caloptima\.prepare_draft_review'/i);
    expect(createWorkItemSql).toMatch(/validate_scope/i);
    expect(createWorkItemSql).toMatch(/await_approved_evidence/i);
    expect(createWorkItemSql).toMatch(/suggest_draft_packet/i);
    expect(createWorkItemSql).toMatch(/snapshot_draft_packet/i);
    expect(createWorkItemSql).toMatch(/assign_clinical_owner/i);
    expect(createWorkItemSql).toMatch(/request_draft_review/i);
    expect(createWorkItemSql).toMatch(
      /'validate_scope',\s*10,\s*'deterministic',\s*'ready'/i,
    );
    expect(createWorkItemSql).toMatch(
      /'await_approved_evidence',\s*20,\s*'deterministic',\s*'pending'/i,
    );
    expect(createWorkItemSql).toMatch(
      /'suggest_draft_packet',\s*30,\s*'model_suggested',\s*'pending'/i,
    );
    expect(createWorkItemSql).toMatch(
      /'snapshot_draft_packet',\s*40,\s*'deterministic',\s*'pending'/i,
    );
    expect(createWorkItemSql).toMatch(
      /'assign_clinical_owner',\s*50,\s*'human',\s*'pending',\s*'clinical',\s*'bcba'/i,
    );
    expect(createWorkItemSql).toMatch(
      /'request_draft_review',\s*60,\s*'human',\s*'pending',\s*'clinical',\s*'bcba'/i,
    );
    expect(createWorkItemSql).not.toMatch(/payer[-_ ]specific|generic payload|workflow sql|model graph/i);
  });

  it("resolves assessment scope through a fail-closed actor-checked service RPC", () => {
    expect(assessmentScopeResolverSql).toMatch(/security definer/i);
    expect(assessmentScopeResolverSql).toMatch(/set search_path = ''/i);
    expect(assessmentScopeResolverSql).toMatch(/p_actor_user_id\s+uuid/i);
    expect(assessmentScopeResolverSql).toMatch(/p_assessment_document_id\s+uuid/i);
    expect(assessmentScopeResolverSql).toMatch(/p_workflow_key\s+text/i);
    expect(assessmentScopeResolverSql).toMatch(/p_workflow_version\s+integer/i);
    expect(assessmentScopeResolverSql).toMatch(/workflow version unsupported/i);
    expect(assessmentScopeResolverSql).toMatch(/assessment\.iehp\.prepare_for_clinical_review/i);
    expect(assessmentScopeResolverSql).toMatch(/assessment\.caloptima\.prepare_draft_review/i);
    expect(assessmentScopeResolverSql).toMatch(/iehp_fba/i);
    expect(assessmentScopeResolverSql).toMatch(/caloptima_fba/i);
    expect(assessmentScopeResolverSql).toMatch(/app\.actor_can_manage_agent_work_row/i);
    expect(normalizedDraftReviewSql).toMatch(
      /revoke all on function public\.resolve_agent_work_assessment_scope\(uuid, uuid, text, integer\) from public, anon, authenticated, service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /grant execute on function public\.resolve_agent_work_assessment_scope\(uuid, uuid, text, integer\) to service_role/i,
    );
    expect(normalizedDraftReviewSql).not.toMatch(
      /grant (?:select|all) on public\.assessment_documents to (?:authenticated|service_role)/i,
    );
  });

  it("renames the old descriptor to IEHP, adds a fail-closed CalOptima helper, and recreates generic dispatch", () => {
    expect(normalizedDraftReviewSql).toMatch(
      /alter function public\.agent_work_advisory_projection_descriptor\(uuid\)\s+rename to agent_work_iehp_advisory_projection_descriptor/i,
    );

    expect(caloptimaDescriptorSql).toMatch(/assessment\.caloptima\.prepare_draft_review/i);
    expect(caloptimaDescriptorSql).toMatch(/template_type\s*=\s*'caloptima_fba'/i);
    expect(caloptimaDescriptorSql).toMatch(/step_key\s*=\s*'await_approved_evidence'/i);
    expect(caloptimaDescriptorSql).toMatch(/step_key\s*=\s*'snapshot_draft_packet'/i);
    expect(caloptimaDescriptorSql).toMatch(/fail closed|unavailable|scope mismatch/i);
    expect(caloptimaDescriptorSql).toMatch(/assessment_checklist_items/i);
    expect(caloptimaDescriptorSql).toMatch(/assessment_structured_sections/i);
    expect(caloptimaDescriptorSql).toMatch(/assessment_draft_programs/i);
    expect(caloptimaDescriptorSql).toMatch(/assessment_draft_goals/i);
    expect(caloptimaDescriptorSql).toMatch(/extensions\.digest/i);
    expect(caloptimaDescriptorSql).not.toMatch(
      /value_text|value_json|event_payload|review_notes|original_text/i,
    );
    expect(caloptimaDescriptorSql).not.toMatch(/'sourceSpan'\s*,|'payload'\s*,/i);
    expect(caloptimaDescriptorSql).not.toMatch(/service_role/i);

    expect(genericDescriptorSql).toMatch(/agent_work_iehp_advisory_projection_descriptor/i);
    expect(genericDescriptorSql).toMatch(/agent_work_caloptima_advisory_projection_descriptor/i);
    expect(genericDescriptorSql).toMatch(/workflow_key/i);
    expect(genericDescriptorSql).toMatch(/workflow_version/i);
    expect(genericDescriptorSql).toMatch(/effect_key text,\s*output_hash text/i);
    expect(genericDescriptorSql).toMatch(/assessment\.iehp\.prepare_for_clinical_review/i);
    expect(genericDescriptorSql).toMatch(/assessment\.caloptima\.prepare_draft_review/i);
    expect(genericDescriptorSql).toMatch(
      /agent_work_iehp_advisory_projection_descriptor\(p_step_id\)[^;]*;\s*return\s*;/is,
    );
    expect(genericDescriptorSql).toMatch(
      /agent_work_caloptima_advisory_projection_descriptor\(p_step_id\)[^;]*;\s*return\s*;/is,
    );
  });

  it("uses PHI-free authoritative projections and canonical effect keys for await and snapshot", () => {
    expect(caloptimaDescriptorSql).toMatch(/all required checklist and structured rows are approved/i);
    expect(caloptimaDescriptorSql).toMatch(/at least one approved CalOptima goal structured section exists/i);
    expect(caloptimaDescriptorSql).toMatch(/CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS/i);
    expect(caloptimaDescriptorSql).toMatch(/CALOPTIMA_FBA_TARGET_REPLACEMENT_GOALS/i);
    expect(caloptimaDescriptorSql).toMatch(/CALOPTIMA_FBA_PARENT_GOALS/i);
    expect(caloptimaDescriptorSql).not.toMatch(/lower\(section\.(section_key|field_key)\)\s+like\s+'%goal%'/i);
    expect(caloptimaDescriptorSql).toMatch(/at least one staged draft program and goal exist/i);
    expect(caloptimaDescriptorSql).toMatch(/assessment_document/i);
    expect(caloptimaDescriptorSql).toMatch(/assessment_checklist_item/i);
    expect(caloptimaDescriptorSql).toMatch(/assessment_structured_section/i);
    expect(caloptimaDescriptorSql).toMatch(/assessment_review_event/i);
    expect(caloptimaDescriptorSql).toMatch(/assessment_draft_program/i);
    expect(caloptimaDescriptorSql).toMatch(/assessment_draft_goal/i);
    expect(caloptimaDescriptorSql).toMatch(/status/i);
    expect(caloptimaDescriptorSql).toMatch(/to_jsonb\(program\)/i);
    expect(caloptimaDescriptorSql).toMatch(/to_jsonb\(goal\)/i);
    expect(caloptimaDescriptorSql).toMatch(/updated_at|created_at/i);
    expect(canonicalEffectKeySql).toMatch(/'targetKind', p_target_kind/i);
    expect(canonicalEffectKeySql).toMatch(/'payloadHash', p_output_hash/i);
    expect(caloptimaDescriptorSql).not.toMatch(/publication|promotion|published|promoted/i);
    expect(caloptimaDescriptorSql).not.toMatch(/phi|member name|diagnosis/i);
    expect(caloptimaDescriptorSql).not.toMatch(/lock table/i);
    expect(caloptimaDescriptorSql).toMatch(/for share/i);
    expect(caloptimaDescriptorSql).toMatch(
      /checklist\.status\s*=\s*'approved'[\s\S]*structuredSections/i,
    );
    expect(caloptimaDescriptorSql).toMatch(
      /section\.status\s*=\s*'approved'[\s\S]*reviewEvents/i,
    );
  });

  it("captures PHI-free evidence pointers only from verified CalOptima advisory projection effects", () => {
    expect(normalizedDraftReviewSql).toMatch(
      /create trigger agent_work_capture_caloptima_projection_evidence\s+after insert or update of status on public\.agent_work_effects/i,
    );
    expect(effectEvidenceTriggerSql).toMatch(/status\s*(<>|=)\s*'verified'/i);
    expect(effectEvidenceTriggerSql).toMatch(/effect_kind\s*(<>|=)\s*'advisory_projection'/i);
    expect(effectEvidenceTriggerSql).toMatch(/sync_agent_work_caloptima_projection_evidence/i);
    expect(syncEvidenceSql).toMatch(/await_approved_evidence/i);
    expect(syncEvidenceSql).toMatch(/snapshot_draft_packet/i);
    expect(syncEvidenceSql).toMatch(/agent_work_evidence/i);
    expect(syncEvidenceSql).toMatch(/locator/i);
    expect(syncEvidenceSql).toMatch(/sha256/i);
    expect(effectEvidenceTriggerSql).not.toMatch(/value_text|value_json|source_span|review_notes|payload/i);
    expect(syncEvidenceSql).not.toMatch(
      /(insert into|update|delete from)\s+public\.(assessment_documents|assessment_checklist_items|assessment_structured_sections|assessment_review_events|assessment_draft_programs|assessment_draft_goals|programs|goals)\b/i,
    );
  });

  it("keeps model completion advisory and gives deterministic snapshotting sole packet persistence authority", () => {
    expect(normalizedDraftReviewSql).not.toMatch(
      /create or replace function public\.reconcile_agent_caloptima_draft_review_work_item/i,
    );
    expect(beginAttemptSql).toMatch(/security definer/i);
    expect(beginAttemptSql).toMatch(/set search_path = ''/i);
    expect(beginAttemptSql).toMatch(/claim_agent_work_step\(/i);
    expect(beginAttemptSql).toMatch(/suggest_draft_packet/i);
    expect(beginAttemptSql).toMatch(/provider/i);
    expect(beginAttemptSql).toMatch(/model/i);
    expect(beginAttemptSql).toMatch(/prompt_version/i);
    expect(beginAttemptSql).toMatch(/tool_version/i);
    expect(beginAttemptSql).toMatch(/pricing_version/i);
    expect(beginAttemptSql).toMatch(/model_request_schema_version/i);
    expect(beginAttemptSql).toMatch(/no-tools/i);
    expect(beginAttemptSql).toMatch(/allowed_tools\s+text\[\]/i);
    expect(beginAttemptSql).toMatch(/guarded_tools\s+text\[\]/i);
    expect(beginAttemptSql).toMatch(/output_hash\s+text/i);
    expect(beginAttemptSql).toMatch(/allowed_tools\s*:=\s*'\{\}'::text\[\]/i);
    expect(beginAttemptSql).toMatch(/guarded_tools\s*:=\s*'\{\}'::text\[\]/i);
    expect(beginAttemptSql).toMatch(
      /guarded_tools\s*:=\s*'\{\}'::text\[\];\s*return next;\s*return;/i,
    );
    expect(beginAttemptSql).toMatch(/correlation_id\s*=\s*btrim\(p_correlation_id\)/i);
    expect(beginAttemptSql).toMatch(/request_id\s*=\s*btrim\(p_request_id\)/i);
    expect(beginAttemptSql).toMatch(/running/i);
    expect(beginAttemptSql).not.toMatch(/http|pg_net|vault|tool_call/i);

    expect(completeAttemptSql).toMatch(/security definer/i);
    expect(completeAttemptSql).toMatch(/set search_path = ''/i);
    expect(completeAttemptSql).toMatch(/output_hash/i);
    expect(completeAttemptSql).toMatch(/p_draft_packet\s+jsonb/i);
    expect(completeAttemptSql).toMatch(/input_token_count/i);
    expect(completeAttemptSql).toMatch(/output_token_count/i);
    expect(completeAttemptSql).toMatch(/computed_cost/i);
    expect(completeAttemptSql).toMatch(/record_agent_work_model_attempt_result/i);
    expect(completeAttemptSql).toMatch(/agent_work_effects/i);
    expect(completeAttemptSql).toMatch(/model_suggestion_snapshot/i);
    expect(completeAttemptSql).not.toMatch(/assessment_draft_programs|assessment_draft_goals/i);
    expect(completeAttemptSql).toMatch(/snapshot_agent_work_caloptima_draft_packet\(/i);
    expect(completeAttemptSql).toMatch(/'verified'|status\s*=\s*'verified'/i);
    expect(completeAttemptSql).toMatch(/transition_agent_work_step\(/i);
    expect(completeAttemptSql).toMatch(/mismatch/i);
    expect(completeAttemptSql).not.toMatch(
      /update public\.(assessment_documents|programs|goals)\b/i,
    );

    expect(failAttemptSql).toMatch(/security definer/i);
    expect(failAttemptSql).toMatch(/set search_path = ''/i);
    expect(failAttemptSql).toMatch(/attempt_snapshot_denied/i);
    expect(failAttemptSql).toMatch(/authoritative_scope_mismatch/i);
    expect(failAttemptSql).toMatch(/authoritative_payload_unavailable/i);
    expect(failAttemptSql).toMatch(/record_agent_work_model_attempt_result/i);
    expect(failAttemptSql).toMatch(/'failed'::public\.agent_work_step_status/i);
    expect(failAttemptSql).toMatch(/'ready'::public\.agent_work_step_status/i);
    expect(failAttemptSql).not.toMatch(/assessment_draft_programs|assessment_draft_goals|programs|goals/i);

    expect(snapshotDraftPacketSql).toMatch(/security definer/i);
    expect(snapshotDraftPacketSql).toMatch(/set search_path = ''/i);
    expect(snapshotDraftPacketSql).toMatch(/public\.agent_runtime_config/i);
    expect(snapshotDraftPacketSql).toMatch(/actions_disabled/i);
    expect(snapshotDraftPacketSql).toMatch(/for share/i);
    expect(snapshotDraftPacketSql).toMatch(/runtime policy disabled/i);
    expect(snapshotDraftPacketSql).toMatch(/snapshot_draft_packet/i);
    expect(snapshotDraftPacketSql).toMatch(/p_draft_packet\s+jsonb/i);
    expect(snapshotDraftPacketSql).not.toMatch(/p_output_hash\s+text/i);
    expect(snapshotDraftPacketSql).toMatch(/extensions\.digest[\s\S]*p_draft_packet::text/i);
    expect(snapshotDraftPacketSql).toMatch(/agent_work_caloptima_draft_packets/i);
    expect(snapshotDraftPacketSql).toMatch(/insert into public\.assessment_draft_programs/i);
    expect(snapshotDraftPacketSql).toMatch(/insert into public\.assessment_draft_goals/i);
    expect(snapshotDraftPacketSql).toMatch(/jsonb_array_length\(p_draft_packet->'programs'\)/i);
    expect(snapshotDraftPacketSql).toMatch(/jsonb_array_length\(p_draft_packet->'goals'\)/i);
    expect(snapshotDraftPacketSql).toMatch(/evidence_refs/i);
    expect(snapshotDraftPacketSql).toMatch(/review_flags/i);
    expect(snapshotDraftPacketSql).toMatch(/finalize_agent_work_advisory_projection_effect\(/i);
    expect(snapshotDraftPacketSql).toMatch(/'verified'|status\s*=\s*'verified'/i);
  });

  it("binds immutable replay and packet evidence to authoritative source content", () => {
    expect(normalizedDraftReviewSql).toMatch(/create table if not exists public\.agent_work_caloptima_draft_packets/i);
    expect(normalizedDraftReviewSql).toMatch(/unique\s*\(work_item_id\)/i);
    expect(normalizedDraftReviewSql).toMatch(/alter table public\.agent_work_caloptima_draft_packets enable row level security/i);
    expect(normalizedDraftReviewSql).toMatch(
      /create policy agent_work_caloptima_draft_packets_service_role_all on public\.agent_work_caloptima_draft_packets for all to service_role using \(true\) with check \(true\)/i,
    );
    expect(normalizedDraftReviewSql).toMatch(/revoke all on public\.agent_work_caloptima_draft_packets from public, anon, authenticated/i);
    expect(replayPacketSql).toMatch(/app\.actor_can_manage_agent_work_row/i);
    expect(replayPacketSql).toMatch(/packet\s+jsonb/i);
    expect(replayPacketSql).toMatch(/output_hash\s+text/i);
    expect(replayPacketSql).toMatch(/packet_hash\s+text/i);
    expect(replayPacketSql).toMatch(/extensions\.digest[\s\S]*snapshot\.packet::text/i);
    expect(snapshotDraftPacketSql).toMatch(/reference\.value->>'source_span'\s*=\s*'assessment_checklist_item:'\s*\|\|\s*checklist\.id::text/i);
    expect(snapshotDraftPacketSql).toMatch(/reference\.value->>'source_span'\s*=\s*'assessment_structured_section:'\s*\|\|\s*section\.id::text/i);
    expect(syncEvidenceSql).toMatch(/value_text/i);
    expect(syncEvidenceSql).toMatch(/value_json/i);
    expect(syncEvidenceSql).toMatch(/section\.payload/i);
    expect(syncEvidenceSql).toMatch(/section\.source_span/i);
    expect(syncEvidenceSql).toMatch(/program\.name/i);
    expect(syncEvidenceSql).toMatch(/program\.description/i);
    expect(syncEvidenceSql).toMatch(/goal\.title/i);
    expect(syncEvidenceSql).toMatch(/goal\.description/i);
  });

  it("revokes stale approvals and reopens their decision steps without completing or publishing", () => {
    expect(refreshEvidenceSql).toMatch(/security definer/i);
    expect(refreshEvidenceSql).toMatch(/set search_path = ''/i);
    expect(refreshEvidenceSql).toMatch(/sync_agent_work_caloptima_projection_evidence/i);
    expect(syncEvidenceSql).toMatch(/assessment_checklist_items/i);
    expect(syncEvidenceSql).toMatch(/assessment_structured_sections/i);
    expect(syncEvidenceSql).toMatch(/assessment_review_events/i);
    expect(syncEvidenceSql).toMatch(/assessment_draft_programs/i);
    expect(syncEvidenceSql).toMatch(/assessment_draft_goals/i);
    expect(refreshEvidenceSql).toMatch(/agent_work_compute_input_hash/i);
    expect(refreshEvidenceSql).toMatch(/agent_work_compute_evidence_hash/i);
    expect(refreshEvidenceSql).toMatch(/agent_work_compute_approval_hash/i);
    expect(refreshEvidenceSql).toMatch(/owner_authority_lost/i);
    expect(refreshEvidenceSql).toMatch(/workflow_version_changed/i);
    expect(refreshEvidenceSql).toMatch(/input_hash_changed/i);
    expect(refreshEvidenceSql).toMatch(/evidence_hash_changed/i);
    expect(refreshEvidenceSql).toMatch(/status\s*=\s*'needs_approval'/i);
    expect(refreshEvidenceSql).toMatch(/approval\.revoked/i);
    expect(refreshEvidenceSql).not.toMatch(/request_agent_work_approval_handoff\(/i);
    expect(refreshEvidenceSql).not.toMatch(/published|promoted|status\s*=\s*'completed'/i);
  });

  it("keeps grants fail-closed and explicitly rejects the old raw assign completion and handoff shortcut", () => {
    expect(normalizedDraftReviewSql).toMatch(
      /revoke all on function public\.agent_work_iehp_advisory_projection_descriptor\([^)]*\) from public, anon, authenticated, service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /revoke all on function public\.agent_work_caloptima_advisory_projection_descriptor\([^)]*\) from public, anon, authenticated, service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /revoke all on function public\.agent_work_advisory_projection_descriptor\([^)]*\) from public, anon, authenticated, service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /revoke all on function public\.begin_agent_work_caloptima_model_attempt\([^)]*\) from public, anon, authenticated, service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /revoke all on function public\.complete_agent_work_caloptima_model_attempt\([^)]*\) from public, anon, authenticated, service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /revoke all on function public\.fail_agent_work_caloptima_model_attempt\([^)]*\) from public, anon, authenticated, service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /revoke all on function public\.snapshot_agent_work_caloptima_draft_packet\([^)]*\) from public, anon, authenticated, service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /revoke all on function public\.refresh_agent_work_caloptima_evidence\([^)]*\) from public, anon, authenticated, service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /grant execute on function public\.begin_agent_work_caloptima_model_attempt\([^)]*\) to service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /grant execute on function public\.complete_agent_work_caloptima_model_attempt\([^)]*\) to service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /grant execute on function public\.fail_agent_work_caloptima_model_attempt\([^)]*\) to service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /grant execute on function public\.snapshot_agent_work_caloptima_draft_packet\([^)]*\) to service_role/i,
    );
    expect(normalizedDraftReviewSql).toMatch(
      /grant execute on function public\.refresh_agent_work_caloptima_evidence\([^)]*\) to service_role/i,
    );
    expect(normalizedDraftReviewSql).not.toMatch(/grant execute on function public\.agent_work_caloptima_advisory_projection_descriptor/i);
    expect(normalizedDraftReviewSql).not.toMatch(/request_agent_work_approval_handoff\(/i);
    expect(normalizedDraftReviewSql).not.toMatch(
      /update public\.agent_work_steps[^;]*assign_clinical_owner[^;]*status\s*=\s*'completed'/i,
    );
    expect(normalizedDraftReviewSql).not.toMatch(
      /update public\.agent_work_steps[^;]*request_draft_review[^;]*status\s*=\s*'completed'/i,
    );
  });
});
