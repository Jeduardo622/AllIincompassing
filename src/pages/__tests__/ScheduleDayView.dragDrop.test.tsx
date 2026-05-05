import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { format } from "date-fns";
import type { Session } from "../../types";
import { createSessionSlotKey } from "../schedule-utils";
import { ScheduleDayView } from "../ScheduleDayView";

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
  dropEffect: "move",
};

describe("ScheduleDayView drag and drop", () => {
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
    const selectedDate = new Date("2025-07-07T00:00:00.000Z");
    const sourceTime = "10:00";
    const targetTime = "10:15";
    const sessionStart = new Date(selectedDate);
    sessionStart.setHours(10, 0, 0, 0);
    const session = buildSession(sessionStart);
    const onRescheduleSession = vi.fn();
    const sourceStart = sessionStart;
    const sourceKey = createSessionSlotKey(format(sourceStart, "yyyy-MM-dd"), format(sourceStart, "HH:mm"));
    const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

    const { container } = render(
      <ScheduleDayView
        selectedDate={selectedDate}
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
      return typeof slotKey === "string" && slotKey.endsWith(`|${targetTime}`);
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

  it("allows dragging a visible session when scheduled status casing drifts", () => {
    const selectedDate = new Date("2025-07-07T00:00:00.000Z");
    const sourceTime = "10:00";
    const targetTime = "10:15";
    const sessionStart = new Date(selectedDate);
    sessionStart.setHours(10, 0, 0, 0);
    const session = buildSession(sessionStart, {
      id: "session-2",
      // @ts-expect-error regression coverage for non-canonical runtime values
      status: " Scheduled ",
      client: { id: "client-2", full_name: "Jorge Eduardo" },
    });
    const onRescheduleSession = vi.fn();
    const sourceKey = createSessionSlotKey(format(sessionStart, "yyyy-MM-dd"), format(sessionStart, "HH:mm"));
    const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

    const { container } = render(
      <ScheduleDayView
        selectedDate={selectedDate}
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
      return typeof slotKey === "string" && slotKey.endsWith(`|${targetTime}`);
    });
    expect(card.getAttribute("draggable")).toBe("true");
    expect(targetSlot).toBeTruthy();

    fireEvent.dragStart(card, { dataTransfer: dragData });
    fireEvent.dragEnter(targetSlot as HTMLElement, { dataTransfer: dragData });
    fireEvent.dragOver(targetSlot as HTMLElement, { dataTransfer: dragData });
    fireEvent.drop(targetSlot as HTMLElement, { dataTransfer: dragData });

    expect(onRescheduleSession).toHaveBeenCalledTimes(1);
    expect(onRescheduleSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-2", status: " Scheduled " }),
      expect.objectContaining({
        time: targetTime,
        date: expect.any(Date),
      }),
    );
  });

  it("keeps canonical non-scheduled statuses non-draggable", () => {
    const selectedDate = new Date("2025-07-07T00:00:00.000Z");
    const sourceTime = "10:00";
    const targetTime = "10:15";
    const sessionStart = new Date(selectedDate);
    sessionStart.setHours(10, 0, 0, 0);
    const session = buildSession(sessionStart, {
      id: "session-completed",
      status: "completed",
      client: { id: "client-3", full_name: "Completed Client" },
    });
    const onRescheduleSession = vi.fn();
    const sourceKey = createSessionSlotKey(format(sessionStart, "yyyy-MM-dd"), format(sessionStart, "HH:mm"));
    const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

    const { container } = render(
      <ScheduleDayView
        selectedDate={selectedDate}
        timeSlots={[sourceTime, targetTime]}
        sessionSlotIndex={sessionSlotIndex}
        onCreateSession={vi.fn()}
        onEditSession={vi.fn()}
        onRescheduleSession={onRescheduleSession}
        allowDragAndDrop
      />,
    );

    const card = container.querySelector('[data-session-id="session-completed"]') as HTMLElement;
    const targetSlot = Array.from(container.querySelectorAll("[data-slot-key]")).find((slot) => {
      const slotKey = slot.getAttribute("data-slot-key");
      return typeof slotKey === "string" && slotKey.endsWith(`|${targetTime}`);
    });
    expect(card.getAttribute("draggable")).toBe("false");
    expect(targetSlot).toBeTruthy();

    fireEvent.dragStart(card, { dataTransfer: dragData });
    fireEvent.dragOver(targetSlot as HTMLElement, { dataTransfer: dragData });
    fireEvent.drop(targetSlot as HTMLElement, { dataTransfer: dragData });

    expect(onRescheduleSession).not.toHaveBeenCalled();
  });

  it("does not invoke onRescheduleSession when dropped on the same day slot", () => {
    const selectedDate = new Date("2025-07-07T00:00:00.000Z");
    const sourceTime = "10:00";
    const sessionStart = new Date(selectedDate);
    sessionStart.setHours(10, 0, 0, 0);
    const session = buildSession(sessionStart);
    const onRescheduleSession = vi.fn();
    const sourceKey = createSessionSlotKey(format(sessionStart, "yyyy-MM-dd"), format(sessionStart, "HH:mm"));
    const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

    const { container } = render(
      <ScheduleDayView
        selectedDate={selectedDate}
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

  it("shows a hover notice and highlights the full visible appointment duration", () => {
    const selectedDate = new Date("2025-07-07T00:00:00.000Z");
    const sessionStart = new Date(selectedDate);
    sessionStart.setHours(10, 0, 0, 0);
    const sessionEnd = new Date(selectedDate);
    sessionEnd.setHours(10, 30, 0, 0);
    const session = buildSession(sessionStart, {
      end_time: sessionEnd.toISOString(),
    });
    const sourceKey = createSessionSlotKey(format(sessionStart, "yyyy-MM-dd"), format(sessionStart, "HH:mm"));
    const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

    const { container, getByRole, queryByRole } = render(
      <ScheduleDayView
        selectedDate={selectedDate}
        timeSlots={["10:00", "10:15", "10:30"]}
        sessionSlotIndex={sessionSlotIndex}
        onCreateSession={vi.fn()}
        onEditSession={vi.fn()}
      />,
    );

    const card = container.querySelector('[data-session-id="session-1"]') as HTMLElement;
    expect(queryByRole("note")).toBeNull();

    fireEvent.mouseEnter(card);

    expect(getByRole("note")).toHaveTextContent("Jamie Client: 10:00 AM - 10:30 AM (30 min)");
    expect(container.querySelectorAll('[data-preview-slot="session-1"]')).toHaveLength(2);

    fireEvent.mouseLeave(card);

    expect(queryByRole("note")).toBeNull();
    expect(container.querySelectorAll('[data-preview-slot="session-1"]')).toHaveLength(0);
  });

  describe("coarse pointer (touch) move path", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query === "(any-pointer: fine)" ? false : query === "(pointer: coarse)",
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("short tap still opens edit via onEditSession", () => {
      const selectedDate = new Date("2025-07-07T00:00:00.000Z");
      const sourceTime = "10:00";
      const sessionStart = new Date(selectedDate);
      sessionStart.setHours(10, 0, 0, 0);
      const session = buildSession(sessionStart);
      const onEditSession = vi.fn();
      const sourceKey = createSessionSlotKey(format(sessionStart, "yyyy-MM-dd"), format(sessionStart, "HH:mm"));
      const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={[sourceTime, "10:15"]}
          sessionSlotIndex={sessionSlotIndex}
          onCreateSession={vi.fn()}
          onEditSession={onEditSession}
          onRescheduleSession={vi.fn()}
          allowDragAndDrop
        />,
      );

      const card = container.querySelector('[data-session-id="session-1"]') as HTMLElement;
      fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      vi.advanceTimersByTime(100);
      fireEvent.pointerUp(card, { button: 0, pointerId: 1 });
      fireEvent.click(card);

      expect(onEditSession).toHaveBeenCalledTimes(1);
      expect(onEditSession).toHaveBeenCalledWith(expect.objectContaining({ id: "session-1" }));
    });

    it("long-press moves a scheduled status variant to a tapped slot", () => {
      const selectedDate = new Date("2025-07-07T00:00:00.000Z");
      const sourceTime = "10:00";
      const targetTime = "10:15";
      const sessionStart = new Date(selectedDate);
      sessionStart.setHours(10, 0, 0, 0);
      const session = buildSession(sessionStart, {
        id: "session-touch",
        // @ts-expect-error regression coverage for non-canonical runtime values
        status: " Scheduled ",
      });
      const onEditSession = vi.fn();
      const onRescheduleSession = vi.fn();
      const sourceKey = createSessionSlotKey(format(sessionStart, "yyyy-MM-dd"), format(sessionStart, "HH:mm"));
      const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={[sourceTime, targetTime]}
          sessionSlotIndex={sessionSlotIndex}
          onCreateSession={vi.fn()}
          onEditSession={onEditSession}
          onRescheduleSession={onRescheduleSession}
          allowDragAndDrop
          allowCreateInEmptySlot={false}
        />,
      );

      const card = container.querySelector('[data-session-id="session-touch"]') as HTMLElement;
      const targetSlot = Array.from(container.querySelectorAll("[data-slot-key]")).find((slot) => {
        const slotKey = slot.getAttribute("data-slot-key");
        return typeof slotKey === "string" && slotKey.endsWith(`|${targetTime}`);
      }) as HTMLElement | undefined;
      expect(targetSlot).toBeTruthy();
      expect(card.getAttribute("draggable")).toBe("false");

      fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      act(() => {
        vi.advanceTimersByTime(480);
      });
      fireEvent.click(targetSlot!);

      expect(onRescheduleSession).toHaveBeenCalledTimes(1);
      expect(onRescheduleSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: "session-touch", status: " Scheduled " }),
        expect.objectContaining({
          time: targetTime,
          date: expect.any(Date),
        }),
      );

      fireEvent.click(card);

      expect(onEditSession).toHaveBeenCalledWith(expect.objectContaining({ id: "session-touch" }));
    });

    it("lets a second tap on the picked-up card cancel coarse-pointer move mode", () => {
      const selectedDate = new Date("2025-07-07T00:00:00.000Z");
      const sourceTime = "10:00";
      const targetTime = "10:15";
      const sessionStart = new Date(selectedDate);
      sessionStart.setHours(10, 0, 0, 0);
      const session = buildSession(sessionStart);
      const onEditSession = vi.fn();
      const onRescheduleSession = vi.fn();
      const sourceKey = createSessionSlotKey(format(sessionStart, "yyyy-MM-dd"), format(sessionStart, "HH:mm"));
      const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={[sourceTime, targetTime]}
          sessionSlotIndex={sessionSlotIndex}
          onCreateSession={vi.fn()}
          onEditSession={onEditSession}
          onRescheduleSession={onRescheduleSession}
          allowDragAndDrop
          allowCreateInEmptySlot={false}
        />,
      );

      const card = container.querySelector('[data-session-id="session-1"]') as HTMLElement;
      const targetSlot = Array.from(container.querySelectorAll("[data-slot-key]")).find((slot) => {
        const slotKey = slot.getAttribute("data-slot-key");
        return typeof slotKey === "string" && slotKey.endsWith(`|${targetTime}`);
      }) as HTMLElement | undefined;
      expect(targetSlot).toBeTruthy();

      fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      act(() => {
        vi.advanceTimersByTime(480);
      });
      fireEvent.pointerUp(card, { button: 0, pointerId: 1 });
      fireEvent.click(card);
      fireEvent.click(card);
      fireEvent.click(targetSlot!);

      expect(onEditSession).not.toHaveBeenCalled();
      expect(onRescheduleSession).not.toHaveBeenCalled();
    });

    it("clears coarse-pointer move mode on pointer cancel after pickup", () => {
      const selectedDate = new Date("2025-07-07T00:00:00.000Z");
      const sourceTime = "10:00";
      const targetTime = "10:15";
      const sessionStart = new Date(selectedDate);
      sessionStart.setHours(10, 0, 0, 0);
      const session = buildSession(sessionStart);
      const onRescheduleSession = vi.fn();
      const sourceKey = createSessionSlotKey(format(sessionStart, "yyyy-MM-dd"), format(sessionStart, "HH:mm"));
      const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={[sourceTime, targetTime]}
          sessionSlotIndex={sessionSlotIndex}
          onCreateSession={vi.fn()}
          onEditSession={vi.fn()}
          onRescheduleSession={onRescheduleSession}
          allowDragAndDrop
          allowCreateInEmptySlot={false}
        />,
      );

      const card = container.querySelector('[data-session-id="session-1"]') as HTMLElement;
      const targetSlot = Array.from(container.querySelectorAll("[data-slot-key]")).find((slot) => {
        const slotKey = slot.getAttribute("data-slot-key");
        return typeof slotKey === "string" && slotKey.endsWith(`|${targetTime}`);
      }) as HTMLElement | undefined;
      expect(targetSlot).toBeTruthy();

      fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      act(() => {
        vi.advanceTimersByTime(480);
      });
      fireEvent.pointerCancel(card, { pointerId: 1 });
      fireEvent.click(targetSlot!);

      expect(onRescheduleSession).not.toHaveBeenCalled();
    });

    it("does not pick up non-scheduled sessions on long-press", () => {
      const selectedDate = new Date("2025-07-07T00:00:00.000Z");
      const sourceTime = "10:00";
      const targetTime = "10:15";
      const sessionStart = new Date(selectedDate);
      sessionStart.setHours(10, 0, 0, 0);
      const session = buildSession(sessionStart, {
        id: "session-cancelled",
        status: "cancelled",
      });
      const onCreateSession = vi.fn();
      const onRescheduleSession = vi.fn();
      const sourceKey = createSessionSlotKey(format(sessionStart, "yyyy-MM-dd"), format(sessionStart, "HH:mm"));
      const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={[sourceTime, targetTime]}
          sessionSlotIndex={sessionSlotIndex}
          onCreateSession={onCreateSession}
          onEditSession={vi.fn()}
          onRescheduleSession={onRescheduleSession}
          allowDragAndDrop
          allowCreateInEmptySlot={false}
        />,
      );

      const card = container.querySelector('[data-session-id="session-cancelled"]') as HTMLElement;
      const targetSlot = Array.from(container.querySelectorAll("[data-slot-key]")).find((slot) => {
        const slotKey = slot.getAttribute("data-slot-key");
        return typeof slotKey === "string" && slotKey.endsWith(`|${targetTime}`);
      }) as HTMLElement | undefined;
      expect(targetSlot).toBeTruthy();

      fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      act(() => {
        vi.advanceTimersByTime(480);
      });
      fireEvent.click(targetSlot!);

      expect(onRescheduleSession).not.toHaveBeenCalled();
      expect(onCreateSession).not.toHaveBeenCalled();
    });

    it("cancels long-press pickup when the pointer moves before the threshold", () => {
      const selectedDate = new Date("2025-07-07T00:00:00.000Z");
      const sourceTime = "10:00";
      const targetTime = "10:15";
      const sessionStart = new Date(selectedDate);
      sessionStart.setHours(10, 0, 0, 0);
      const session = buildSession(sessionStart);
      const onCreateSession = vi.fn();
      const onRescheduleSession = vi.fn();
      const sourceKey = createSessionSlotKey(format(sessionStart, "yyyy-MM-dd"), format(sessionStart, "HH:mm"));
      const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={[sourceTime, targetTime]}
          sessionSlotIndex={sessionSlotIndex}
          onCreateSession={onCreateSession}
          onEditSession={vi.fn()}
          onRescheduleSession={onRescheduleSession}
          allowDragAndDrop
          allowCreateInEmptySlot={false}
        />,
      );

      const card = container.querySelector('[data-session-id="session-1"]') as HTMLElement;
      const targetSlot = Array.from(container.querySelectorAll("[data-slot-key]")).find((slot) => {
        const slotKey = slot.getAttribute("data-slot-key");
        return typeof slotKey === "string" && slotKey.endsWith(`|${targetTime}`);
      }) as HTMLElement | undefined;
      expect(targetSlot).toBeTruthy();

      fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(card, { clientX: 25, clientY: 10, pointerId: 1 });
      act(() => {
        vi.advanceTimersByTime(480);
      });
      fireEvent.click(targetSlot!);

      expect(onRescheduleSession).not.toHaveBeenCalled();
      expect(onCreateSession).not.toHaveBeenCalled();
    });
  });
});
