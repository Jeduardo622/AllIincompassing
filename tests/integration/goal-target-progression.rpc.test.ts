import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { Pool } from "pg";

const sql = readFileSync(
  path.join(process.cwd(), "supabase", "migrations", "20260710210551_goal_target_automatic_progression.sql"),
  "utf8",
);

const evaluator = () => sql.match(/create or replace function app\.evaluate_goal_target_progression[\s\S]*?\n\$\$;/i)?.[0] ?? "";
const finalizer = () => sql.match(/create or replace function public\.finalize_session_note_with_progression[\s\S]*?\n\$\$;/i)?.[0] ?? "";
const override = () => sql.match(/create or replace function public\.override_goal_target_progression[\s\S]*?\n\$\$;/i)?.[0] ?? "";
const completeMastery = () => sql.match(/create or replace function public\.complete_goal_target_mastery[\s\S]*?\n\$\$;/i)?.[0] ?? "";
const initializer = () => sql.match(/create or replace function app\.initialize_goal_target_progression_state[\s\S]*?\n\$\$;/i)?.[0] ?? "";

describe("static automatic goal-target progression SQL contract", () => {
  it("declares evaluator-only records inside the evaluator", () => {
    expect(evaluator()).toMatch(/declare[\s\S]*v_prior_evaluation public\.goal_target_phase_evaluations;/i);
    expect(initializer()).not.toContain("v_prior_evaluation");
  });

  it("uses goal advisory lock before any target row lock in every writer", () => {
    for (const writer of [initializer(), evaluator(), override()]) {
      expect(writer.indexOf("pg_advisory_xact_lock")).toBeGreaterThan(-1);
      expect(writer.indexOf("pg_advisory_xact_lock")).toBeLessThan(writer.indexOf("for update"));
    }
  });
  it("advances baseline after the required qualifying streak", () => {
    expect(evaluator()).toMatch(/count\(\*\) filter \(where ordered\.result = 'qualifying' and ordered\.resets_seen = 0\)::integer[\s\S]*into v_streak/i);
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
    expect(evaluator()).toMatch(/v_prior_transition public\.goal_target_transitions/i);
    expect(evaluator()).toMatch(/v_prior_transition\.id is not null[\s\S]*'advanced'/i);
    expect(evaluator()).toMatch(/blocked_incomplete_criteria[\s\S]*ignored_no_data[\s\S]*ignored_insufficient_observations[\s\S]*qualifying[\s\S]*nonqualifying/i);
    expect(evaluator()).not.toMatch(/return query select 'idempotent_replay'/i);
  });

  it("reconstructs every public replay outcome from immutable ledger fields", () => {
    expect(evaluator()).toMatch(/return query select 'advanced', v_prior_transition\.goal_id[\s\S]*v_prior_transition\.previous_phase[\s\S]*v_prior_transition\.resulting_phase/i);
    expect(evaluator()).toMatch(/v_prior_transition\.resulting_target_id <> v_prior_transition\.previous_target_id[\s\S]*v_prior_transition\.resulting_target_id else null::uuid/i);
    expect(evaluator()).toMatch(/v_prior_transition\.resulting_target_id = v_prior_transition\.previous_target_id[\s\S]*then 'mastered'::text else 'active'::text/i);
    expect(evaluator()).toMatch(/return query select v_prior_evaluation\.result[\s\S]*blocked_incomplete_criteria/i);
    expect(finalizer()).toMatch(/previous_phase = 'mastery' and r\.next_target_id is null then 'goal_mastered'[\s\S]*previous_phase = 'mastery' then 'target_mastered'[\s\S]*then 'advanced'[\s\S]*blocked_incomplete_criteria[\s\S]*criteria_incomplete[\s\S]*ignored_[\s\S]*then 'ignored'[\s\S]*else 'no_change'/i);
  });

  it("replays no-transition outcomes with the goal status persisted at evaluation time", () => {
    expect(sql).toMatch(/create table if not exists public\.goal_target_phase_evaluations[\s\S]*goal_status text not null/i);
    expect(evaluator()).toMatch(/insert into public\.goal_target_phase_evaluations \([\s\S]*goal_status[\s\S]*v_goal_status/i);
    expect(evaluator().match(/null::uuid, v_prior_evaluation\.goal_status/gi)).toHaveLength(3);
    expect(evaluator()).not.toMatch(/null::uuid, \(select g\.status from public\.goals g where g\.id = v_goal_id\),[\s\S]*v_prior_evaluation\.result/i);
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

  it("supports only explicit measurement-compatible metrics", () => {
    expect(sql).toMatch(/metric in \('percent_correct', 'percent_independent', 'total_value', 'average_value'\)/i);
    expect(sql).toMatch(/correctIncorrect[\s\S]*percent_correct/i);
    expect(sql).toMatch(/taskAnalysis[\s\S]*percent_independent/i);
    expect(sql).toMatch(/frequency[\s\S]*timeSample[\s\S]*total_value/i);
    expect(sql).toMatch(/rate[\s\S]*duration[\s\S]*latency[\s\S]*IRT[\s\S]*average_value/i);
    expect(evaluator()).toMatch(/100\.0 \* count\(\*\) filter \(where te\.response in \('correct', 'independent'\)\)[\s\S]*nullif\(count\(\*\) filter \(where te\.response is distinct from 'notObserved'\), 0\)/i);
    expect(evaluator()).toMatch(/percent_independent[\s\S]*sum\(te\.value\)[\s\S]*avg\(te\.value\)/i);
  });

  it("orders streaks by authoritative completion timestamp and stable session id", () => {
    expect(sql).toMatch(/session_completed_at timestamptz not null/i);
    expect(evaluator()).toMatch(/order by[\s\S]*session_completed_at[\s\S]*session_id/i);
    expect(evaluator()).not.toMatch(/max\(reset_e\.evaluated_at\)/i);
  });

  it("records automatic transitions before mutating progression state", () => {
    expect(evaluator().indexOf("insert into public.goal_target_transitions")).toBeLessThan(
      evaluator().indexOf("update public.goal_targets"),
    );
  });

  it("validates exact finalized session, note, target, client, and organization scope", () => {
    expect(evaluator()).toMatch(/s\.status = 'completed'/i);
    expect(evaluator()).toMatch(/csn\.is_locked[\s\S]*csn\.signed_at is not null/i);
    expect(evaluator()).toMatch(/csn\.session_id = v_session\.id/i);
    expect(evaluator()).toMatch(/csn\.organization_id = v_session\.organization_id/i);
    expect(evaluator()).toMatch(/gt\.organization_id = v_note\.organization_id[\s\S]*gt\.client_id = v_note\.client_id/i);
  });
});

describe("static manual progression override SQL contract", () => {
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
    expect(override()).toMatch(/pg_advisory_xact_lock\(hashtextextended\(v_goal_id::text, 0\)\)/i);
    expect(override()).toMatch(/set is_current = false[\s\S]*is_current = true/i);
  });

  it("versions both sides of a current-target switch", () => {
    expect(override()).toMatch(/progression_version = progression_version \+ 1[\s\S]*where id = v_previous_current\.id/i);
    expect(override()).toMatch(/progression_version = progression_version \+ 1[\s\S]*where id = v_selected\.id/i);
  });

  it("writes separate deactivation and activation audit rows", () => {
    expect(override().match(/insert into public\.goal_target_transitions/gi)).toHaveLength(2);
    expect(override()).toMatch(/manual_deactivation[\s\S]*manual_activation/i);
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

describe("static manual mastery completion SQL contract", () => {
  it("requires current active mastery state, exact authority, reason, version, and goal lock", () => {
    expect(completeMastery()).toMatch(/current_phase <> 'mastery'|current_phase is distinct from 'mastery'/i);
    expect(completeMastery()).toMatch(/status <> 'active'[\s\S]*not v_target\.is_current/i);
    expect(completeMastery()).toMatch(/current_user_has_exact_role_for_org[\s\S]*array\['bcba', 'midtier'\]/i);
    expect(completeMastery()).toMatch(/char_length\(btrim\(reason\)\) = 0/i);
    expect(completeMastery()).toMatch(/progression_version <> expected_version/i);
    expect(completeMastery()).toMatch(/pg_advisory_xact_lock/i);
  });

  it("audits before mastery, activates the next eligible target, or masters the goal", () => {
    expect(completeMastery()).toMatch(/insert into public\.goal_target_transitions[\s\S]*update public\.goal_targets[\s\S]*status = 'mastered'/i);
    expect(completeMastery()).toMatch(/status <> 'archived'[\s\S]*sort_order/i);
    expect(completeMastery()).toMatch(/current_phase = 'baseline'[\s\S]*evaluation_window_started_at = v_now/i);
    expect(completeMastery()).toMatch(/update public\.goals[\s\S]*status = 'mastered'/i);
  });

  it("selects the globally lowest eligible target even when it sorts before the completed target", () => {
    expect(completeMastery()).not.toMatch(/\(gt\.sort_order, gt\.created_at, gt\.id\)\s*>/i);
    expect(completeMastery()).toMatch(/gt\.id <> v_target\.id[\s\S]*order by gt\.sort_order, gt\.created_at, gt\.id/i);
  });
});

const localDatabaseUrl = process.env.LOCAL_PROGRESSION_DATABASE_URL;

describe.runIf(Boolean(localDatabaseUrl))("live local goal-target progression database contract", () => {
  it("installs the progression schema with RLS and least-privilege RPC grants", async () => {
    const pool = new Pool({ connectionString: localDatabaseUrl, max: 1 });
    try {
      const tables = await pool.query<{ relname: string; relrowsecurity: boolean }>(`
        select c.relname, c.relrowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = any($1::text[])
        order by c.relname
      `, [["goal_target_phase_criteria", "goal_target_phase_evaluations", "goal_target_transitions"]]);
      expect(tables.rows).toEqual([
        { relname: "goal_target_phase_criteria", relrowsecurity: true },
        { relname: "goal_target_phase_evaluations", relrowsecurity: true },
        { relname: "goal_target_transitions", relrowsecurity: true },
      ]);

      const grants = await pool.query<{ authenticated: boolean; anon: boolean }>(`
        select
          has_function_privilege('authenticated', 'public.finalize_session_note_with_progression(uuid,uuid,jsonb,jsonb,jsonb)', 'execute') authenticated,
          has_function_privilege('anon', 'public.finalize_session_note_with_progression(uuid,uuid,jsonb,jsonb,jsonb)', 'execute') anon
      `);
      expect(grants.rows[0]).toEqual({ authenticated: true, anon: false });
    } finally {
      await pool.end();
    }
  });

  it("leaves no committed note or trial writes after malformed finalization rollback", async () => {
    const pool = new Pool({ connectionString: localDatabaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      const before = await client.query<{ notes: string; trials: string }>(`
        select (select count(*)::text from public.client_session_notes) notes,
               (select count(*)::text from public.trial_events) trials
      `);
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "11111111-1111-4111-8111-111111111111", role: "authenticated" })]);
      await expect(client.query(`select * from public.finalize_session_note_with_progression(
        '22222222-2222-4222-8222-222222222222'::uuid, null, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
      )`)).rejects.toMatchObject({ code: "22023" });
      await client.query("rollback");
      const after = await client.query<{ notes: string; trials: string }>(`
        select (select count(*)::text from public.client_session_notes) notes,
               (select count(*)::text from public.trial_events) trials
      `);
      expect(after.rows[0]).toEqual(before.rows[0]);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
