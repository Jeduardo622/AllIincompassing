import { describe, expect, it } from "vitest";
import type { Client, Session, Therapist } from "../../../../types";
import { buildScheduleDisplayData } from "../displayData";

const session = (id: string): Session => ({ id } as Session);
const therapist = (id: string): Therapist => ({ id } as Therapist);
const client = (id: string): Client => ({ id } as Client);

describe("displayData", () => {
  it("prefers filtered batched sessions when available", () => {
    const filtered = [session("filtered-1")];
    const fallback = [session("fallback-1")];

    const result = buildScheduleDisplayData({
      filteredBatchedSessions: filtered,
      fallbackSessions: fallback,
      batchedData: undefined,
      dropdownData: undefined,
    });

    expect(result.sessions).toEqual(filtered);
  });

  it("falls back to query sessions when filtered batched sessions are null", () => {
    const fallback = [session("fallback-1")];

    const result = buildScheduleDisplayData({
      filteredBatchedSessions: null,
      fallbackSessions: fallback,
      batchedData: undefined,
      dropdownData: undefined,
    });

    expect(result.sessions).toEqual(fallback);
  });

  it("keeps empty filtered batched sessions instead of fallback sessions", () => {
    const fallback = [session("fallback-1")];

    const result = buildScheduleDisplayData({
      filteredBatchedSessions: [],
      fallbackSessions: fallback,
      batchedData: undefined,
      dropdownData: undefined,
    });

    expect(result.sessions).toEqual([]);
  });

  it("uses batched therapists and clients before dropdown values", () => {
    const batchedTherapists = [therapist("t-batch")];
    const batchedClients = [client("c-batch")];

    const result = buildScheduleDisplayData({
      filteredBatchedSessions: null,
      fallbackSessions: [],
      batchedData: {
        therapists: batchedTherapists,
        clients: batchedClients,
      },
      dropdownData: {
        therapists: [therapist("t-drop")],
        clients: [client("c-drop")],
      },
    });

    expect(result.therapists).toEqual(batchedTherapists);
    expect(result.clients).toEqual(batchedClients);
  });

  it("falls back to dropdown values when batched entities are unavailable", () => {
    const dropdownTherapists = [therapist("t-drop")];
    const dropdownClients = [client("c-drop")];

    const result = buildScheduleDisplayData({
      filteredBatchedSessions: null,
      fallbackSessions: [],
      batchedData: undefined,
      dropdownData: {
        therapists: dropdownTherapists,
        clients: dropdownClients,
      },
    });

    expect(result.therapists).toEqual(dropdownTherapists);
    expect(result.clients).toEqual(dropdownClients);
  });

  it("filters malformed rows without string ids from sessions and directory lists", () => {
    const result = buildScheduleDisplayData({
      filteredBatchedSessions: [session("s-valid"), undefined as unknown as Session],
      fallbackSessions: [undefined as unknown as Session, session("s-fallback")],
      batchedData: {
        therapists: [therapist("t-valid"), null as unknown as Therapist, { id: "" } as Therapist],
        clients: [client("c-valid"), { id: 42 } as unknown as Client],
      },
      dropdownData: undefined,
    });

    expect(result.sessions).toEqual([session("s-valid")]);
    expect(result.therapists).toEqual([therapist("t-valid")]);
    expect(result.clients).toEqual([client("c-valid")]);
  });
});
