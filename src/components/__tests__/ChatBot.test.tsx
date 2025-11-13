import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithProviders, screen, userEvent } from "../../test/utils";
import ChatBot from "../ChatBot";
import { processMessage } from "../../lib/ai";
import { cancelSessions } from "../../lib/sessionCancellation";
import { useAuth } from "../../lib/authContext";

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

const mockedProcessMessage = vi.mocked(processMessage);
const mockedCancelSessions = vi.mocked(cancelSessions);
const mockedUseAuth = vi.mocked(useAuth);

describe("ChatBot scheduling", () => {
  beforeEach(() => {
    mockedProcessMessage.mockReset();
    mockedProcessMessage.mockResolvedValue(defaultScheduleAction);
    mockedCancelSessions.mockReset();
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
    const sendBtn = input
      .closest("form")!
      .querySelector('button[type="submit"]') as HTMLButtonElement;
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

    document.removeEventListener("openScheduleModal", handler as EventListener);
  });

  it("stores pending schedule in localStorage", async () => {
    renderWithProviders(<ChatBot />);
    await userEvent.click(document.getElementById("chat-trigger")!);

    const input = screen.getByPlaceholderText(/Type your message/);
    await userEvent.type(input, "schedule a session");
    const sendBtn = input
      .closest("form")!
      .querySelector('button[type="submit"]') as HTMLButtonElement;
    await userEvent.click(sendBtn);

    await screen.findByText("Sure thing");

    const stored = window.localStorage.getItem("pendingSchedule");
    expect(stored).toEqual(JSON.stringify(defaultScheduleAction.action.data));
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
    const sendBtn = input
      .closest("form")!
      .querySelector('button[type="submit"]') as HTMLButtonElement;
    await userEvent.click(sendBtn);

    await screen.findByText(/✅ 2 sessions cancelled/);
    expect(mockedCancelSessions).toHaveBeenCalledWith({
      date: "2025-03-18",
      therapistId: undefined,
      reason: "Snow day",
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
    const sendBtn = input
      .closest("form")!
      .querySelector('button[type="submit"]') as HTMLButtonElement;
    await userEvent.click(sendBtn);

    await screen.findByText("Please sign in to use the assistant.");
    expect(mockedProcessMessage).not.toHaveBeenCalled();
  });
});
