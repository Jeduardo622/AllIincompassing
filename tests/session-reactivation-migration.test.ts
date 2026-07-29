import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260729120000_reactivate_cancelled_session.sql",
);

describe("reactivate_cancelled_session migration", () => {
  it("preserves the protected SQL contract", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/create or replace function public\.reactivate_cancelled_session\(\s*p_session_id uuid,\s*p_actor_id uuid,\s*p_start_time timestamptz default null,\s*p_end_time timestamptz default null\s*\)/i);
    expect(sql).toMatch(/old\.status = 'cancelled'[\s\S]*new\.status = 'scheduled'[\s\S]*current_setting\('app\.session_reactivation_authorized', true\) = 'true'/i);
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/p_start_time is null\) <> \(p_end_time is null\)/i);
    expect(sql).toMatch(/p_end_time <= p_start_time/i);
    expect(sql).toMatch(/v_target_start_time/i);
    expect(sql).toMatch(/v_target_end_time/i);
    expect(sql).toMatch(/insert into public\.session_holds/i);
    expect(sql).toMatch(/delete from public\.session_holds where id = v_temp_hold_id/i);
    expect(sql).toMatch(/exception[\s\S]*when exclusion_violation/i);
    expect(sql).toMatch(/s\.id <> v_session\.id/i);
    expect(sql).toMatch(/s\.status <> 'cancelled'/i);
    expect(sql).toMatch(/s\.organization_id = v_session\.organization_id/i);
    expect(sql).toMatch(/session_holds/i);
    expect(sql).toMatch(/cancellation_attribution = null/i);
    expect(sql).toMatch(/session_reactivated/i);
    expect(sql).toMatch(/'previousStartTime', v_session\.start_time/i);
    expect(sql).toMatch(/'previousEndTime', v_session\.end_time/i);
    expect(sql).toMatch(/'startTime', v_target_start_time/i);
    expect(sql).toMatch(/'endTime', v_target_end_time/i);
    expect(sql).toMatch(/start_time = v_target_start_time/i);
    expect(sql).toMatch(/end_time = v_target_end_time/i);
    expect(sql).toMatch(/perform\s+set_config\('app\.session_reactivation_authorized',\s*'true',\s*true\)/i);
    expect(sql).toMatch(/revoke execute on function public\.reactivate_cancelled_session\(uuid, uuid, timestamptz, timestamptz\) from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.reactivate_cancelled_session\(uuid, uuid, timestamptz, timestamptz\) to service_role/i);
  });

  it("does not rewrite preserved session fields during reactivation", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const updateMatch = sql.match(/update\s+public\.sessions\s+set([\s\S]*?)where\s+id\s*=\s*v_session\.id/i);

    expect(updateMatch).toBeTruthy();

    const updateSql = updateMatch?.[1] ?? "";
    expect(updateSql).not.toMatch(/\bnotes\s*=/i);
    expect(updateSql).not.toMatch(/\btherapist_id\s*=/i);
    expect(updateSql).not.toMatch(/\bclient_id\s*=/i);
    expect(updateSql).toMatch(/\bstart_time\s*=\s*v_target_start_time/i);
    expect(updateSql).toMatch(/\bend_time\s*=\s*v_target_end_time/i);
  });
});
