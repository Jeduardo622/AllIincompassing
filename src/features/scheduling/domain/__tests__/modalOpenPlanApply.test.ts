import { describe, expect, it } from "vitest";
import {
  applyScheduleModalOpenPlan,
} from "../modalOpenPlanApply";
import {
  buildScheduleModalOpenResetPlan,
} from "../modalOpenResetPlan";

describe("modalOpenPlanApply", () => {
  it("applies create-mode plan with existing setter order", () => {
    const order: string[] = [];
    const plan = buildScheduleModalOpenResetPlan({
      mode: "create",
      timeSlot: { date: new Date("2026-03-25T10:30:00.000Z"), time: "10:30" },
    });

    applyScheduleModalOpenPlan({
      mode: "create",
      plan,
      setters: {
        setRetryHint: () => order.push("setRetryHint"),
        setPendingAgentIdempotencyKey: () =>
          order.push("setPendingAgentIdempotencyKey"),
        setPendingAgentOperationId: () =>
          order.push("setPendingAgentOperationId"),
        setPendingTraceRequestId: () => order.push("setPendingTraceRequestId"),
        setPendingTraceCorrelationId: () =>
          order.push("setPendingTraceCorrelationId"),
        setSelectedTimeSlot: () => order.push("setSelectedTimeSlot"),
        setSelectedSession: () => order.push("setSelectedSession"),
        setIsModalOpen: () => order.push("setIsModalOpen"),
      },
    });

    expect(order).toEqual([
      "setRetryHint",
      "setPendingAgentIdempotencyKey",
      "setPendingAgentOperationId",
      "setPendingTraceRequestId",
      "setPendingTraceCorrelationId",
      "setSelectedTimeSlot",
      "setSelectedSession",
      "setIsModalOpen",
    ]);
  });

  it("applies edit-mode plan with existing setter order", () => {
    const order: string[] = [];
    const plan = buildScheduleModalOpenResetPlan({
      mode: "edit",
      session: { id: "session-1" },
    });

    applyScheduleModalOpenPlan({
      mode: "edit",
      plan,
      setters: {
        setRetryHint: () => order.push("setRetryHint"),
        setPendingAgentIdempotencyKey: () =>
          order.push("setPendingAgentIdempotencyKey"),
        setPendingAgentOperationId: () =>
          order.push("setPendingAgentOperationId"),
        setPendingTraceRequestId: () => order.push("setPendingTraceRequestId"),
        setPendingTraceCorrelationId: () =>
          order.push("setPendingTraceCorrelationId"),
        setSelectedTimeSlot: () => order.push("setSelectedTimeSlot"),
        setSelectedSession: () => order.push("setSelectedSession"),
        setIsModalOpen: () => order.push("setIsModalOpen"),
      },
    });

    expect(order).toEqual([
      "setRetryHint",
      "setPendingAgentIdempotencyKey",
      "setPendingAgentOperationId",
      "setPendingTraceRequestId",
      "setPendingTraceCorrelationId",
      "setSelectedSession",
      "setSelectedTimeSlot",
      "setIsModalOpen",
    ]);
  });
});
