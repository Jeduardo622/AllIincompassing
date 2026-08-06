import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260801100000_agent_work_ledger_retention.sql",
);

const migrationExists = existsSync(migrationPath);
const migrationSql = migrationExists ? readFileSync(migrationPath, "utf8") : "";
const normalizedSql = migrationSql.replace(/\s+/g, " ");
const retentionContract = readFileSync(
  path.join(
    process.cwd(),
    "scripts",
    "agent-work-ledger-retention-contract.mjs",
  ),
  "utf8",
);

const exportDefinition =
  migrationSql.match(
    /create or replace function public\.export_agent_work_retention_manifest\([^)]*\)[\s\S]*?as \$\$[\s\S]*?\$\$;/i,
  )?.[0] ?? "";

const exportSql = exportDefinition.match(/as \$\$([\s\S]*?)\$\$;/i)?.[1] ?? "";

const pruneDefinition =
  migrationSql.match(
    /create or replace function public\.prune_agent_work_retention_category\([^)]*\)[\s\S]*?as \$\$[\s\S]*?\$\$;/i,
  )?.[0] ?? "";

const pruneSql = pruneDefinition.match(/as \$\$([\s\S]*?)\$\$;/i)?.[1] ?? "";

describe("agent work ledger retention migration contract", () => {
  it("adds the planned Task 14 retention migration file", () => {
    expect(migrationExists).toBe(true);
  });

  it("keeps the three approved retention categories distinct without seeding policy rows or periods", () => {
    expect(normalizedSql).toMatch(/'ledger_history'/i);
    expect(normalizedSql).toMatch(/'queue_archive'/i);
    expect(normalizedSql).toMatch(/'execution_trace'/i);
    expect(
      new Set(
        (
          normalizedSql.match(
            /'(ledger_history|queue_archive|execution_trace)'/gi,
          ) ?? []
        ).map((value) => value.toLowerCase()),
      ),
    ).toEqual(
      new Set(["'ledger_history'", "'queue_archive'", "'execution_trace'"]),
    );
    expect(normalizedSql).not.toMatch(
      /insert into public\.agent_work_retention_(?:policies|holds|receipts)/i,
    );
    expect(normalizedSql).not.toMatch(/retention_(?:days|period|cutoff)/i);
    expect(normalizedSql).not.toMatch(
      /\b(?:7|14|30|60|90|180|365)\s*(?:days?|months?|years?)\b/i,
    );
  });

  it("keeps policy versions append-only with at most one active version per category", () => {
    expect(normalizedSql).toMatch(/unique \(category, policy_version\)/i);
    expect(normalizedSql).toMatch(
      /unique index[^;]+agent_work_retention_policies_active_category_uidx[\s\S]*?\(category\)[\s\S]*?where disabled_at is null/i,
    );
    expect(normalizedSql).not.toMatch(/category text not null unique/i);
  });

  it("creates service-role-only export and prune RPCs with fixed empty search_path", () => {
    expect(normalizedSql).toMatch(
      /create or replace function public\.export_agent_work_retention_manifest\([^)]*\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(normalizedSql).toMatch(
      /create or replace function public\.prune_agent_work_retention_category\([^)]*\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    );
    expect(normalizedSql).toMatch(
      /revoke all on function public\.export_agent_work_retention_manifest\([^)]*\) from public, anon, authenticated/i,
    );
    expect(normalizedSql).toMatch(
      /revoke all on function public\.prune_agent_work_retention_category\([^)]*\) from public, anon, authenticated/i,
    );
    expect(normalizedSql).toMatch(
      /grant execute on function public\.export_agent_work_retention_manifest\([^)]*\) to service_role/i,
    );
    expect(normalizedSql).toMatch(
      /grant execute on function public\.prune_agent_work_retention_category\([^)]*\) to service_role/i,
    );
  });

  it("forces service-role-only RLS on retention policy, hold, and receipt surfaces", () => {
    for (const tableName of [
      "agent_work_retention_policies",
      "agent_work_retention_holds",
      "agent_work_retention_receipts",
    ]) {
      expect(normalizedSql).toMatch(
        new RegExp(
          `alter table public\\.${tableName} enable row level security`,
          "i",
        ),
      );
      expect(normalizedSql).toMatch(
        new RegExp(
          `alter table public\\.${tableName} force row level security`,
          "i",
        ),
      );
      expect(normalizedSql).toMatch(
        new RegExp(`create policy ${tableName}_service_role_all`, "i"),
      );
      expect(normalizedSql).toMatch(
        new RegExp(
          `revoke all on public\\.${tableName} from public, anon, authenticated`,
          "i",
        ),
      );
      expect(normalizedSql).toMatch(
        new RegExp(
          `revoke all on public\\.${tableName} from service_role`,
          "i",
        ),
      );
      expect(normalizedSql).toMatch(
        new RegExp(
          `grant (?:select|insert|update)(?:,\\s*(?:select|insert|update))* on public\\.${tableName} to service_role`,
          "i",
        ),
      );
    }
  });

  it("keeps export scoped to one org and one exact work item with a canonical hashed manifest", () => {
    expect(exportDefinition).toMatch(/p_organization_id uuid/i);
    expect(exportDefinition).toMatch(/p_work_item_id uuid/i);
    expect(exportSql).toMatch(
      /where item\.organization_id = p_organization_id/i,
    );
    expect(exportSql).toMatch(/and item\.id = p_work_item_id/i);
    expect(exportSql).toMatch(/jsonb_agg\(/i);
    expect(exportSql).toMatch(/order by/i);
    expect(exportSql).toMatch(/extensions\.digest\(/i);
    expect(exportSql).toMatch(/sha-?256|encode\(/i);
    expect(exportSql).toMatch(/incomplete|fail closed|raise exception/i);
  });

  it("locks every exported ledger surface before reading to keep the manifest snapshot consistent", () => {
    const lockPosition = exportSql.search(/lock table[\s\S]*?in share mode/i);
    const firstReadPosition = exportSql.search(/\bselect\b/i);

    expect(lockPosition).toBeGreaterThanOrEqual(0);
    expect(lockPosition).toBeLessThan(firstReadPosition);
    for (const tableName of [
      "agent_work_items",
      "agent_work_steps",
      "agent_work_evidence",
      "agent_work_approvals",
      "agent_work_attempts",
      "agent_work_effects",
      "agent_work_events",
      "agent_execution_traces",
      "agent_work_retention_holds",
    ]) {
      expect(exportSql.slice(lockPosition, firstReadPosition)).toMatch(
        new RegExp(`public\\.${tableName}\\b`, "i"),
      );
    }
  });

  it("allows only deterministic PHI-free export fields and excludes forbidden clinical or prompt content", () => {
    for (const allowedToken of [
      "workflow_key",
      "workflow_version",
      "status",
      "created_at",
      "updated_at",
      "completed_at",
      "failure_reason_code",
      "evidence_hash",
      "approval_hash",
      "decision_reason_code",
      "attempt_number",
      "worker_id",
      "provider",
      "model",
      "prompt_version",
      "tool_version",
      "event_type",
      "payload_hash",
    ]) {
      expect(exportSql).toContain(allowedToken);
    }

    for (const forbiddenToken of [
      "objective",
      "completion_criteria",
      "sanitized_metadata",
      "metadata",
      "value_json",
      "value_text",
      "prompt",
      "output",
      "tool_args",
      "signed_url",
      "token",
      "raw_content",
      "clinical",
      "domain",
    ]) {
      expect(exportSql).not.toMatch(new RegExp(`\\b${forbiddenToken}\\b`, "i"));
    }

    for (const hashedOnlyField of [
      "worker_id",
      "provider",
      "model",
      "prompt_version",
      "tool_version",
      "step_name",
    ]) {
      expect(exportSql).not.toMatch(
        new RegExp(`['\"]${hashedOnlyField}['\"]\\s*,`, "i"),
      );
      expect(exportSql).toMatch(
        new RegExp(`['\"]${hashedOnlyField}_hash['\"]`, "i"),
      );
    }
  });

  it("indexes the exact tenant and work-item effect export path", () => {
    expect(normalizedSql).toMatch(
      /create index[^;]+agent_work_effects_org_work_item_export_idx[\s\S]*?on public\.agent_work_effects \(organization_id, work_item_id, created_at, id\)/i,
    );
  });

  it("stores hold metadata as machine-coded org-scoped category-specific values without free-form PHI", () => {
    expect(normalizedSql).toMatch(/agent_work_retention_holds/i);
    expect(normalizedSql).toMatch(/organization_id uuid not null/i);
    expect(normalizedSql).toMatch(/category [^,]+ not null/i);
    expect(normalizedSql).toMatch(/reason_code text/i);
    expect(normalizedSql).toMatch(/provenance_code text/i);
    expect(normalizedSql).toMatch(/approved_by uuid/i);
    expect(normalizedSql).toMatch(/released_by uuid/i);
    expect(normalizedSql).not.toMatch(
      /notes text|description text|comment text|free_form/i,
    );
  });

  it("binds hold and receipt metadata to the exact organization and work-item pair", () => {
    for (const tableName of [
      "agent_work_retention_holds",
      "agent_work_retention_receipts",
    ]) {
      const tableDefinition =
        migrationSql.match(
          new RegExp(
            `create table if not exists public\\.${tableName} \\(([\\s\\S]*?)\\n\\);`,
            "i",
          ),
        )?.[1] ?? "";

      expect(tableDefinition).toMatch(
        /foreign key \(work_item_id, organization_id\)[\s\S]*references public\.agent_work_items\(id, organization_id\)[\s\S]*on delete restrict/i,
      );
    }
  });

  it("keeps prune permanently denied in this task with no delete path or caller cutoff", () => {
    expect(normalizedSql).not.toMatch(/\bdelete\s+from\b/i);
    expect(pruneSql).not.toMatch(
      /p_cutoff|cutoff_at|retention_days|retention_period/i,
    );
    expect(pruneSql).toMatch(/policy_unapproved/i);
    expect(pruneSql).toMatch(/deleted_count/i);
    expect(pruneSql).toMatch(/0\b/);
    expect(pruneSql).not.toMatch(/execute\s+immediate/i);
  });

  it("preserves assessment-domain rows by restricting references and avoiding domain cascades", () => {
    expect(normalizedSql).not.toMatch(/on delete cascade/i);
    expect(normalizedSql).toMatch(
      /references public\.agent_work_items\(id, organization_id\)[\s\S]*on delete restrict/i,
    );
    expect(normalizedSql).not.toMatch(
      /references public\.(assessment_documents|assessment_checklist_items|assessment_structured_sections|assessment_review_events)[\s\S]*on delete cascade/i,
    );
  });

  it("restores the database owner before checking protected assessment-domain rows", () => {
    expect(retentionContract).toMatch(
      /prune_agent_work_retention_category[\s\S]*?reset role[\s\S]*?preservedRows/i,
    );
  });

  it("probes authenticated decision-catalog access independently", () => {
    const decisionCatalogProbe =
      retentionContract.match(
        /savepoint authenticated_policy_decision_probe[\s\S]*?assert\([\s\S]*?authenticatedPolicyDecisionDenied[\s\S]*?\);/i,
      )?.[0] ?? "";

    expect(decisionCatalogProbe).toMatch(
      /select count\(\*\) from public\.agent_work_retention_policy_decisions/i,
    );
    expect(decisionCatalogProbe).not.toMatch(/agent_work_retention_holds/i);
  });

  it("rechecks the seeded execution trace after all prune denials", () => {
    expect(retentionContract).toMatch(
      /pruneResults[\s\S]*?reset role[\s\S]*?from public\.agent_execution_traces where id = \$3::uuid[\s\S]*?trace_count[\s\S]*?=== 1/i,
    );
  });
});
