import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidates React Query caches used when hydrating clinical session notes:
 * - SessionModal: `['session-note-linked', sessionId, orgKey]`
 * - ClientDetails SessionNotesTab: `['client-session-notes', clientId, orgKey]`
 *
 * `orgKey` must match `activeOrganizationId ?? 'MISSING_ORG'` where those queries are built.
 */
export function invalidateSessionNoteCachesAfterSessionWrite(
  queryClient: QueryClient,
  params: { sessionId: string; clientId: string; organizationId: string | null | undefined },
): void {
  const orgKey = params.organizationId ?? "MISSING_ORG";
  void queryClient.invalidateQueries({
    queryKey: ["session-note-linked", params.sessionId, orgKey],
  });
  void queryClient.invalidateQueries({
    queryKey: ["client-session-notes", params.clientId, orgKey],
  });
}
