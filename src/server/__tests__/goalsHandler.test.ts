import { describe, expect, it } from "vitest";
import { goalsHandler } from "../api/goals";

describe("goalsHandler", () => {
  it("returns 401 when authorization header is missing", async () => {
    const response = await goalsHandler(
      new Request("http://localhost/api/goals?program_id=program-1", { method: "GET" }),
    );

    expect(response.status).toBe(401);
  });
});
