import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const overloadRemovalMigration = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260723154500_remove_session_metrics_text_overload.sql",
  ),
  "utf8",
);

const schedulingRpcHardeningMigration = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20251231150000_lock_down_scheduling_rpcs.sql",
  ),
  "utf8",
);
const normalizedSchedulingRpcHardeningMigration =
  schedulingRpcHardeningMigration.toLowerCase();

describe("session metrics overload removal migration", () => {
  it("removes only the legacy text overload", () => {
    expect(overloadRemovalMigration).toContain(
      "drop function if exists public.get_session_metrics(text, text, uuid, uuid);",
    );
    expect(overloadRemovalMigration).not.toContain(
      "drop function if exists public.get_session_metrics(date, date, uuid, uuid);",
    );
  });

  it("preserves the authenticated grant on the surviving date overload", () => {
    expect(normalizedSchedulingRpcHardeningMigration).toContain(
      "grant execute on function public.get_session_metrics(date, date, uuid, uuid) to authenticated;",
    );
  });

  it("requests a PostgREST schema reload after the overload cleanup", () => {
    expect(overloadRemovalMigration).toContain("notify pgrst, 'reload schema';");
  });
});
