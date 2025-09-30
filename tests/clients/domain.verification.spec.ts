import { describe, it, expect } from "vitest";

const runClientsSuite = process.env.RUN_CLIENT_DOMAIN_TESTS === "true";
const suite = runClientsSuite ? describe : describe.skip;

suite("Clients domain contract expectations", () => {
  it("documents booking API header requirements", () => {
    const requiredHeaders = {
      Authorization: "Bearer <supabase-jwt>",
      "Idempotency-Key": "<uuid optional>",
      "Content-Type": "application/json",
    } as const;

    expect(requiredHeaders.Authorization.startsWith("Bearer ")).toBe(true);
    expect(requiredHeaders["Content-Type"]).toBe("application/json");
  });

  it("notes client details payload structure", () => {
    const payloadShape = {
      clientId: "uuid",
    } as const;

    expect(typeof payloadShape.clientId).toBe("string");
  });

  it("records onboarding expectations", () => {
    const onboardingRequest = {
      client_name: "Full Name",
      client_email: "user@example.com",
    } as const;

    expect(onboardingRequest.client_email).toContain("@");
  });
});
