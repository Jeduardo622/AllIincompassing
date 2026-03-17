import { describe, expect, it } from "vitest";
import { bookHandler } from "../../src/server/api/book";
import { dashboardHandler } from "../../src/server/api/dashboard";
import { sessionsStartHandler } from "../../src/server/api/sessions-start";

describe("critical /api error envelope contracts", () => {
  it("returns JSON contract for /api/dashboard method guard", async () => {
    const response = await dashboardHandler(
      new Request("https://example.com/api/dashboard", {
        method: "POST",
      }),
    );

    const payload = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(405);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("validation_error");
    expect(payload.error).toBe("Method not allowed");
    expect(typeof payload.requestId).toBe("string");
  });

  it("returns JSON contract for /api/sessions-start unauthorized path", async () => {
    const response = await sessionsStartHandler(
      new Request("https://example.com/api/sessions-start", {
        method: "POST",
      }),
    );

    const payload = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("unauthorized");
    expect(payload.error).toBe("Missing authorization token");
    expect(typeof payload.requestId).toBe("string");
  });

  it("returns JSON contract for /api/book unauthorized path", async () => {
    const response = await bookHandler(
      new Request("https://example.com/api/book", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );

    const payload = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("unauthorized");
    expect(payload.error).toBe("Missing authorization token");
    expect(typeof payload.requestId).toBe("string");
  });
});
