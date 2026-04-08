import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateSessionNoteCachesAfterSessionWrite } from "../sessionNoteQueryInvalidation";

describe("invalidateSessionNoteCachesAfterSessionWrite", () => {
  it("invalidates session-note-linked and client-session-notes with MISSING_ORG when org is absent", () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    invalidateSessionNoteCachesAfterSessionWrite(queryClient, {
      sessionId: "session-a",
      clientId: "client-b",
      organizationId: null,
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["session-note-linked", "session-a", "MISSING_ORG"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["client-session-notes", "client-b", "MISSING_ORG"],
    });
  });

  it("uses concrete organization id when provided", () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    invalidateSessionNoteCachesAfterSessionWrite(queryClient, {
      sessionId: "session-a",
      clientId: "client-b",
      organizationId: "org-uuid",
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["session-note-linked", "session-a", "org-uuid"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["client-session-notes", "client-b", "org-uuid"],
    });
  });
});
