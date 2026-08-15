import { describe, expect, it } from "vitest";

import {
  WIN_219_PAYROLL_MIGRATION_CONTRACT,
  resolveRequiredRuntimeMigrations,
} from "../../scripts/ci/check-runtime-migration-parity.mjs";

describe("check-runtime-migration-parity", () => {
  it("includes the payroll security repair and latest advisor/session repairs in the explicit WIN-219 contract", () => {
    const entries = WIN_219_PAYROLL_MIGRATION_CONTRACT.split(",");

    expect(entries).toContain(
      "20260813103000|payroll_security_repair",
    );
    expect(entries).toContain(
      "20260814172117|payroll_manager_assignment_advisor_remediation",
    );
    expect(entries).toContain(
      "20260814183500|payroll_session_context_disabled_precedence",
    );
    expect(entries).toContain(
      "20260814191200|payroll_session_context_enabled_authority_repair",
    );
    expect(entries).toContain(
      "20260814205000|profile_insert_sync_bypass",
    );
    expect(entries).toContain(
      "20260814213754|session_audit_created_by_typo_repair",
    );
    expect(entries).toContain(
      "20260815002241|payroll_mutation_receipts_initplan",
    );
    expect(entries).toContain(
      "20260815191838|payroll_mutation_receipts_actor_user_id_index",
    );
  });

  it("fails closed for manual payroll activation when the explicit WIN-219 migration contract is missing", () => {
    expect(() =>
      resolveRequiredRuntimeMigrations({
        baseSha: "",
        headSha: "HEAD",
        requiredContractText: "",
        activatePayrollAdministration: true,
      }),
    ).toThrow(/WIN-219 payroll migration contract/i);
  });

  it("requires the full explicit WIN-219 payroll migration contract for manual payroll activation even when the merge range is empty", () => {
    const required = resolveRequiredRuntimeMigrations({
      baseSha: "",
      headSha: "HEAD",
      requiredContractText: WIN_219_PAYROLL_MIGRATION_CONTRACT,
      activatePayrollAdministration: true,
    });

    expect(required).toEqual(
      WIN_219_PAYROLL_MIGRATION_CONTRACT.split(",").map((entry) => {
        const [version, name] = entry.split("|");
        return { version, name };
      }),
    );
  });

  it("fails closed when the explicit WIN-219 migration contract is malformed", () => {
    expect(() =>
      resolveRequiredRuntimeMigrations({
        baseSha: "",
        headSha: "HEAD",
        requiredContractText: "20260812153628",
        activatePayrollAdministration: true,
      }),
    ).toThrow(/Invalid WIN-219 payroll migration contract entry/i);
  });
});
