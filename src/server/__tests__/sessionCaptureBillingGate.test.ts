import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/shared", () => ({ fetchJson: vi.fn(), getSupabaseConfig: vi.fn() }));

import { fetchJson, getSupabaseConfig } from "../api/shared";
import { resolveSessionCaptureStrictBillingPolicy } from "../sessionCaptureBillingGate";

describe("resolveSessionCaptureStrictBillingPolicy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseConfig).mockReturnValue({ supabaseUrl: "https://example.supabase.co", anonKey: "anon" });
  });

  it("queries the tenant-scoped policy RPC under the caller bearer token", async () => {
    vi.mocked(fetchJson).mockResolvedValue({ ok: true, status: 200, data: false });
    await expect(resolveSessionCaptureStrictBillingPolicy("caller-token", "org-1")).resolves.toEqual({ strict: false, upstreamError: false });
    expect(fetchJson).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/get_session_capture_strict_billing_gate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer caller-token", apikey: "anon" }),
        body: JSON.stringify({ target_organization_id: "org-1" }),
      }),
    );
  });

  it("fails closed when policy lookup does not return a boolean", async () => {
    vi.mocked(fetchJson).mockResolvedValue({ ok: false, status: 503, data: null });
    await expect(resolveSessionCaptureStrictBillingPolicy("caller-token", "org-1")).resolves.toEqual({ strict: true, upstreamError: true });
  });
});
