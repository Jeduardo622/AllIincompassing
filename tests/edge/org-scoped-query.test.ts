import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

vi.mock("../../supabase/functions/_shared/database.ts", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { orgScopedQuery } from "../../supabase/functions/_shared/org.ts";

describe("orgScopedQuery", () => {
  const db = createClient("https://example.supabase.co", "test-key");

  it("applies organization_id after select so filters are available", () => {
    const query = orgScopedQuery(db, "sessions", "org-1")
      .select("id,status")
      .eq("id", "session-1");

    expect(String((query as unknown as { url: URL }).url)).toBe(
      "https://example.supabase.co/rest/v1/sessions?select=id%2Cstatus&organization_id=eq.org-1&id=eq.session-1",
    );
  });

  it("applies organization_id after update and preserves caller filters", () => {
    const query = orgScopedQuery(db, "programs", "org-1")
      .update({ name: "Updated" })
      .eq("id", "program-1")
      .select("id,name");

    expect(String((query as unknown as { url: URL }).url)).toBe(
      "https://example.supabase.co/rest/v1/programs?organization_id=eq.org-1&id=eq.program-1&select=id%2Cname",
    );
  });

  it("injects organization_id into inserted rows", () => {
    const query = orgScopedQuery(db, "goals", "org-1")
      .insert([{ title: "Goal" }])
      .select("id,organization_id,title");

    expect(String((query as unknown as { url: URL }).url)).toBe(
      "https://example.supabase.co/rest/v1/goals?columns=%22title%22%2C%22organization_id%22&select=id%2Corganization_id%2Ctitle",
    );
  });
});
