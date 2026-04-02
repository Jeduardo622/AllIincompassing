import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders, screen, userEvent } from "../../test/utils";
import { ChatBot } from "../ChatBot";
import { processMessage } from "../../lib/ai";
import { cancelSessions } from "../../lib/sessionCancellation";
import { useAuth } from "../../lib/authContext";
import { bookSessionViaApi } from "../../features/scheduling/domain/booking";
import { supabase } from "../../lib/supabase";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const defaultScheduleAction = {
  response: "Sure thing",
  action: {
    type: "schedule_session" as const,
    data: {
      therapist_id: "t1",
      client_id: "c1",
      program_id: "program-1",
      goal_id: "goal-1",
      start_time: "2025-03-18T10:00:00Z",
      end_time: "2025-03-18T11:00:00Z",
      location_type: "in_clinic",
    },
  },
};

vi.mock("../../lib/ai", () => ({
  processMessage: vi.fn(),
}));

vi.mock("../../lib/sessionCancellation", () => ({
  cancelSessions: vi.fn(),
}));

vi.mock("../../lib/authContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../features/scheduling/domain/booking", () => ({
  bookSessionViaApi: vi.fn(),
  buildBookSessionApiPayload: vi.fn((session) => ({ session })),
  buildBookingTimeMetadata: vi.fn(() => ({
    startOffsetMinutes: -420,
    endOffsetMinutes: -420,
    timeZone: "America/Los_Angeles",
  })),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

const mockedProcessMessage = vi.mocked(processMessage);
const mockedCancelSessions = vi.mocked(cancelSessions);
const mockedUseAuth = vi.mocked(useAuth);
const mockedBookSessionViaApi = vi.mocked(bookSessionViaApi);
const mockedSupabaseFrom = vi.mocked(supabase.from);

describe("ChatBot scheduling", () => {
  beforeEach(() => {
    mockedProcessMessage.mockReset();
    mockedProcessMessage.mockResolvedValue(defaultScheduleAction);
    mockedCancelSessions.mockReset();
    mockedBookSessionViaApi.mockReset();
    mockedSupabaseFrom.mockReset();
    mockedUseAuth.mockReturnValue({
      session: {
        access_token: "test-jwt",
        user: { id: "user-123" },
      },
      profile: {
        id: "user-123",
        email: "user@example.com",
        role: "admin",
        is_active: true,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      },
    } as unknown as ReturnType<typeof useAuth>);
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  it("dispatches openScheduleModal when scheduling action returned", async () => {
    const handler = vi.fn();
    document.addEventListener("openScheduleModal", handler as EventListener);

    renderWithProviders(<ChatBot />);
    await userEvent.click(document.getElementById("chat-trigger")!);

    const input = screen.getByPlaceholderText(/Type your message/);
    await userEvent.type(input, "schedule a session");
    const sendBtn = screen.getByTestId("send-message");
    await userEvent.click(sendBtn);

    await screen.findByText("Sure thing");

    expect(handler).toHaveBeenCalled();
    expect(mockedProcessMessage).toHaveBeenCalledWith(
      "schedule a session",
      expect.objectContaining({ url: expect.any(String) }),
      { accessToken: "test-jwt" }
    );
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.therapist_id).toBe("t1");
    expect(event.detail.idempotency_key).toEqual(expect.any(String));
    expect(event.detail.agent_operation_id).toEqual(expect.any(String));
    expect(event.detail.trace_request_id).toEqual(expect.any(String));
    expect(event.detail.trace_correlation_id).toEqual(expect.any(String));

    document.removeEventListener("openScheduleModal", handler as EventListener);
  });

  it("stores pending schedule in localStorage", async () => {
    renderWithProviders(<ChatBot />);
    await userEvent.click(document.getElementById("chat-trigger")!);

    const input = screen.getByPlaceholderText(/Type your message/);
    await userEvent.type(input, "schedule a session");
    const sendBtn = screen.getByTestId("send-message");
    await userEvent.click(sendBtn);

    await screen.findByText("Sure thing");

    const stored = window.localStorage.getItem("pendingSchedule");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as Record<string, unknown>;
    expect(parsed.therapist_id).toBe("t1");
    expect(parsed.idempotency_key).toEqual(expect.any(String));
    expect(parsed.agent_operation_id).toEqual(expect.any(String));
    expect(parsed.trace_request_id).toEqual(expect.any(String));
    expect(parsed.trace_correlation_id).toEqual(expect.any(String));
  });

  it("cancels sessions when AI requests cancellation", async () => {
    mockedProcessMessage.mockResolvedValueOnce({
      response: "Absolutely, cancelling now.",
      action: {
        type: "cancel_sessions",
        data: { date: "2025-03-18", reason: "Snow day" },
      },
    });

    mockedCancelSessions.mockResolvedValueOnce({
      cancelledCount: 2,
      alreadyCancelledCount: 1,
      totalCount: 3,
      cancelledSessionIds: ["s1", "s2"],
      alreadyCancelledSessionIds: ["s3"],
      idempotencyKey: "abc",
    });

    renderWithProviders(<ChatBot />);
    await userEvent.click(document.getElementById("chat-trigger")!);

    const input = screen.getByPlaceholderText(/Type your message/);
    await userEvent.type(input, "cancel sessions");
    const sendBtn = screen.getByTestId("send-message");
    await userEvent.click(sendBtn);

    await screen.findByText(/✅ 2 sessions cancelled/);
    expect(mockedCancelSessions).toHaveBeenCalledWith({
      date: "2025-03-18",
      therapistId: undefined,
      reason: "Snow day",
      idempotencyKey: expect.any(String),
      agentOperationId: expect.any(String),
      requestId: expect.any(String),
      correlationId: expect.any(String),
    });
    expect(
      screen.getByText(/Reason noted: Snow day/),
    ).toBeInTheDocument();
  });

  it("notifies when no auth session is present", async () => {
    mockedUseAuth.mockReturnValue({ session: null, profile: null } as unknown as ReturnType<typeof useAuth>);

    renderWithProviders(<ChatBot />);
    await userEvent.click(document.getElementById("chat-trigger")!);

    const input = screen.getByPlaceholderText(/Type your message/);
    await userEvent.type(input, "hello");
    const sendBtn = screen.getByTestId("send-message");
    await userEvent.click(sendBtn);

    await screen.findByText("Please sign in to use the assistant.");
    expect(mockedProcessMessage).not.toHaveBeenCalled();
  });

  it("routes modify_session through booking API path", async () => {
    mockedProcessMessage.mockResolvedValueOnce({
      response: "Updating the session now.",
      action: {
        type: "modify_session",
        data: {
          session_id: "session-123",
          start_time: "2025-03-18T11:00:00Z",
          end_time: "2025-03-18T12:00:00Z",
          notes: "Updated by assistant",
          ignored_field: "should-not-propagate",
        },
      },
    });

    const updateSpy = vi.fn();
    mockedSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "session-123",
          therapist_id: "therapist-1",
          client_id: "client-1",
          program_id: "program-1",
          goal_id: "goal-1",
          start_time: "2025-03-18T10:00:00Z",
          end_time: "2025-03-18T11:00:00Z",
          status: "scheduled",
        },
        error: null,
      }),
      update: updateSpy,
    } as unknown as ReturnType<typeof supabase.from>);

    mockedBookSessionViaApi.mockResolvedValueOnce({
      success: true,
      session: {
        id: "session-123",
        therapist_id: "therapist-1",
        client_id: "client-1",
        program_id: "program-1",
        goal_id: "goal-1",
        start_time: "2025-03-18T11:00:00Z",
        end_time: "2025-03-18T12:00:00Z",
      },
      updatedExisting: true,
    } as never);

    renderWithProviders(<ChatBot />);
    await userEvent.click(document.getElementById("chat-trigger")!);

    const input = screen.getByPlaceholderText(/Type your message/);
    await userEvent.type(input, "move the session by one hour");
    await userEvent.click(screen.getByTestId("send-message"));

    await screen.findByText(/Session has been updated/);

    expect(mockedSupabaseFrom).toHaveBeenCalledWith("sessions");
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mockedBookSessionViaApi).toHaveBeenCalledTimes(1);
    expect(mockedBookSessionViaApi).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          id: "session-123",
          notes: "Updated by assistant",
          start_time: "2025-03-18T11:00:00Z",
          end_time: "2025-03-18T12:00:00Z",
        }),
      }),
      expect.objectContaining({
        idempotencyKey: expect.any(String),
        agentOperationId: expect.any(String),
        requestId: expect.any(String),
        correlationId: expect.any(String),
      }),
    );
    const firstCallPayload = mockedBookSessionViaApi.mock.calls[0]?.[0];
    expect(firstCallPayload?.session).not.toHaveProperty("ignored_field");
  });
});
