import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("goal domains migration contract", () => {
  const migrationPath = join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260706143000_goal_domains_and_structured_draft_goals.sql",
  );
  const sql = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");

  it("enforces goal domain tenant scope at the database boundary", () => {
    expect(sql).toContain("add constraint goal_domains_id_organization_id_key unique (id, organization_id)");
    expect(sql).toContain(
      "add constraint goals_domain_id_fkey foreign key (domain_id, organization_id) references public.goal_domains(id, organization_id)",
    );
    expect(sql).toContain(
      "add constraint assessment_draft_goals_domain_id_fkey foreign key (domain_id, organization_id) references public.goal_domains(id, organization_id)",
    );
  });
});
