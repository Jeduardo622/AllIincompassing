import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

const getSlotByTime = (container: HTMLElement, time: string) =>
  Array.from(container.querySelectorAll("[data-slot-key]")).find((slot) => {
    const slotKey = slot.getAttribute("data-slot-key");
    return typeof slotKey === "string" && slotKey.endsWith(`|${time}`);
  }) as HTMLElement | undefined;

describe("ScheduleDayView drag and drop", () => {
  beforeEach(() => {
    installMatchMedia(true);
  });

  afterEach(() => {
    cleanup();
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

  describe("improved appointment layout", () => {
    it("treats an explicit empty scheduleSessions array as authoritative", () => {
      const selectedDate = new Date(2025, 6, 7);
      const session = buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
        id: "fallback-should-not-render",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T10:00:00",
      });
      const sourceKey = createSessionSlotKey("2025-07-07", "09:00");
      const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [session]]]);

      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={["09:00", "09:15"]}
          sessionSlotIndex={sessionSlotIndex}
          scheduleSessions={[]}
          useImprovedAppointmentLayout
          onCreateSession={vi.fn()}
          onEditSession={vi.fn()}
        />,
      );

      expect(container.querySelector('[data-session-id="fallback-should-not-render"]')).toBeNull();
      expect(container.querySelector('[data-layout-kind="appointment"]')).toBeNull();
    });

    it("renders one fractional-duration overlay card, preserves empty-slot create, and shows invalid fallback once", () => {
      const selectedDate = new Date(2025, 6, 7);
      const regularStart = new Date(2025, 6, 7, 9, 7, 0, 0);
      const regularEnd = new Date(2025, 6, 7, 9, 52, 0, 0);
      const regularSession = buildSession(new Date(regularStart), {
        id: "session-fractional",
        start_time: "2025-07-07T09:07:00",
        end_time: "2025-07-07T09:52:00",
      });
      const invalidSession = buildSession(regularStart, {
        id: "session-invalid",
        start_time: "not-a-date",
        end_time: "2025-07-07T09:52:00",
      });
      const sourceKey = createSessionSlotKey(format(regularStart, "yyyy-MM-dd"), format(regularStart, "HH:mm"));
      const onCreateSession = vi.fn();
      const onEditSession = vi.fn();
      const sessionSlotIndex = new Map<string, Session[]>([[sourceKey, [regularSession]]]);

      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={["09:00", "09:15", "09:30", "09:45", "10:00"]}
          sessionSlotIndex={sessionSlotIndex}
          scheduleSessions={[regularSession, invalidSession]}
          useImprovedAppointmentLayout
          onCreateSession={onCreateSession}
          onEditSession={onEditSession}
        />,
      );

      const card = container.querySelector('[data-session-id="session-fractional"]') as HTMLElement;
      const overlay = card.parentElement as HTMLElement;
      expect(card).toBeTruthy();
      expect(container.querySelectorAll('[data-session-id="session-fractional"]')).toHaveLength(1);
      expect(overlay.style.top).not.toBe("");
      expect(overlay.style.height).not.toBe("");
      expect(parseFloat(overlay.style.top)).toBeCloseTo(((9 * 60 + 7) - 8 * 60) / 15 * 40 + 2, 4);
      expect(parseFloat(overlay.style.height)).toBeCloseTo((45 / 15) * 40 - 4, 4);
      expect(card).toHaveTextContent("Jamie Client");
      expect(card).toHaveTextContent("Dr. Myles");
      expect(card).toHaveTextContent("9:07 AM - 9:52 AM");
      expect(screen.getAllByText("Time unavailable")).toHaveLength(1);

      fireEvent.click(getSlotByTime(container, "10:00")!);

      expect(onCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          time: "10:00",
          date: expect.any(Date),
        }),
      );
      expect(onEditSession).not.toHaveBeenCalled();
    });

    it("lets occupied appointment blocks expose a separate create action without breaking edit mode", () => {
      const selectedDate = new Date(2025, 6, 7);
      const session = buildSession(new Date(2025, 6, 7, 9, 0), {
        id: "occupied-contract",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T10:00:00",
      });
      const onCreateSession = vi.fn();
      const onEditSession = vi.fn();
      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={["09:00", "09:15", "09:30", "09:45", "10:00"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={[session]}
          useImprovedAppointmentLayout
          onCreateSession={onCreateSession}
          onEditSession={onEditSession}
          allowCreateInOccupiedSlot
        />,
      );

      const occupiedCreateButton = screen.getByRole("button", {
        name: /add session within occupied block on monday, july 7, 2025 at 9:00 am/i,
      });
      const emptySlot = screen.getByRole("button", { name: /add session.*10:00 am/i });
      expect(within(emptySlot).getByText("+ Add session")).toBeTruthy();
      fireEvent.click(container.querySelector('[data-session-id="occupied-contract"]')!);
      expect(onEditSession).toHaveBeenCalledWith(expect.objectContaining({ id: "occupied-contract" }));
      expect(onCreateSession).not.toHaveBeenCalled();
      fireEvent.click(occupiedCreateButton);
      expect(onCreateSession).toHaveBeenCalledWith(expect.objectContaining({ time: "09:00", date: expect.any(Date) }));
      fireEvent.click(emptySlot);
      expect(onCreateSession).toHaveBeenLastCalledWith(expect.objectContaining({ time: "10:00" }));
    });

    it("keeps a 15-minute appointment inside its visual duration", () => {
      const selectedDate = new Date(2025, 6, 7);
      const session = buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
        id: "session-short-overlay",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T09:15:00",
      });

      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={["09:00", "09:15"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={[session]}
          useImprovedAppointmentLayout
          onCreateSession={vi.fn()}
          onEditSession={vi.fn()}
        />,
      );

      const card = container.querySelector('[data-session-id="session-short-overlay"]') as HTMLElement;
      const overlay = card.parentElement as HTMLElement;
      expect(overlay).toHaveClass("overflow-hidden");
      expect(card).toHaveAttribute("data-layout-density", "compact");
      expect(card).toHaveClass("overflow-hidden");
      expect(card).toHaveTextContent("Jamie Client");
      expect(card).toHaveTextContent("9:00 AM");
      expect(card).not.toHaveTextContent("Dr. Myles");
    });

    it("lets an active fine-pointer move target an occupied appointment period", () => {
      const selectedDate = new Date(2025, 6, 7);
      const moving = buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
        id: "session-moving-overlay",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T10:00:00",
      });
      const occupied = buildSession(new Date(2025, 6, 7, 10, 15, 0, 0), {
        id: "session-occupied-target",
        start_time: "2025-07-07T10:15:00",
        end_time: "2025-07-07T10:45:00",
      });
      const onRescheduleSession = vi.fn();

      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={["09:00", "09:15", "10:15", "10:30"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={[moving, occupied]}
          useImprovedAppointmentLayout
          onCreateSession={vi.fn()}
          onEditSession={vi.fn()}
          onRescheduleSession={onRescheduleSession}
          allowDragAndDrop
        />,
      );

      const movingCard = container.querySelector('[data-session-id="session-moving-overlay"]') as HTMLElement;
      const occupiedCard = container.querySelector('[data-session-id="session-occupied-target"]') as HTMLElement;
      const occupiedOverlay = occupiedCard.parentElement as HTMLElement;
      const targetSlot = getSlotByTime(container, "10:15");
      dragData.getData.mockReturnValueOnce("session-moving-overlay");

      fireEvent.dragStart(movingCard, { dataTransfer: dragData });

      expect(occupiedOverlay).toHaveClass("pointer-events-none");
      fireEvent.dragOver(targetSlot!, { dataTransfer: dragData });
      fireEvent.drop(targetSlot!, { dataTransfer: dragData });

      expect(onRescheduleSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: "session-moving-overlay" }),
        expect.objectContaining({ time: "10:15", date: expect.any(Date) }),
      );
    });

    it("renders a neutral overlap cluster popover with sorted rows, focus management, and edit actions", () => {
      const selectedDate = new Date(2025, 6, 7);
      const sessions = [
        buildSession(new Date(2025, 6, 7, 9, 30, 0, 0), {
          id: "gamma",
          start_time: "2025-07-07T09:30:00",
          end_time: "2025-07-07T10:15:00",
          client: { id: "client-gamma", full_name: "Gamma Client" },
        }),
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "beta",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:45:00",
          client: { id: "client-beta", full_name: "Beta Client" },
        }),
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "alpha",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:30:00",
          client: { id: "client-alpha", full_name: "Alpha Client" },
          therapist: { id: "therapist-alpha", full_name: "Dr. Alpha" },
        }),
      ];
      const onCreateSession = vi.fn();
      const onEditSession = vi.fn();

      render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={["09:00", "09:15", "09:30", "09:45", "10:00", "10:15"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={sessions}
          useImprovedAppointmentLayout
          onCreateSession={onCreateSession}
          onEditSession={onEditSession}
        />,
      );

      const trigger = screen.getByRole("button", { name: /3 appointments/i });
      expect(within(trigger).getByTestId("schedule-overlap-count")).toHaveTextContent("3");
      expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(trigger);
      expect(onCreateSession).not.toHaveBeenCalled();
      expect(onEditSession).not.toHaveBeenCalled();

      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      const dialog = screen.getByRole("dialog", { name: /3 overlapping appointments/i });
      const rows = within(dialog).getAllByRole("button");
      expect(rows).toHaveLength(3);
      expect(rows[0]).toHaveFocus();
      expect(rows[0]).toHaveTextContent("Alpha Client");
      expect(rows[0]).toHaveTextContent("Dr. Alpha");
      expect(rows[0]).toHaveTextContent("9:00 AM - 9:30 AM");
      expect(rows[1]).toHaveTextContent("Beta Client");
      expect(rows[2]).toHaveTextContent("Gamma Client");

      fireEvent.keyDown(rows[0], { key: "Enter" });
      fireEvent.keyDown(rows[1], { key: " " });
      fireEvent.click(rows[2]);

      expect(onEditSession).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "alpha" }));
      expect(onEditSession).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: "beta" }));
      expect(onEditSession).toHaveBeenNthCalledWith(3, expect.objectContaining({ id: "gamma" }));

      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: /3 overlapping appointments/i })).toBeNull();
      expect(trigger).toHaveFocus();

      fireEvent.click(trigger);
      expect(screen.getByRole("dialog", { name: /3 overlapping appointments/i })).toBeTruthy();
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole("dialog", { name: /3 overlapping appointments/i })).toBeNull();
      expect(trigger).toHaveFocus();
    });

    it("announces a clipped cluster by its visible grid range while preserving exact row times", () => {
      const selectedDate = new Date(2025, 6, 7);
      const early = buildSession(new Date(2025, 6, 7, 7, 30, 0, 0), {
        id: "clipped-early",
        start_time: "2025-07-07T07:30:00",
        end_time: "2025-07-07T08:30:00",
        client: { id: "client-early", full_name: "Early Client" },
      });
      const overlap = buildSession(new Date(2025, 6, 7, 8, 15, 0, 0), {
        id: "clipped-overlap",
        start_time: "2025-07-07T08:15:00",
        end_time: "2025-07-07T08:45:00",
        client: { id: "client-overlap", full_name: "Overlap Client" },
      });

      render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={["08:00", "08:15", "08:30", "08:45"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={[early, overlap]}
          useImprovedAppointmentLayout
          onCreateSession={vi.fn()}
          onEditSession={vi.fn()}
        />,
      );

      const trigger = screen.getByRole("button", { name: "2 appointments 8:00 AM to 8:45 AM" });
      fireEvent.click(trigger);

      const dialog = screen.getByRole("dialog", {
        name: "2 overlapping appointments, 8:00 AM to 8:45 AM",
      });
      expect(within(dialog).getByRole("button", { name: /Early Client/i })).toHaveTextContent(
        "7:30 AM - 8:30 AM",
      );
    });

    it("shows normalized display-safe status labels and exact range in the cluster dialog label", () => {
      const selectedDate = new Date(2025, 6, 7);
      const sessions = [
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "scheduled-row",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:15:00",
          status: "scheduled",
          client: { id: "client-scheduled", full_name: "Scheduled Client" },
        }),
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "in-progress-row",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:20:00",
          status: "in_progress",
          client: { id: "client-progress", full_name: "In Progress Client" },
        }),
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "completed-row",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:25:00",
          status: "completed",
          client: { id: "client-completed", full_name: "Completed Client" },
        }),
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "cancelled-row",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:30:00",
          status: "cancelled",
          client: { id: "client-cancelled", full_name: "Cancelled Client" },
        }),
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "no-show-row",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:35:00",
          status: "no-show",
          client: { id: "client-no-show", full_name: "No Show Client" },
        }),
        buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
          id: "drift-row",
          start_time: "2025-07-07T09:00:00",
          end_time: "2025-07-07T09:45:00",
          // @ts-expect-error regression coverage for drift fallback
          status: "drifted-status",
          client: { id: "client-drift", full_name: "Drift Client" },
        }),
      ];

      render(
        <ScheduleDayView
          selectedDate={selectedDate}
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
      expect(rowByClient("Scheduled Client")).toHaveTextContent("scheduled");
      expect(rowByClient("In Progress Client")).toHaveTextContent("in progress");
      expect(rowByClient("Completed Client")).toHaveTextContent("completed");
      expect(rowByClient("Cancelled Client")).toHaveTextContent("cancelled");
      expect(rowByClient("No Show Client")).toHaveTextContent("no show");
      expect(rowByClient("Drift Client")).toHaveTextContent("scheduled");
    });

    it("supports fine-pointer drag on an ordinary overlay card", () => {
      const selectedDate = new Date(2025, 6, 7);
      const session = buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
        id: "session-overlay-drag",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T10:00:00",
      });
      const onRescheduleSession = vi.fn();

      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={["09:00", "09:15", "09:30"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={[session]}
          useImprovedAppointmentLayout
          onCreateSession={vi.fn()}
          onEditSession={vi.fn()}
          onRescheduleSession={onRescheduleSession}
          allowDragAndDrop
        />,
      );

      const card = container.querySelector('[data-session-id="session-overlay-drag"]') as HTMLElement;
      const targetSlot = getSlotByTime(container, "09:15");
      expect(card.getAttribute("draggable")).toBe("true");
      expect(targetSlot).toBeTruthy();

      dragData.getData.mockReturnValueOnce("session-overlay-drag");
      fireEvent.dragStart(card, { dataTransfer: dragData });
      fireEvent.dragEnter(targetSlot!, { dataTransfer: dragData });
      fireEvent.dragOver(targetSlot!, { dataTransfer: dragData });
      fireEvent.drop(targetSlot!, { dataTransfer: dragData });

      expect(onRescheduleSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: "session-overlay-drag" }),
        expect.objectContaining({ time: "09:15", date: expect.any(Date) }),
      );
    });
  });

  describe("coarse pointer (touch) move path", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      installMatchMedia(false);
      installPointerEvent();
    });

    afterEach(() => {
      cleanup();
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("keeps occupied-block creation visible and separate from edit on touch-only devices", () => {
      const selectedDate = new Date(2025, 6, 7);
      const session = buildSession(new Date(2025, 6, 7, 9, 0), {
        id: "occupied-touch-contract",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T10:00:00",
      });
      const onCreateSession = vi.fn();
      const onEditSession = vi.fn();

      render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={["09:00", "09:15", "09:30", "09:45", "10:00"]}
          sessionSlotIndex={new Map()}
          scheduleSessions={[session]}
          useImprovedAppointmentLayout
          onCreateSession={onCreateSession}
          onEditSession={onEditSession}
          onRescheduleSession={vi.fn()}
          allowDragAndDrop
          allowCreateInOccupiedSlot
        />,
      );

      const occupiedCreateButton = screen.getByRole("button", {
        name: /add session within occupied block on monday, july 7, 2025 at 9:00 am/i,
      });
      expect(occupiedCreateButton).toBeVisible();
      expect(occupiedCreateButton.parentElement).not.toHaveClass("opacity-0");
      expect(occupiedCreateButton.parentElement).not.toHaveClass("pointer-events-none");

      fireEvent.click(occupiedCreateButton);

      expect(onCreateSession).toHaveBeenCalledWith(expect.objectContaining({ time: "09:00", date: expect.any(Date) }));
      expect(onEditSession).not.toHaveBeenCalled();
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

      fireEvent.pointerDown(card, {
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
      });
      act(() => {
        fireEvent.pointerMove(card, {
          buttons: 1,
          clientX: 25,
          clientY: 10,
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
        });
      });
      fireEvent.pointerLeave(card, { pointerId: 1, pointerType: "touch", isPrimary: true });
      act(() => {
        vi.advanceTimersByTime(480);
      });
      fireEvent.click(targetSlot!);

      expect(onRescheduleSession).not.toHaveBeenCalled();
      expect(onCreateSession).not.toHaveBeenCalled();
    });

    it("long-presses a cluster popover row and moves that exact session to a tapped slot", () => {
      const selectedDate = new Date(2025, 6, 7);
      const sourceTime = "09:00";
      const targetTime = "09:15";
      const alpha = buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
        id: "cluster-alpha",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T09:30:00",
        client: { id: "client-alpha", full_name: "Alpha Client" },
      });
      const beta = buildSession(new Date(2025, 6, 7, 9, 0, 0, 0), {
        id: "cluster-beta",
        start_time: "2025-07-07T09:00:00",
        end_time: "2025-07-07T09:45:00",
        client: { id: "client-beta", full_name: "Beta Client" },
        therapist: undefined,
      });
      const onRescheduleSession = vi.fn();

      const { container } = render(
        <ScheduleDayView
          selectedDate={selectedDate}
          timeSlots={[sourceTime, targetTime]}
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
      const dialog = screen.getByRole("dialog", { name: /2 overlapping appointments/i });
      const row = within(dialog).getByRole("button", { name: /beta client/i });
      const targetSlot = getSlotByTime(container, targetTime);
      expect(targetSlot).toBeTruthy();

      fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10, pointerId: 1, pointerType: "touch" });
      act(() => {
        vi.advanceTimersByTime(480);
      });
      fireEvent.click(targetSlot!);

      expect(onRescheduleSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: "cluster-beta" }),
        expect.objectContaining({ time: targetTime, date: expect.any(Date) }),
      );
    });
  });
});
