import { describe, expect, it, vi } from "vitest";

import { evaluateTherapistAuthorization } from "../../supabase/functions/_shared/authorization";

describe("scheduling edge therapist authorization", () => {
  it("allows an exact BCBA role to authorize a target therapist", async () => {
    const rpc = vi.fn(async (_name: string, args: { role_name?: string }) => ({
      data: args.role_name === "bcba",
      error: null,
    }));

    const result = await evaluateTherapistAuthorization(
      { rpc } as never,
      "therapist-row-1",
    );

    expect(result).toEqual({ ok: true });
    expect(rpc.mock.calls.map(([, args]) => args)).toEqual([
      { role_name: "therapist", target_therapist_id: "therapist-row-1" },
      { role_name: "admin", target_therapist_id: "therapist-row-1" },
      { role_name: "super_admin", target_therapist_id: "therapist-row-1" },
      { role_name: "bcba", target_therapist_id: "therapist-row-1" },
    ]);
  });

  it("denies callers when no target-scoped scheduling role matches", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));

    const result = await evaluateTherapistAuthorization(
      { rpc } as never,
      "therapist-row-1",
    );

    expect(result).toEqual({
      ok: false,
      failure: {
        status: 403,
        body: { success: false, error: "Forbidden" },
      },
    });
  });

  it("fails closed when exact BCBA role validation errors", async () => {
    const rpc = vi.fn(async (_name: string, args: { role_name?: string }) =>
      args.role_name === "bcba"
        ? { data: null, error: { message: "role lookup unavailable" } }
        : { data: false, error: null });

    const result = await evaluateTherapistAuthorization(
      { rpc } as never,
      "therapist-row-1",
    );

    expect(result).toEqual({
      ok: false,
      failure: {
        status: 500,
        body: { success: false, error: "Role validation failed" },
      },
    });
  });
});
