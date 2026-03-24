import type { Session } from "../../../types";

type SessionScopeFilters = {
  selectedTherapistId: string | null;
  selectedClientId: string | null;
};

export const filterSessionsBySelectedScope = (
  sessions: Session[],
  { selectedTherapistId, selectedClientId }: SessionScopeFilters,
): Session[] => {
  return sessions.filter((session) => {
    const therapistMatches =
      !selectedTherapistId || session.therapist_id === selectedTherapistId;
    const clientMatches =
      !selectedClientId || session.client_id === selectedClientId;
    return therapistMatches && clientMatches;
  });
};
