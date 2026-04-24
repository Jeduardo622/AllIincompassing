import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Session } from "../../types";
import { createSessionSlotKey } from "../schedule-utils";
import { ScheduleWeekView } from "../ScheduleWeekView";

const buildSession = (): Session => ({
  id: "session-1",
  client_id: "client-1",
  therapist_id: "therapist-1",
  program_id: "program-1",
  goal_id: "goal-1",
  start_time: "2025-07-07T10:00:00.000Z",
  end_time: "2025-07-07T11:00:00.000Z",
  status: "scheduled",
  notes: "weekly session",
  created_at: "2025-07-01T00:00:00.000Z",
  created_by: "user-1",
  updated_at: "2025-07-01T00:00:00.000Z",
  updated_by: "user-1",
  client: { id: "client-1", full_name: "Jamie Client" },
  therapist: { id: "therapist-1", full_name: "Dr. Myles" },
});

const dragData = {
  setData: vi.fn(),
  getData: vi.fn(),
  effectAllowed: "move",
};

describe("ScheduleWeekView drag and drop", () => {
  it("invokes onRescheduleSession for a different target slot", () => {
    const sourceDay = new Date("2025-07-07T00:00:00.000Z");
    const targetDay = new Date("2025-07-08T00:00:00.000Z");
    const sourceTime = "10:00";
    const targetTime = "10:15";
    const session = buildSession();
    const onRescheduleSession = vi.fn();
    const sourceKey = createSessionSlotKey(
      `${sourceDay.getFullYear()}-${String(sourceDay.getMonth() + 1).padStart(2, "0")}-${String(sourceDay.getDate()).padStart(2, "0")}`,
      sourceTime,
    );
    const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

    const { container } = render(
      <ScheduleWeekView
        weekDays={[sourceDay, targetDay]}
        timeSlots={[sourceTime, targetTime]}
        sessionSlotIndex={sessionSlotIndex}
        onCreateSession={vi.fn()}
        onEditSession={vi.fn()}
        onRescheduleSession={onRescheduleSession}
        allowDragAndDrop
      />,
    );

    const card = container.querySelector('[data-session-id="session-1"]');
    const targetSlot = Array.from(container.querySelectorAll("[data-slot-key]")).find((slot) => {
      const slotKey = slot.getAttribute("data-slot-key");
      return typeof slotKey === "string" && slotKey !== sourceKey && slotKey.endsWith(`|${targetTime}`);
    });
    expect(card).toBeTruthy();
    expect(targetSlot).toBeTruthy();

    fireEvent.dragStart(card as HTMLElement, { dataTransfer: dragData });
    fireEvent.dragEnter(targetSlot as HTMLElement, { dataTransfer: dragData });
    fireEvent.dragOver(targetSlot as HTMLElement, { dataTransfer: dragData });
    fireEvent.drop(targetSlot as HTMLElement, { dataTransfer: dragData });

    expect(onRescheduleSession).toHaveBeenCalledTimes(1);
    expect(onRescheduleSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-1" }),
      expect.objectContaining({
        time: targetTime,
        date: expect.any(Date),
      }),
    );
  });

  it("does not invoke onRescheduleSession when dropped on same slot", () => {
    const sourceDay = new Date("2025-07-07T00:00:00.000Z");
    const sourceTime = "10:00";
    const session = buildSession();
    const onRescheduleSession = vi.fn();
    const sourceKey = createSessionSlotKey("2025-07-07", sourceTime);
    const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

    const { container } = render(
      <ScheduleWeekView
        weekDays={[sourceDay, new Date("2025-07-08T00:00:00.000Z")]}
        timeSlots={[sourceTime]}
        sessionSlotIndex={sessionSlotIndex}
        onCreateSession={vi.fn()}
        onEditSession={vi.fn()}
        onRescheduleSession={onRescheduleSession}
        allowDragAndDrop
      />,
    );

    const card = container.querySelector('[data-session-id="session-1"]');
    const sourceSlot = container.querySelector(`[data-slot-key="${sourceKey}"]`);
    expect(card).toBeTruthy();
    expect(sourceSlot).toBeTruthy();

    fireEvent.dragStart(card as HTMLElement, { dataTransfer: dragData });
    fireEvent.dragOver(sourceSlot as HTMLElement, { dataTransfer: dragData });
    fireEvent.drop(sourceSlot as HTMLElement, { dataTransfer: dragData });

    expect(onRescheduleSession).not.toHaveBeenCalled();
  });
});
