import { describe, expect, it } from "vitest";
import { sessionsStartHandler } from "../api/sessions-start";

describe("sessionsStartHandler", () => {
  it("returns 405 for non-POST requests", async () => {
    const response = await sessionsStartHandler(
      new Request("http://localhost/api/sessions-start", { method: "GET" }),
    );

    expect(response.status).toBe(405);
  });

  it("returns 401 when authorization header is missing", async () => {
    const response = await sessionsStartHandler(
      new Request("http://localhost/api/sessions-start", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(401);
  });
});
