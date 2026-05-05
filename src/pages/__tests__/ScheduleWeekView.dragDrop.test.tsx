import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { format } from "date-fns";
import type { Session } from "../../types";
import { createSessionSlotKey } from "../schedule-utils";
import { ScheduleWeekView } from "../ScheduleWeekView";

const buildSession = (startDate: Date, overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  client_id: "client-1",
  therapist_id: "therapist-1",
  program_id: "program-1",
  goal_id: "goal-1",
  start_time: startDate.toISOString(),
  end_time: new Date(startDate.getTime() + 60 * 60 * 1000).toISOString(),
  status: "scheduled",
  notes: "weekly session",
  created_at: "2025-07-01T00:00:00.000Z",
  created_by: "user-1",
  updated_at: "2025-07-01T00:00:00.000Z",
  updated_by: "user-1",
  client: { id: "client-1", full_name: "Jamie Client" },
  therapist: { id: "therapist-1", full_name: "Dr. Myles" },
  ...overrides,
});

const dragData = {
  setData: vi.fn(),
  getData: vi.fn(() => "session-1"),
  effectAllowed: "move",
};

describe("ScheduleWeekView drag and drop", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(any-pointer: fine)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes onRescheduleSession for a different target slot", () => {
    const sourceDay = new Date("2025-07-07T00:00:00.000Z");
    const targetDay = new Date("2025-07-08T00:00:00.000Z");
    const sourceTime = "10:00";
    const targetTime = "10:15";
    const sessionStart = new Date(sourceDay);
    sessionStart.setHours(10, 0, 0, 0);
    const session = buildSession(sessionStart);
    const onRescheduleSession = vi.fn();
    const sourceStart = sessionStart;
    const sourceKey = createSessionSlotKey(format(sourceStart, "yyyy-MM-dd"), format(sourceStart, "HH:mm"));
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
    const sessionStart = new Date(sourceDay);
    sessionStart.setHours(10, 0, 0, 0);
    const session = buildSession(sessionStart);
    const onRescheduleSession = vi.fn();
    const sourceStart = sessionStart;
    const sourceKey = createSessionSlotKey(format(sourceStart, "yyyy-MM-dd"), format(sourceStart, "HH:mm"));
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

  it("invokes onRescheduleSession when dropping via keyboard", () => {
    const sourceDay = new Date("2025-07-07T00:00:00.000Z");
    const targetDay = new Date("2025-07-08T00:00:00.000Z");
    const sourceTime = "10:00";
    const targetTime = "10:15";
    const sessionStart = new Date(sourceDay);
    sessionStart.setHours(10, 0, 0, 0);
    const session = buildSession(sessionStart);
    const onRescheduleSession = vi.fn();
    const sourceStart = sessionStart;
    const sourceKey = createSessionSlotKey(format(sourceStart, "yyyy-MM-dd"), format(sourceStart, "HH:mm"));
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
    fireEvent.keyDown(targetSlot as HTMLElement, { key: "Enter" });

    expect(onRescheduleSession).toHaveBeenCalledTimes(1);
    expect(onRescheduleSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-1" }),
      expect.objectContaining({
        time: targetTime,
        date: expect.any(Date),
      }),
    );
  });

  it("allows dragging a visible session when scheduled status casing drifts", () => {
    const sourceDay = new Date("2025-07-07T00:00:00.000Z");
    const targetDay = new Date("2025-07-08T00:00:00.000Z");
    const sourceTime = "10:00";
    const targetTime = "10:15";
    const sourceStart = new Date(sourceDay);
    sourceStart.setHours(10, 0, 0, 0);
    const session = buildSession(sourceStart, {
      id: "session-2",
      // @ts-expect-error regression coverage for non-canonical runtime values
      status: "SCHEDULED",
      client: { id: "client-2", full_name: "Calvin Tran" },
    });
    const onRescheduleSession = vi.fn();
    const sourceKey = createSessionSlotKey(format(sourceStart, "yyyy-MM-dd"), format(sourceStart, "HH:mm"));
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

    const card = container.querySelector('[data-session-id="session-2"]') as HTMLElement;
    const targetSlot = Array.from(container.querySelectorAll("[data-slot-key]")).find((slot) => {
      const slotKey = slot.getAttribute("data-slot-key");
      return typeof slotKey === "string" && slotKey !== sourceKey && slotKey.endsWith(`|${targetTime}`);
    });

    expect(card.getAttribute("draggable")).toBe("true");
    expect(targetSlot).toBeTruthy();

    fireEvent.dragStart(card, { dataTransfer: dragData });
    fireEvent.dragEnter(targetSlot as HTMLElement, { dataTransfer: dragData });
    fireEvent.dragOver(targetSlot as HTMLElement, { dataTransfer: dragData });
    fireEvent.drop(targetSlot as HTMLElement, { dataTransfer: dragData });

    expect(onRescheduleSession).toHaveBeenCalledTimes(1);
    expect(onRescheduleSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-2", status: "SCHEDULED" }),
      expect.objectContaining({
        time: targetTime,
        date: expect.any(Date),
      }),
    );
  });

  it("keeps overlapping non-scheduled sessions non-draggable without blocking scheduled siblings", () => {
    const sourceDay = new Date("2025-07-07T00:00:00.000Z");
    const targetDay = new Date("2025-07-08T00:00:00.000Z");
    const sourceTime = "10:00";
    const targetTime = "10:15";
    const sourceStart = new Date(sourceDay);
    sourceStart.setHours(10, 0, 0, 0);
    const scheduledSession = buildSession(sourceStart, {
      id: "session-scheduled",
      client: { id: "client-1", full_name: "Jorge Thorpe" },
    });
    const completedSession = buildSession(sourceStart, {
      id: "session-completed",
      status: "completed",
      client: { id: "client-2", full_name: "Calvin Tran" },
    });
    const onRescheduleSession = vi.fn();
    const sourceKey = createSessionSlotKey(format(sourceStart, "yyyy-MM-dd"), format(sourceStart, "HH:mm"));
    const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [scheduledSession, completedSession]]]);

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

    const scheduledCard = container.querySelector('[data-session-id="session-scheduled"]') as HTMLElement;
    const completedCard = container.querySelector('[data-session-id="session-completed"]') as HTMLElement;
    const targetSlot = Array.from(container.querySelectorAll("[data-slot-key]")).find((slot) => {
      const slotKey = slot.getAttribute("data-slot-key");
      return typeof slotKey === "string" && slotKey !== sourceKey && slotKey.endsWith(`|${targetTime}`);
    });

    expect(scheduledCard.getAttribute("draggable")).toBe("true");
    expect(completedCard.getAttribute("draggable")).toBe("false");
    expect(targetSlot).toBeTruthy();

    fireEvent.dragStart(completedCard, { dataTransfer: dragData });
    fireEvent.dragOver(targetSlot as HTMLElement, { dataTransfer: dragData });
    fireEvent.drop(targetSlot as HTMLElement, { dataTransfer: dragData });
    expect(onRescheduleSession).not.toHaveBeenCalled();

    dragData.getData.mockReturnValueOnce("session-scheduled");
    fireEvent.dragStart(scheduledCard, { dataTransfer: dragData });
    fireEvent.dragOver(targetSlot as HTMLElement, { dataTransfer: dragData });
    fireEvent.drop(targetSlot as HTMLElement, { dataTransfer: dragData });

    expect(onRescheduleSession).toHaveBeenCalledTimes(1);
    expect(onRescheduleSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-scheduled" }),
      expect.objectContaining({ time: targetTime, date: expect.any(Date) }),
    );
  });

  it("shows a focus notice and highlights the full visible duration in the correct day column", () => {
    const sourceDay = new Date("2025-07-07T00:00:00.000Z");
    const targetDay = new Date("2025-07-08T00:00:00.000Z");
    const sourceStart = new Date(sourceDay);
    sourceStart.setHours(10, 0, 0, 0);
    const sourceEnd = new Date(sourceDay);
    sourceEnd.setHours(10, 45, 0, 0);
    const session = buildSession(sourceStart, {
      end_time: sourceEnd.toISOString(),
    });
    const sourceKey = createSessionSlotKey(format(sourceStart, "yyyy-MM-dd"), format(sourceStart, "HH:mm"));
    const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

    const { container, getByRole, queryByRole } = render(
      <ScheduleWeekView
        weekDays={[sourceDay, targetDay]}
        timeSlots={["10:00", "10:15", "10:30", "10:45"]}
        sessionSlotIndex={sessionSlotIndex}
        onCreateSession={vi.fn()}
        onEditSession={vi.fn()}
      />,
    );

    const card = container.querySelector('[data-session-id="session-1"]') as HTMLElement;
    expect(queryByRole("note")).toBeNull();

    fireEvent.focus(card);

    expect(getByRole("note")).toHaveTextContent("Jamie Client: 10:00 AM - 10:45 AM (45 min)");
    const previewSlots = Array.from(container.querySelectorAll('[data-slot-key]')).filter((slot) =>
      slot.querySelector('[data-preview-slot="session-1"]'),
    );
    expect(previewSlots).toHaveLength(3);
    expect(
      new Set(previewSlots.map((slot) => slot.getAttribute("data-slot-key")?.split("|")[0])).size,
    ).toBe(1);

    fireEvent.blur(card);

    expect(queryByRole("note")).toBeNull();
    expect(container.querySelectorAll('[data-preview-slot="session-1"]')).toHaveLength(0);
  });

  it("highlights only the visible overlapping slots when an appointment crosses midnight", () => {
    const sourceDay = new Date(2025, 6, 7);
    const targetDay = new Date(2025, 6, 8);
    const sourceStart = new Date(sourceDay);
    sourceStart.setHours(23, 45, 0, 0);
    const sourceEnd = new Date(targetDay);
    sourceEnd.setHours(0, 15, 0, 0);
    const session = buildSession(sourceStart, {
      end_time: sourceEnd.toISOString(),
    });
    const sourceKey = createSessionSlotKey(format(sourceStart, "yyyy-MM-dd"), format(sourceStart, "HH:mm"));
    const nextVisibleOverlapKey = createSessionSlotKey(format(sourceEnd, "yyyy-MM-dd"), "00:00");
    const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

    const { container, getByRole } = render(
      <ScheduleWeekView
        weekDays={[sourceDay, targetDay]}
        timeSlots={["23:45", "00:00", "00:15"]}
        sessionSlotIndex={sessionSlotIndex}
        onCreateSession={vi.fn()}
        onEditSession={vi.fn()}
      />,
    );

    const card = container.querySelector('[data-session-id="session-1"]') as HTMLElement;

    fireEvent.focus(card);

    expect(getByRole("note")).toHaveTextContent("Jamie Client: 11:45 PM - 12:15 AM (30 min)");
    const previewSlots = Array.from(container.querySelectorAll('[data-slot-key]')).filter((slot) =>
      slot.querySelector('[data-preview-slot="session-1"]'),
    );
    const previewSlotKeys = previewSlots.map((slot) => slot.getAttribute("data-slot-key"));
    expect(previewSlotKeys).toHaveLength(2);
    expect(previewSlotKeys).toEqual(expect.arrayContaining([sourceKey, nextVisibleOverlapKey]));
  });
});
