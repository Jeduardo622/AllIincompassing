export interface UpcomingReportStatusInput {
  readonly today: string;
  readonly clientAuthEndDate?: string | null;
  readonly authorizationEndDates: readonly (string | null | undefined)[];
}

export interface UpcomingReportStatus {
  readonly upcoming: boolean;
  readonly source: "authorization" | "client" | null;
  readonly endDate: string | null;
  readonly daysRemaining: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const diffCalendarDays = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);

export const getUpcomingReportStatus = (input: UpcomingReportStatusInput): UpcomingReportStatus => {
  const today = parseDate(input.today);
  if (!today) {
    return { upcoming: false, source: null, endDate: null, daysRemaining: null };
  }

  const candidates = [
    ...input.authorizationEndDates.map((endDate) => ({ source: "authorization" as const, endDate })),
    { source: "client" as const, endDate: input.clientAuthEndDate },
  ]
    .map((candidate) => {
      const parsed = parseDate(candidate.endDate);
      if (!parsed) {
        return null;
      }
      return {
        source: candidate.source,
        endDate: candidate.endDate as string,
        daysRemaining: diffCalendarDays(today, parsed),
      };
    })
    .filter((candidate): candidate is { source: "authorization" | "client"; endDate: string; daysRemaining: number } =>
      Boolean(candidate) && candidate.daysRemaining >= 0 && candidate.daysRemaining <= 30
    )
    .sort((left, right) => left.daysRemaining - right.daysRemaining);

  const soonest = candidates[0];
  if (!soonest) {
    return { upcoming: false, source: null, endDate: null, daysRemaining: null };
  }

  return {
    upcoming: true,
    source: soonest.source,
    endDate: soonest.endDate,
    daysRemaining: soonest.daysRemaining,
  };
};
