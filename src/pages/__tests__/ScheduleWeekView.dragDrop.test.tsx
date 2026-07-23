import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const installMatchMedia = (matchesFinePointer: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(any-pointer: fine)" ? matchesFinePointer : !matchesFinePointer && query === "(pointer: coarse)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const installPointerEvent = () => {
  Object.defineProperty(window, "PointerEvent", {
    writable: true,
    configurable: true,
    value: MouseEvent,
  });
};

const getSlotByDayAndTime = (container: HTMLElement, day: Date, time: string) =>
  container.querySelector(`[data-slot-key="${createSessionSlotKey(format(day, "yyyy-MM-dd"), time)}"]`) as
    | HTMLElement
    | null;

describe("ScheduleWeekView drag and drop", () => {
  beforeEach(() => {
    installMatchMedia(true);
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

  describe("improved appointment layout", () => {
    it("treats an explicit empty scheduleSessions array as authoritative", () => {
      const sourceDay = new Date(2025, 6, 7);
      const targetDay = new Date(2025, 6, 8);
      const session = buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
        id: "week-fallback-should-not-render",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T10:00:00",
      });
      const sourceKey = createSessionSlotKey("2025-07-07", "09:00");
      const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

      const { container } = render(
        <ScheduleWeekView
          weekDays={[sourceDay, targetDay]}
          timeSlots={["09:00", "09:15"]}
          sessionSlotIndex={sessionSlotIndex}
          scheduleSessions={[]}
          useImprovedAppointmentLayout
          onCreateSession={vi.fn()}
          onEditSession={vi.fn()}
        />,
      );

      expect(container.querySelector('[data-session-id="week-fallback-should-not-render"]')).toBeNull();
      expect(container.querySelector('[data-layout-kind="appointment"]')).toBeNull();
    });

    it("renders fractional overlays in the correct day column and shows invalid fallback only once", () => {
      const sourceDay = new Date(2025, 6, 7);
      const targetDay = new Date(2025, 6, 8);
      const regularSession = buildSession(new Date(2025, 6, 7, 9, 7, 0, 0), {
        id: "week-fractional",
        start_time: "2025-07-07T09:07:00",
        end_time: "2025-07-07T09:52:00",
      });
      const invalidSession = buildSession(new Date(2025, 6, 7, 9, 7, 0, 0), {
        id: "week-invalid",
        end_time: "2025-07-07T09:52:00",
        start_time: "not-a-date",
      });

      const { container } = render(
        <ScheduleWeekView
          weekDays={[sourceDay, targetDay]}
          timeSlots={["09:00", "09:15", "09:30", "09:45", "10:00"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={[regularSession, invalidSession]}
          useImprovedAppointmentLayout
          onCreateSession={vi.fn()}
          onEditSession={vi.fn()}
        />,
      );

      const card = container.querySelector('[data-session-id="week-fractional"]') as HTMLElement;
      const overlay = card.parentElement as HTMLElement;
      expect(card).toBeTruthy();
      expect(container.querySelectorAll('[data-session-id="week-fractional"]')).toHaveLength(1);
      expect(parseFloat(overlay.style.top)).toBeCloseTo(((9 * 60 + 7) - 8 * 60) / 15 * 40 + 2, 4);
      expect(parseFloat(overlay.style.height)).toBeCloseTo((45 / 15) * 40 - 4, 4);
      expect(card).toHaveTextContent("Jamie Client");
      expect(card).toHaveTextContent("9:07 AM - 9:52 AM");
      expect(screen.getAllByText("Time unavailable")).toHaveLength(1);

      const firstDaySlot = getSlotByDayAndTime(container, sourceDay, "09:15");
      const secondDaySlot = getSlotByDayAndTime(container, targetDay, "09:15");
      expect(firstDaySlot?.querySelector('[data-preview-slot="week-fractional"]')).toBeNull();
      expect(secondDaySlot?.querySelector('[data-session-id="week-fractional"]')).toBeNull();
    });

    it("keeps a 15-minute appointment compact within its week column", () => {
      const sourceDay = new Date(2025, 6, 7);
      const targetDay = new Date(2025, 6, 8);
      const session = buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
        id: "week-short-overlay",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T09:15:00",
      });

      const { container } = render(
        <ScheduleWeekView
          weekDays={[sourceDay, targetDay]}
          timeSlots={["09:00", "09:15"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={[session]}
          useImprovedAppointmentLayout
          onCreateSession={vi.fn()}
          onEditSession={vi.fn()}
        />,
      );

      const card = container.querySelector('[data-session-id="week-short-overlay"]') as HTMLElement;
      expect(card.parentElement).toHaveClass("overflow-hidden");
      expect(card).toHaveAttribute("data-layout-density", "compact");
      expect(card).toHaveClass("overflow-hidden");
      expect(card).toHaveTextContent("Jamie Client");
      expect(card).toHaveTextContent("9:00 AM");
      expect(card).not.toHaveTextContent("Dr. Myles");
    });

    it("opens a neutral cluster popover, sorts rows, and restores focus on escape", () => {
      const sourceDay = new Date(2025, 6, 7);
      const targetDay = new Date(2025, 6, 8);
      const alpha = buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
        id: "week-alpha",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T09:30:00",
        client: { id: "client-alpha", full_name: "Alpha Client" },
      });
      const beta = buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
        id: "week-beta",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T09:45:00",
        client: { id: "client-beta", full_name: "Beta Client" },
      });
      const gamma = buildSession(new Date(2025, 6, 7, 9, 30, 0, 0), {
        id: "week-gamma",
        start_time: "2025-07-07T09:30:00",
        end_time: "2025-07-07T10:15:00",
        client: { id: "client-gamma", full_name: "Gamma Client" },
      });
      const onEditSession = vi.fn();

      render(
        <ScheduleWeekView
          weekDays={[sourceDay, targetDay]}
          timeSlots={["09:00", "09:15", "09:30", "09:45", "10:00", "10:15"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={[gamma, beta, alpha]}
          useImprovedAppointmentLayout
          onCreateSession={vi.fn()}
          onEditSession={onEditSession}
        />,
      );

      const trigger = screen.getByRole("button", { name: /3 appointments/i });
      fireEvent.click(trigger);

      const dialog = screen.getByRole("dialog", { name: /3 overlapping appointments/i });
      const rows = within(dialog).getAllByRole("button");
      expect(rows[0]).toHaveFocus();
      expect(rows[0]).toHaveTextContent("Alpha Client");
      expect(rows[1]).toHaveTextContent("Beta Client");
      expect(rows[2]).toHaveTextContent("Gamma Client");

      fireEvent.keyDown(rows[0], { key: "Enter" });
      fireEvent.keyDown(rows[1], { key: " " });
      fireEvent.click(rows[2]);
      expect(onEditSession).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "week-alpha" }));
      expect(onEditSession).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: "week-beta" }));
      expect(onEditSession).toHaveBeenNthCalledWith(3, expect.objectContaining({ id: "week-gamma" }));

      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: /3 overlapping appointments/i })).toBeNull();
      expect(trigger).toHaveFocus();

      fireEvent.click(trigger);
      expect(screen.getByRole("dialog", { name: /3 overlapping appointments/i })).toBeTruthy();
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole("dialog", { name: /3 overlapping appointments/i })).toBeNull();
      expect(trigger).toHaveFocus();
    });

    it("shows normalized display-safe status labels and exact range in the week cluster dialog label", () => {
      const sourceDay = new Date(2025, 6, 7);
      const targetDay = new Date(2025, 6, 8);
      const sessions = [
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "week-scheduled-row",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:15:00",
          status: "scheduled",
          client: { id: "client-week-scheduled", full_name: "Week Scheduled Client" },
        }),
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "week-in-progress-row",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:20:00",
          status: "in_progress",
          client: { id: "client-week-progress", full_name: "Week In Progress Client" },
        }),
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "week-completed-row",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:25:00",
          status: "completed",
          client: { id: "client-week-completed", full_name: "Week Completed Client" },
        }),
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "week-cancelled-row",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:30:00",
          status: "cancelled",
          client: { id: "client-week-cancelled", full_name: "Week Cancelled Client" },
        }),
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "week-no-show-row",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:35:00",
          status: "no-show",
          client: { id: "client-week-no-show", full_name: "Week No Show Client" },
        }),
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "week-drift-row",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:45:00",
          // @ts-expect-error regression coverage for drift fallback
          status: "drifted-status",
          client: { id: "client-week-drift", full_name: "Week Drift Client" },
        }),
      ];

      render(
        <ScheduleWeekView
          weekDays={[sourceDay, targetDay]}
          timeSlots={["09:00", "09:15", "09:30", "09:45"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={sessions}
          useImprovedAppointmentLayout
          onCreateSession={vi.fn()}
          onEditSession={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /6 appointments/i }));

      const dialog = screen.getByRole("dialog", {
        name: "6 overlapping appointments, 9:00 AM to 9:45 AM",
      });
      const rows = within(dialog).getAllByRole("button");
      const rowByClient = (clientName: string) => rows.find((row) => row.textContent?.includes(clientName));
      expect(rowByClient("Week Scheduled Client")).toHaveTextContent("scheduled");
      expect(rowByClient("Week In Progress Client")).toHaveTextContent("in progress");
      expect(rowByClient("Week Completed Client")).toHaveTextContent("completed");
      expect(rowByClient("Week Cancelled Client")).toHaveTextContent("cancelled");
      expect(rowByClient("Week No Show Client")).toHaveTextContent("no show");
      expect(rowByClient("Week Drift Client")).toHaveTextContent("scheduled");
    });

    it("supports fine-pointer drag from an overlay card and from a cluster popover row", () => {
      const sourceDay = new Date(2025, 6, 7);
      const targetDay = new Date(2025, 6, 8);
      const ordinary = buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
        id: "week-ordinary",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T10:00:00",
      });
      const alpha = buildSession(new Date(2025, 6, 7, 10, 0, 0, 0), {
        id: "week-cluster-alpha",
        start_time: "2025-07-07T10:00:00",
        end_time: "2025-07-07T10:30:00",
        client: { id: "client-alpha", full_name: "Alpha Client" },
      });
      const beta = buildSession(new Date(2025, 6, 7, 10, 0, 0, 0), {
        id: "week-cluster-beta",
        start_time: "2025-07-07T10:00:00",
        end_time: "2025-07-07T10:45:00",
        client: { id: "client-beta", full_name: "Beta Client" },
      });
      const onRescheduleSession = vi.fn();

      const { container } = render(
        <ScheduleWeekView
          weekDays={[sourceDay, targetDay]}
          timeSlots={["09:00", "09:15", "10:00", "10:15"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={[ordinary, alpha, beta]}
          useImprovedAppointmentLayout
          onCreateSession={vi.fn()}
          onEditSession={vi.fn()}
          onRescheduleSession={onRescheduleSession}
          allowDragAndDrop
          allowCreateInEmptySlot={false}
        />,
      );

      const ordinaryCard = container.querySelector('[data-session-id="week-ordinary"]') as HTMLElement;
      const ordinaryTarget = getSlotByDayAndTime(container, targetDay, "09:15");
      expect(ordinaryCard.getAttribute("draggable")).toBe("true");
      dragData.getData.mockReturnValueOnce("week-ordinary");
      fireEvent.dragStart(ordinaryCard, { dataTransfer: dragData });
      fireEvent.dragOver(ordinaryTarget!, { dataTransfer: dragData });
      fireEvent.drop(ordinaryTarget!, { dataTransfer: dragData });

      fireEvent.click(screen.getByRole("button", { name: /2 appointments/i }));
      const clusterDialog = screen.getByRole("dialog", { name: /2 overlapping appointments/i });
      const clusterRow = within(clusterDialog).getByRole("button", { name: /beta client/i });
      const clusterTarget = getSlotByDayAndTime(container, targetDay, "10:15");
      dragData.getData.mockReturnValueOnce("week-cluster-beta");
      fireEvent.dragStart(clusterRow, { dataTransfer: dragData });
      fireEvent.dragOver(clusterTarget!, { dataTransfer: dragData });
      fireEvent.drop(clusterTarget!, { dataTransfer: dragData });

      expect(onRescheduleSession).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ id: "week-ordinary" }),
        expect.objectContaining({ time: "09:15", date: expect.any(Date) }),
      );
      expect(onRescheduleSession).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ id: "week-cluster-beta" }),
        expect.objectContaining({ time: "10:15", date: expect.any(Date) }),
      );
    });
  });

  describe("improved layout coarse-pointer move path", () => {
    beforeEach(() => {
      installMatchMedia(false);
      installPointerEvent();
    });

    it("long-presses a cluster row for 480ms and reschedules it by slot tap in week view", async () => {
      const sourceDay = new Date(2025, 6, 7);
      const targetDay = new Date(2025, 6, 8);
      const alpha = buildSession(new Date(2025, 6, 7, 10, 0, 0, 0), {
        id: "touch-alpha",
        start_time: "2025-07-07T10:00:00",
        end_time: "2025-07-07T10:30:00",
        client: { id: "client-alpha", full_name: "Alpha Client" },
      });
      const beta = buildSession(new Date(2025, 6, 7, 10, 0, 0, 0), {
        id: "touch-beta",
        start_time: "2025-07-07T10:00:00",
        end_time: "2025-07-07T10:45:00",
        client: { id: "client-beta", full_name: "Beta Client" },
      });
      const onRescheduleSession = vi.fn();

      const { container } = render(
        <ScheduleWeekView
          weekDays={[sourceDay, targetDay]}
          timeSlots={["10:00", "10:15"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={[alpha, beta]}
          useImprovedAppointmentLayout
          onCreateSession={vi.fn()}
          onEditSession={vi.fn()}
          onRescheduleSession={onRescheduleSession}
          allowDragAndDrop
          allowCreateInEmptySlot={false}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /2 appointments/i }));
      const dialog = screen.getByRole("dialog", {
        name: "2 overlapping appointments, 10:00 AM to 10:45 AM",
      });
      const row = within(dialog).getByRole("button", { name: /beta client/i });
      const targetSlot = getSlotByDayAndTime(container, sourceDay, "10:15");
      expect(targetSlot).toBeTruthy();
      expect(row).toHaveAttribute("title", expect.stringContaining("Press and hold"));
      expect(row).toHaveAttribute("draggable", "false");

      fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "touch" });
      await waitFor(() => {
        const activeDialog = screen.getByRole("dialog", {
          name: "2 overlapping appointments, 10:00 AM to 10:45 AM",
        });
        expect(within(activeDialog).getByRole("button", { name: /beta client/i })).toHaveAttribute(
          "aria-grabbed",
          "true",
        );
      });
      expect(row.closest('[data-layout-kind="cluster"]')).toHaveClass("pointer-events-none");
      expect(row).toHaveClass("pointer-events-auto");
      fireEvent.click(targetSlot!);

      expect(onRescheduleSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: "touch-beta" }),
        expect.objectContaining({ time: "10:15", date: expect.any(Date) }),
      );
    });
  });
});
