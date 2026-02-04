import { describe, expect, it } from "vitest";
import { programsHandler } from "../api/programs";

describe("programsHandler", () => {
  it("returns 401 when authorization header is missing", async () => {
    const response = await programsHandler(
      new Request("http://localhost/api/programs?client_id=client-1", { method: "GET" }),
    );

    expect(response.status).toBe(401);
  });
});
