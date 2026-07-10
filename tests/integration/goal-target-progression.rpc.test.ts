import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(process.cwd(), "supabase", "migrations", "20260710210551_goal_target_automatic_progression.sql"),
  "utf8",
);

const evaluator = () => sql.match(/create or replace function app\.evaluate_goal_target_progression[\s\S]*?\n\$\$;/i)?.[0] ?? "";
const override = () => sql.match(/create or replace function public\.override_goal_target_progression[\s\S]*?\n\$\$;/i)?.[0] ?? "";

describe("automatic goal-target progression RPC contract", () => {
  it("advances baseline after the required qualifying streak", () => {
    expect(evaluator()).toMatch(/select count\(\*\)::integer into v_streak/i);
    expect(evaluator()).toMatch(/e\.result = 'qualifying'/i);
    expect(evaluator()).toMatch(/v_streak < v_criterion\.consecutive_sessions/i);
    expect(evaluator()).toMatch(/'baseline'[\s\S]*'teaching'/i);
  });

  it("treats threshold equality as qualifying", () => {
    expect(evaluator()).toMatch(/when 'gte' then v_metric_value >= v_criterion\.threshold/i);
    expect(evaluator()).toMatch(/when 'lte' then v_metric_value <= v_criterion\.threshold/i);
  });

  it("ignores insufficient observations", () => {
    expect(evaluator()).toMatch(/v_observation_count < v_criterion\.min_observations[\s\S]*ignored_insufficient_observations/i);
  });

  it("ignores a session with no eligible target data", () => {
    expect(evaluator()).toMatch(/v_observation_count = 0[\s\S]*ignored_no_data/i);
  });

  it("resets the qualifying streak after a nonqualifying session", () => {
    expect(evaluator()).toMatch(/nonqualifying[\s\S]*(exit|qualifying)/i);
  });

  it("excludes sessions before the evaluation window", () => {
    expect(evaluator()).toMatch(/(signed_at|event_timestamp)\s*>=\s*v_target\.evaluation_window_started_at/i);
  });

  it("fails closed when criteria are incomplete", () => {
    expect(evaluator()).toMatch(/blocked_incomplete_criteria/i);
  });

  it("advances at most one edge per session", () => {
    expect(evaluator()).toMatch(/case v_target\.current_phase[\s\S]*when 'baseline'[\s\S]*when 'teaching'[\s\S]*when 'generalization'[\s\S]*when 'mastery'/i);
  });

  it("returns an idempotent replay without a second transition", () => {
    expect(evaluator()).toMatch(/on conflict \(session_id, target_id, phase, progression_version\) do nothing/i);
    expect(evaluator()).toMatch(/idempotent_replay/i);
  });

  it("serializes two clients completing the same goal concurrently", () => {
    expect(evaluator()).toMatch(/pg_advisory_xact_lock\(hashtextextended\(v_goal_id::text, 0\)\)/i);
    expect(evaluator()).toMatch(/is_current[\s\S]*status = 'active'[\s\S]*for update/i);
  });

  it("activates the next ordered target after mastery", () => {
    expect(evaluator()).toMatch(/order by[\s\S]*sort_order[\s\S]*created_at[\s\S]*id/i);
    expect(evaluator()).toMatch(/next_target_id/i);
  });

  it("skips archived and already-mastered targets", () => {
    expect(evaluator()).toMatch(/status not in \('archived', 'mastered'\)/i);
  });

  it("masters the final goal when no next target exists", () => {
    expect(evaluator()).toMatch(/update public\.goals[\s\S]*status = 'mastered'/i);
  });

  it("locks and updates only the evaluated goal", () => {
    expect(evaluator()).toMatch(/where gt\.goal_id = v_goal_id/i);
    expect(evaluator()).toMatch(/where g\.id = v_goal_id/i);
  });

  it("uses only correctness-compatible persisted trial observations", () => {
    expect(sql).toMatch(/measurement_type[\s\S]*percent_correct/i);
    expect(evaluator()).toMatch(/100\.0 \* count\(\*\) filter \(where te\.response in \('correct', 'independent'\)\)[\s\S]*nullif\(count\(\*\) filter \(where te\.response is distinct from 'notObserved'\), 0\)/i);
  });

  it("validates exact finalized session, note, target, client, and organization scope", () => {
    expect(evaluator()).toMatch(/s\.status = 'completed'/i);
    expect(evaluator()).toMatch(/csn\.is_locked[\s\S]*csn\.signed_at is not null/i);
    expect(evaluator()).toMatch(/csn\.session_id = v_session\.id/i);
    expect(evaluator()).toMatch(/csn\.organization_id = v_session\.organization_id/i);
    expect(evaluator()).toMatch(/gt\.organization_id = v_note\.organization_id[\s\S]*gt\.client_id = v_note\.client_id/i);
  });
});

describe("manual progression override RPC contract", () => {
  it("allows only active bcba, midtier, and super admin authority", () => {
    expect(override()).toMatch(/current_user_has_exact_role_for_org[\s\S]*array\['bcba', 'midtier'\]/i);
    expect(override()).toMatch(/current_user_is_super_admin/i);
  });

  it("rejects anonymous, blank reasons, and stale versions", () => {
    expect(override()).toMatch(/auth\.uid\(\)/i);
    expect(override()).toMatch(/char_length\(btrim\(reason\)\) = 0/i);
    expect(override()).toMatch(/progression_version <> expected_version[\s\S]*stale progression version/i);
  });

  it("locks the goal and can select a different current target", () => {
    expect(override()).toMatch(/target_current_goal_target_id uuid/i);
    expect(override()).toMatch(/pg_advisory_xact_lock\(hashtextextended\(v_target\.goal_id::text, 0\)\)/i);
    expect(override()).toMatch(/set is_current = false[\s\S]*is_current = true/i);
  });

  it("supports forward and backward phases and resets the evaluation window", () => {
    expect(override()).toMatch(/current_phase = target_phase/i);
    expect(override()).toMatch(/evaluation_window_started_at = v_now/i);
  });

  it("can reopen a mastered target and its mastered goal", () => {
    expect(override()).toMatch(/status = 'active'/i);
    expect(override()).toMatch(/update public\.goals[\s\S]*status = 'active'/i);
  });

  it("appends immutable manual history with the actor and reason", () => {
    expect(override()).toMatch(/insert into public\.goal_target_transitions/i);
    expect(override()).toMatch(/'manual'[\s\S]*v_actor[\s\S]*btrim\(reason\)/i);
    expect(sql).toContain("revoke insert, update, delete on table public.goal_target_transitions from authenticated;");
  });

  it("returns the complete structured transition result", () => {
    expect(override()).toMatch(/returns table\s*\([\s\S]*outcome text[\s\S]*goal_id uuid[\s\S]*target_id uuid[\s\S]*previous_phase[\s\S]*current_phase[\s\S]*next_target_id uuid[\s\S]*goal_status text[\s\S]*warning text/i);
  });

  it("is callable only by authenticated and service roles", () => {
    expect(sql).toMatch(/revoke execute on function public\.override_goal_target_progression\(uuid, public\.goal_target_phase, uuid, text, bigint\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.override_goal_target_progression\(uuid, public\.goal_target_phase, uuid, text, bigint\) to authenticated, service_role/i);
  });
});
