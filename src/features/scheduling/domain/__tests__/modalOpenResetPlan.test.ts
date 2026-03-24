import { describe, expect, it } from "vitest";
import { buildScheduleModalOpenResetPlan } from "../modalOpenResetPlan";

describe("modalOpenResetPlan", () => {
  it("builds create-mode plan with time slot set and selected session cleared", () => {
    const timeSlot = {
      date: new Date("2026-03-23T15:30:00.000Z"),
      time: "15:30",
    };

    const plan = buildScheduleModalOpenResetPlan({
      mode: "create",
      timeSlot,
    });

    expect(plan).toEqual({
      retryHint: null,
      pendingAgentIdempotencyKey: null,
      pendingAgentOperationId: null,
      pendingTraceRequestId: null,
      pendingTraceCorrelationId: null,
      selectedTimeSlot: timeSlot,
      selectedSession: undefined,
      isModalOpen: true,
    });
  });

  it("builds edit-mode plan with selected session set and time slot cleared", () => {
    const session = {
      id: "session-1",
      client_id: "client-1",
      therapist_id: "therapist-1",
      status: "scheduled",
    };

    const plan = buildScheduleModalOpenResetPlan({
      mode: "edit",
      session,
    });

    expect(plan).toEqual({
      retryHint: null,
      pendingAgentIdempotencyKey: null,
      pendingAgentOperationId: null,
      pendingTraceRequestId: null,
      pendingTraceCorrelationId: null,
      selectedTimeSlot: undefined,
      selectedSession: session,
      isModalOpen: true,
    });
  });
});
