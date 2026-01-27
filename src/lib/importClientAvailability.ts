const DEFAULT_DAY_START = '06:00';
const DEFAULT_DAY_END = '21:00';

export const DEFAULT_AVAILABILITY_HOURS = {
  monday: { start: null, end: null },
  tuesday: { start: null, end: null },
  wednesday: { start: null, end: null },
  thursday: { start: null, end: null },
  friday: { start: null, end: null },
  saturday: { start: null, end: null },
} as const;

export type AvailabilityDay = keyof typeof DEFAULT_AVAILABILITY_HOURS;

export type AvailabilityHours = Record<AvailabilityDay, { start: string | null; end: string | null }>;

export type ParsedAvailability = {
  start: string;
  end: string;
  warnings: string[];
  heuristicsUsed: boolean;
};

const NON_AVAILABILITY_MARKERS = [
  'n/a',
  'na',
  'no intake',
  'no in take',
  'no intake yet',
  'not in intake',
  'daycare',
  'daycare case',
  'clinic service',
  'waiting on',
  'pending',
  'tbd',
  'depends',
  'depend',
];

const normalizeNamePart = (value: string): string => value.replace(/[^a-zA-Z]/g, '');

export const normalizeClientId = (firstName: string | null, lastName: string | null): string | null => {
  if (!firstName || !lastName) {
    return null;
  }

  const first = normalizeNamePart(firstName).slice(0, 2);
  if (first.length < 2) {
    return null;
  }

  const lastParts = lastName
    .split(/[\s-]+/)
    .map(part => normalizeNamePart(part))
    .filter(part => part.length > 0);

  if (lastParts.length === 0) {
    return null;
  }

  const last = lastParts.map(part => part.slice(0, 2)).join('');
  if (last.length < 2) {
    return null;
  }

  return `${first}${last}`.toUpperCase();
};

const toMinutes = (timeValue: string): number => {
  const [hours, minutes] = timeValue.split(':').map(Number);
  return hours * 60 + minutes;
};

const formatTime = (hours: number, minutes: number): string => {
  const safeHours = Math.min(Math.max(hours, 0), 23);
  const safeMinutes = Math.min(Math.max(minutes, 0), 59);
  return `${safeHours.toString().padStart(2, '0')}:${safeMinutes.toString().padStart(2, '0')}`;
};

const parseTimeToken = (
  token: string,
  fallbackMeridiem?: 'am' | 'pm'
): { time: string; heuristicsUsed: boolean } | null => {
  const match = token.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) {
    return null;
  }

  const rawHours = Number(match[1]);
  const rawMinutes = match[2] ? Number(match[2]) : 0;
  const meridiem = (match[3]?.toLowerCase() as 'am' | 'pm' | undefined) ?? fallbackMeridiem;

  let hours = rawHours;
  let heuristicsUsed = false;

  if (meridiem) {
    heuristicsUsed = meridiem !== match[3]?.toLowerCase();
    hours = rawHours % 12;
    if (meridiem === 'pm') {
      hours += 12;
    }
  } else {
    heuristicsUsed = true;
    if (rawHours === 12) {
      hours = 12;
    } else if (rawHours >= 8 && rawHours <= 11) {
      hours = rawHours;
    } else {
      hours = rawHours + 12;
    }
  }

  return { time: formatTime(hours, rawMinutes), heuristicsUsed };
};

const applyEndAfterStartHeuristic = (
  startTime: string,
  endTime: string
): { time: string; heuristicsUsed: boolean } => {
  const startMinutes = toMinutes(startTime);
  let endMinutes = toMinutes(endTime);
  let heuristicsUsed = false;

  if (endMinutes <= startMinutes) {
    endMinutes += 12 * 60;
    heuristicsUsed = true;
  }

  if (endMinutes > 23 * 60 + 59) {
    endMinutes = 23 * 60 + 59;
  }

  const hours = Math.floor(endMinutes / 60);
  const minutes = endMinutes % 60;
  return { time: formatTime(hours, minutes), heuristicsUsed };
};

const parseTimeRange = (segment: string): ParsedAvailability | null => {
  const cleanSegment = segment.trim();
  if (!cleanSegment) {
    return null;
  }

  const rangeParts = cleanSegment.split(/\s*[-–—]\s*/);
  if (rangeParts.length !== 2) {
    return null;
  }

  const endToken = rangeParts[1];
  const endMeridiem = endToken.match(/\b(am|pm)\b/i)?.[1]?.toLowerCase() as 'am' | 'pm' | undefined;
  const startParsed = parseTimeToken(rangeParts[0], endMeridiem);
  const endParsed = parseTimeToken(endToken);

  if (!startParsed || !endParsed) {
    return null;
  }

  const endAdjusted = applyEndAfterStartHeuristic(startParsed.time, endParsed.time);

  return {
    start: startParsed.time,
    end: endAdjusted.time,
    warnings: [],
    heuristicsUsed: startParsed.heuristicsUsed || endParsed.heuristicsUsed || endAdjusted.heuristicsUsed,
  };
};

const isNonAvailability = (value: string): boolean =>
  NON_AVAILABILITY_MARKERS.some(marker => value.includes(marker));

export const parseAvailabilityCell = (value: string): ParsedAvailability | null => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  const normalized = trimmedValue.toLowerCase().replace(/\s+/g, ' ').trim();
  if (isNonAvailability(normalized)) {
    return null;
  }

  if (normalized.includes('open') || normalized.includes('all day') || normalized.includes('allday')) {
    return {
      start: DEFAULT_DAY_START,
      end: DEFAULT_DAY_END,
      warnings: [],
      heuristicsUsed: false,
    };
  }

  const afterMatch = normalized.match(/^after\s+(.+)$/);
  if (afterMatch) {
    const parsed = parseTimeToken(afterMatch[1]);
    if (!parsed) {
      return null;
    }
    return {
      start: parsed.time,
      end: DEFAULT_DAY_END,
      warnings: ['Interpreted as availability after a given time.'],
      heuristicsUsed: parsed.heuristicsUsed,
    };
  }

  const beforeMatch = normalized.match(/^before\s+(.+)$/);
  if (beforeMatch) {
    const parsed = parseTimeToken(beforeMatch[1]);
    if (!parsed) {
      return null;
    }
    return {
      start: DEFAULT_DAY_START,
      end: parsed.time,
      warnings: ['Interpreted as availability before a given time.'],
      heuristicsUsed: parsed.heuristicsUsed,
    };
  }

  if (normalized.includes('morning')) {
    return {
      start: DEFAULT_DAY_START,
      end: '12:00',
      warnings: ['Interpreted as morning availability.'],
      heuristicsUsed: true,
    };
  }

  if (normalized.includes('afternoon')) {
    return {
      start: '12:00',
      end: '17:00',
      warnings: ['Interpreted as afternoon availability.'],
      heuristicsUsed: true,
    };
  }

  if (normalized.includes('evening')) {
    return {
      start: '17:00',
      end: DEFAULT_DAY_END,
      warnings: ['Interpreted as evening availability.'],
      heuristicsUsed: true,
    };
  }

  const segments = normalized.split(',').map(segment => segment.trim()).filter(Boolean);
  const parsedSegments = segments.map(parseTimeRange).filter(Boolean) as ParsedAvailability[];

  if (parsedSegments.length > 0) {
    const earliest = parsedSegments.reduce((current, next) =>
      toMinutes(next.start) < toMinutes(current.start) ? next : current
    );
    const latest = parsedSegments.reduce((current, next) =>
      toMinutes(next.end) > toMinutes(current.end) ? next : current
    );
    const warnings = parsedSegments.flatMap(segment => segment.warnings);
    if (parsedSegments.length > 1) {
      warnings.push('Multiple ranges merged into a single availability window.');
    }
    return {
      start: earliest.start,
      end: latest.end,
      warnings,
      heuristicsUsed: parsedSegments.some(segment => segment.heuristicsUsed),
    };
  }

  const singleRange = parseTimeRange(normalized);
  if (singleRange) {
    return singleRange;
  }

  const singleTime = parseTimeToken(normalized);
  if (singleTime) {
    return {
      start: singleTime.time,
      end: DEFAULT_DAY_END,
      warnings: ['Interpreted single time as availability after that time.'],
      heuristicsUsed: true,
    };
  }

  return null;
};
