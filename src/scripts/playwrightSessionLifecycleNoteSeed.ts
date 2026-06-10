type LifecycleSessionRow = {
  sessionId: string;
  organizationId: string;
  clientId: string;
  therapistId: string;
  sessionDate: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number | null;
};

export type LifecycleSessionNoteSeedPayload = {
  authorization_id: string;
  client_id: string;
  created_by: string;
  end_time: string;
  goal_ids: string[];
  goal_notes: Record<string, string>;
  goals_addressed: string[];
  is_locked: boolean;
  narrative: string;
  organization_id: string;
  service_code: string;
  session_date: string;
  session_duration: number;
  session_id: string;
  start_time: string;
  therapist_id: string;
};

const toTimeOnly = (value: string): string => {
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Unable to normalize session note time from "${value}"`);
  }
  return parsed.toISOString().slice(11, 19);
};

const resolveSessionDate = (value: string | null, fallbackStartTime: string): string => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(fallbackStartTime);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Unable to normalize session note date from session start time.");
  }
  return parsed.toISOString().slice(0, 10);
};

const resolveSessionDuration = (
  durationMinutes: number | null,
  startTime: string,
  endTime: string,
): number => {
  if (typeof durationMinutes === "number" && Number.isFinite(durationMinutes) && durationMinutes > 0) {
    return Math.round(durationMinutes);
  }
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error("Unable to derive session note duration from session start/end time.");
  }
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
};

export const buildLifecycleSessionNoteSeedPayload = (input: {
  session: LifecycleSessionRow;
  authorizationId: string;
  serviceCode: string;
  actorUserId: string;
  goalId: string;
  noteText?: string;
  narrative?: string;
}): LifecycleSessionNoteSeedPayload => {
  const noteText = input.noteText?.trim() || "Playwright lifecycle goal note";
  const narrative = input.narrative?.trim() || "Playwright lifecycle seeded session note";

  return {
    authorization_id: input.authorizationId,
    client_id: input.session.clientId,
    created_by: input.actorUserId,
    end_time: toTimeOnly(input.session.endTime),
    goal_ids: [input.goalId],
    goal_notes: { [input.goalId]: noteText },
    goals_addressed: [input.goalId],
    is_locked: false,
    narrative,
    organization_id: input.session.organizationId,
    service_code: input.serviceCode,
    session_date: resolveSessionDate(input.session.sessionDate, input.session.startTime),
    session_duration: resolveSessionDuration(
      input.session.durationMinutes,
      input.session.startTime,
      input.session.endTime,
    ),
    session_id: input.session.sessionId,
    start_time: toTimeOnly(input.session.startTime),
    therapist_id: input.session.therapistId,
  };
};
