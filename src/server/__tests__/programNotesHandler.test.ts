import { describe, expect, it } from "vitest";
import { programNotesHandler } from "../api/program-notes";

describe("programNotesHandler", () => {
  it("returns 401 when authorization header is missing", async () => {
    const response = await programNotesHandler(
      new Request("http://localhost/api/program-notes?program_id=program-1", { method: "GET" }),
    );

    expect(response.status).toBe(401);
  });
});
