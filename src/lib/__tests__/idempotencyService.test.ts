import { describe, expect, it } from "vitest";
import {
  createInMemoryIdempotencyService,
  hashResponse,
  IdempotencyConflictError,
} from "../../../supabase/functions/_shared/idempotency.ts";

const ENDPOINT = "sessions-hold";

describe("hashResponse", () => {
  it("produces a stable hash for identical payloads", async () => {
    const first = await hashResponse({ success: true }, 200);
    const second = await hashResponse({ success: true }, 200);
    expect(first).toEqual(second);
  });

  it("changes hash when payload or status differ", async () => {
    const hashA = await hashResponse({ success: true }, 200);
    const hashB = await hashResponse({ success: true }, 201);
    const hashC = await hashResponse({ success: false }, 200);

    expect(hashA).not.toEqual(hashB);
    expect(hashA).not.toEqual(hashC);
  });
});

describe("IdempotencyService", () => {
  it("stores and retrieves responses", async () => {
    const service = createInMemoryIdempotencyService();

    const body = { success: true, data: { value: 1 } };
    const stored = await service.persist("key-1", ENDPOINT, body, 200);
    expect(stored.responseBody).toEqual(body);
    expect(stored.statusCode).toBe(200);

    const fetched = await service.find("key-1", ENDPOINT);
    expect(fetched).toEqual(stored);
  });

  it("returns existing record when same payload is persisted", async () => {
    const service = createInMemoryIdempotencyService();
    const body = { success: true };

    const first = await service.persist("key-2", ENDPOINT, body, 200);
    const second = await service.persist("key-2", ENDPOINT, body, 200);

    expect(second).toEqual(first);
  });

  it("throws when payload differs for the same key", async () => {
    const service = createInMemoryIdempotencyService();
    await service.persist("key-3", ENDPOINT, { success: true }, 200);

    await expect(
      service.persist("key-3", ENDPOINT, { success: false }, 200),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
