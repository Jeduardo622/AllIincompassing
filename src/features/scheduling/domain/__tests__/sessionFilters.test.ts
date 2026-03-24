import { describe, expect, it } from "vitest";
import type { Session } from "../../../../types";
import { filterSessionsBySelectedScope } from "../sessionFilters";

const session = (
  id: string,
  therapistId: string,
  clientId: string,
): Session => {
  return {
    id,
    therapist_id: therapistId,
    client_id: clientId,
  } as Session;
};

describe("sessionFilters", () => {
  const sessions = [
    session("s-1", "t-1", "c-1"),
    session("s-2", "t-1", "c-2"),
    session("s-3", "t-2", "c-1"),
  ];

  it("returns all sessions when no filters are selected", () => {
    const result = filterSessionsBySelectedScope(sessions, {
      selectedTherapistId: null,
      selectedClientId: null,
    });

    expect(result).toEqual(sessions);
  });

  it("filters by therapist only", () => {
    const result = filterSessionsBySelectedScope(sessions, {
      selectedTherapistId: "t-1",
      selectedClientId: null,
    });

    expect(result.map((item) => item.id)).toEqual(["s-1", "s-2"]);
  });

  it("filters by client only", () => {
    const result = filterSessionsBySelectedScope(sessions, {
      selectedTherapistId: null,
      selectedClientId: "c-1",
    });

    expect(result.map((item) => item.id)).toEqual(["s-1", "s-3"]);
  });

  it("filters by therapist and client together", () => {
    const result = filterSessionsBySelectedScope(sessions, {
      selectedTherapistId: "t-1",
      selectedClientId: "c-2",
    });

    expect(result.map((item) => item.id)).toEqual(["s-2"]);
  });

  it("returns empty array for empty input", () => {
    const result = filterSessionsBySelectedScope([], {
      selectedTherapistId: "t-1",
      selectedClientId: "c-1",
    });

    expect(result).toEqual([]);
  });
});
