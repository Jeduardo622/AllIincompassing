import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = path.join(process.cwd(), "supabase", "migrations");
const migrationNames = readdirSync(migrationsDirectory).filter((name) =>
  name.endsWith("_agent_work_retention_policy_encoding.sql"),
);
const migrationSql =
  migrationNames.length === 1
    ? readFileSync(path.join(migrationsDirectory, migrationNames[0]), "utf8")
    : "";
const normalizedSql = migrationSql.replace(/\s+/g, " ");
const attestationPath = path.join(
  process.cwd(),
  "docs",
  "ai",
  "reviews",
  "WIN-275-retention-policy-encoding-attestation.json",
);
const hostedShadowAttestationPath = path.join(
  process.cwd(),
  "docs",
  "ai",
  "reviews",
  "WIN-275-solo-maintainer-attestation.json",
);

const canonicalRepositoryHash = (repositoryPath: string) =>
  createHash("sha256")
    .update(
      readFileSync(path.resolve(repositoryPath), "utf8").replace(/\r\n/g, "\n"),
    )
    .digest("hex");

describe("agent work ledger retention policy encoding migration", () => {
  it("uses one new forward migration without rewriting the retention foundation", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationSql).toMatch(
      /@migration-dependencies: 20260801100000_agent_work_ledger_retention\.sql/i,
    );
    expect(migrationSql).not.toMatch(
      /alter table public\.agent_work_retention_policies/i,
    );
    expect(migrationSql).not.toMatch(
      /create or replace function public\.prune_agent_work_retention_category/i,
    );
  });

  it("encodes the exact owner-approved category periods as versioned decisions", () => {
    expect(normalizedSql).toMatch(
      /create table public\.agent_work_retention_policy_decisions/i,
    );
    expect(normalizedSql).toMatch(/unique \(category, policy_version\)/i);
    for (const [category, days] of [
      ["ledger_history", 365],
      ["queue_archive", 90],
      ["execution_trace", 30],
    ] as const) {
      expect(normalizedSql).toMatch(
        new RegExp(`\\('${category}',\\s*1,\\s*${days},`, "i"),
      );
    }
  });

  it("binds every decision to immutable owner-attestation provenance", () => {
    expect(normalizedSql).toContain("solo_maintainer_owner");
    expect(normalizedSql).toContain(
      "LINEAR:WIN-275:COMMENT:556735C4-5D1D-4257-8ACA-261D99973992",
    );
    expect(normalizedSql).toContain(
      "148b3b42e4b5dfb1bf5fb134bc09351409a1181b53e68d2d0e45ee8b36609e34",
    );
    expect(normalizedSql).toMatch(/decision_recorded_at timestamptz not null/i);
    expect(normalizedSql).toMatch(/raise exception[^;]+immutable/i);
    expect(normalizedSql).toMatch(
      /before update or delete on public\.agent_work_retention_policy_decisions/i,
    );
  });

  it("keeps the catalog forced-RLS and service-role read-only", () => {
    expect(normalizedSql).toMatch(/enable row level security/i);
    expect(normalizedSql).toMatch(/force row level security/i);
    expect(normalizedSql).toMatch(
      /create policy agent_work_retention_policy_decisions_service_role_select[^;]+for select[^;]+to service_role/i,
    );
    expect(normalizedSql).toMatch(
      /revoke all on public\.agent_work_retention_policy_decisions from public, anon, authenticated, service_role/i,
    );
    expect(normalizedSql).toMatch(
      /grant select on public\.agent_work_retention_policy_decisions to service_role/i,
    );
    expect(normalizedSql).not.toMatch(
      /grant select on public\.agent_work_retention_policy_decisions to (?:public|anon|authenticated)/i,
    );
    expect(normalizedSql).not.toMatch(
      /grant (?:insert|update|delete|all)[^;]+agent_work_retention_policy_decisions/i,
    );
  });

  it("does not introduce a destructive path or operational policy activation", () => {
    expect(normalizedSql).not.toMatch(
      /insert into public\.agent_work_retention_policies/i,
    );
    expect(normalizedSql).not.toMatch(/\bdelete\s+from\b/i);
    expect(normalizedSql).not.toMatch(/grant delete/i);
    expect(normalizedSql).not.toMatch(
      /pg_cron|vault\.|runtime_mode|advisory|active mode/i,
    );
  });

  it("binds the exact retention slice to non-hosted passing review evidence", () => {
    const attestation = JSON.parse(readFileSync(attestationPath, "utf8")) as {
      authorization: Record<string, boolean>;
      protectedSurfaceHashes: Record<string, string>;
      specialistReviews: Record<string, { agentId: string; verdict: string }>;
    };

    expect(attestation.authorization).toMatchObject({
      hostedAction: false,
      nonDestructivePolicyEncoding: true,
      operationalPolicyActivation: false,
      retentionDeletion: false,
      runtimeOrSchedulerChange: false,
    });
    for (const review of Object.values(attestation.specialistReviews)) {
      expect(review.agentId).toMatch(/^[0-9a-f-]{36}$/);
      expect(review.verdict).toBe("PASS");
    }
    for (const [repositoryPath, expectedHash] of Object.entries(
      attestation.protectedSurfaceHashes,
    )) {
      expect(expectedHash, repositoryPath).toBe(
        canonicalRepositoryHash(repositoryPath),
      );
    }

    const hostedShadowAttestation = JSON.parse(
      readFileSync(hostedShadowAttestationPath, "utf8"),
    ) as {
      supplementalAttestation: {
        hostedActionAuthorized: boolean;
        path: string;
        sha256: string;
      };
    };
    expect(hostedShadowAttestation.supplementalAttestation).toEqual({
      hostedActionAuthorized: false,
      path: path.relative(process.cwd(), attestationPath).replace(/\\/g, "/"),
      sha256: canonicalRepositoryHash(
        path.relative(process.cwd(), attestationPath),
      ),
    });
  });
});
