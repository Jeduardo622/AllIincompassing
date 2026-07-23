import { format, parseISO } from "date-fns";
import type { Session } from "../types";

export type ScheduleLayoutItem =
  | {
      kind: "appointment";
      session: Session;
      topRows: number;
      spanRows: number;
      clippedStart: boolean;
      clippedEnd: boolean;
    }
  | {
      kind: "cluster";
      sessions: Session[];
      topRows: number;
      spanRows: number;
      clippedStart: boolean;
      clippedEnd: boolean;
    };

type LayoutSession = {
  session: Session;
  start: Date;
  end: Date;
  clippedStart: Date;
  clippedEnd: Date;
  clippedAtStart: boolean;
  clippedAtEnd: boolean;
};

type LayoutOptions = {
  gridStartMinutes: number;
  gridEndMinutes: number;
  slotMinutes: number;
};

const DEFAULT_OPTIONS: LayoutOptions = {
  gridStartMinutes: 8 * 60,
  gridEndMinutes: 18 * 60,
  slotMinutes: 15,
};

function setMinutesIntoDay(day: Date, totalMinutes: number): Date {
  const next = new Date(day);
  next.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
  return next;
}

function getClientName(session: Session): string {
  return session.client?.full_name?.trim() || "";
}

function compareSessions(left: LayoutSession, right: LayoutSession): number {
  const startDiff = left.start.getTime() - right.start.getTime();
  if (startDiff !== 0) {
    return startDiff;
  }

  const nameDiff = getClientName(left.session).localeCompare(getClientName(right.session));
  if (nameDiff !== 0) {
    return nameDiff;
  }

  return left.session.id.localeCompare(right.session.id);
}

function toRowOffset(target: Date, gridStart: Date, slotMinutes: number): number {
  return (target.getTime() - gridStart.getTime()) / (slotMinutes * 60_000);
}

export function buildScheduleDayLayout(
  sessions: readonly Session[],
  day: Date,
  options?: { gridStartMinutes?: number; gridEndMinutes?: number; slotMinutes?: number },
): { items: ScheduleLayoutItem[]; invalidSessions: Session[] } {
  const gridStartMinutes = options?.gridStartMinutes ?? DEFAULT_OPTIONS.gridStartMinutes;
  const gridEndMinutes = options?.gridEndMinutes ?? DEFAULT_OPTIONS.gridEndMinutes;
  const slotMinutes = options?.slotMinutes ?? DEFAULT_OPTIONS.slotMinutes;
  const gridStart = setMinutesIntoDay(day, gridStartMinutes);
  const gridEnd = setMinutesIntoDay(day, gridEndMinutes);
  const dayKey = format(day, "yyyy-MM-dd");

  const invalidSessions: Session[] = [];
  const visibleSessions: LayoutSession[] = [];

  for (const session of sessions) {
    const start = parseISO(session.start_time);
    const end = parseISO(session.end_time);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      invalidSessions.push(session);
      continue;
    }

    if (format(start, "yyyy-MM-dd") !== dayKey) {
      continue;
    }

    const clippedStart = start > gridStart ? start : gridStart;
    const clippedEnd = end < gridEnd ? end : gridEnd;

    if (clippedEnd <= clippedStart) {
      continue;
    }

    visibleSessions.push({
      session,
      start,
      end,
      clippedStart,
      clippedEnd,
      clippedAtStart: start < gridStart,
      clippedAtEnd: end > gridEnd,
    });
  }

  visibleSessions.sort(compareSessions);

  const items: ScheduleLayoutItem[] = [];
  let cluster: LayoutSession[] = [];
  let clusterEndMs = Number.NEGATIVE_INFINITY;

  const flushCluster = () => {
    if (cluster.length === 0) {
      return;
    }

    const clusterStart = cluster.reduce(
      (earliest, session) => (session.clippedStart < earliest ? session.clippedStart : earliest),
      cluster[0].clippedStart,
    );
    const clusterEnd = cluster.reduce(
      (latest, session) => (session.clippedEnd > latest ? session.clippedEnd : latest),
      cluster[0].clippedEnd,
    );
    const topRows = toRowOffset(clusterStart, gridStart, slotMinutes);
    const spanRows = toRowOffset(clusterEnd, clusterStart, slotMinutes);
    const clippedStart = cluster.some((session) => session.clippedAtStart);
    const clippedEnd = cluster.some((session) => session.clippedAtEnd);

    if (cluster.length === 1) {
      items.push({
        kind: "appointment",
        session: cluster[0].session,
        topRows,
        spanRows,
        clippedStart,
        clippedEnd,
      });
    } else {
      items.push({
        kind: "cluster",
        sessions: cluster.map((session) => session.session),
        topRows,
        spanRows,
        clippedStart,
        clippedEnd,
      });
    }

    cluster = [];
    clusterEndMs = Number.NEGATIVE_INFINITY;
  };

  for (const session of visibleSessions) {
    if (cluster.length === 0) {
      cluster = [session];
      clusterEndMs = session.end.getTime();
      continue;
    }

    if (session.start.getTime() < clusterEndMs) {
      cluster.push(session);
      clusterEndMs = Math.max(clusterEndMs, session.end.getTime());
      continue;
    }

    flushCluster();
    cluster = [session];
    clusterEndMs = session.end.getTime();
  }

  flushCluster();

  return { items, invalidSessions };
}
