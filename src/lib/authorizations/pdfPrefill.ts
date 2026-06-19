export type AuthorizationPdfStatus = 'approved' | 'pending' | 'denied';

export interface AuthorizationPdfPrefillService {
  serviceCode: string;
  requestedUnits?: number;
  approvedUnits?: number;
}

export interface AuthorizationPdfPrefill {
  authorizationNumber?: string;
  status?: AuthorizationPdfStatus;
  startDate?: string;
  endDate?: string;
  diagnosisCode?: string;
  diagnosisDescription?: string;
  memberId?: string;
  services: AuthorizationPdfPrefillService[];
}

export interface AuthorizationPdfMergeInput {
  authorizationNumber: string;
  status: AuthorizationPdfStatus;
  startDate: string;
  endDate: string;
  diagnosisCode: string;
  diagnosisDescription: string;
  memberId: string;
  services: string[];
  units: Record<string, number>;
}

export interface AuthorizationPdfMergeResult<T extends AuthorizationPdfMergeInput> {
  data: T;
  appliedFields: string[];
  skippedServiceCodes: string[];
}

export interface AuthorizationPdfMergeOptions {
  statusFieldIsDefault?: boolean;
}

const DATE_PATTERN = String.raw`(?:\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})`;
const SERVICE_CODE_PATTERN = /\b(?:97(?:153|155|156|158)|0362T|0373T|H\d{4}|[A-Z]\d{4})\b/g;

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const isRealCalendarDate = (year: number, month: number, day: number): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const normalizeDate = (value: string): string | undefined => {
  const raw = value.trim();
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!isRealCalendarDate(year, month, day)) {
      return undefined;
    }

    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  const dateMatch = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(raw);
  if (!dateMatch) {
    return undefined;
  }

  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]);
  if (year < 2000 || !isRealCalendarDate(year, month, day)) {
    return undefined;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const firstMatch = (text: string, patterns: RegExp[]): string | undefined => {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    pattern.lastIndex = 0;
    const value = match?.[1]?.trim();
    if (value) {
      return collapseWhitespace(value);
    }
  }
  return undefined;
};

const parseStatus = (text: string): AuthorizationPdfStatus | undefined => {
  const explicitStatus =
    /\b(?:status|decision)\s*(?:is\s+|:\s*)?(approved|pending|denied|requested)\b/i.exec(text) ??
    /\b(approved|pending|denied|requested)\s+(?:status|decision)\b/i.exec(text);
  const value = explicitStatus?.[1]?.toLowerCase();
  if (value === 'denied') return 'denied';
  if (value === 'approved') return 'approved';
  if (value === 'pending' || value === 'requested') return 'pending';
  return undefined;
};

const parseDates = (text: string): Pick<AuthorizationPdfPrefill, 'startDate' | 'endDate'> => {
  const serviceRange = new RegExp(
    `(?:service\\s*)?(?:from|start)\\s*:?\\s*(${DATE_PATTERN})[\\s\\S]{0,80}?(?:to|end)\\s*:?\\s*(${DATE_PATTERN})`,
    'i',
  ).exec(text);
  if (serviceRange) {
    return {
      startDate: normalizeDate(serviceRange[1]),
      endDate: normalizeDate(serviceRange[2]),
    };
  }

  const compactRange = new RegExp(
    `(${DATE_PATTERN})\\s*(?:-|to|through|\\s+)\\s*(${DATE_PATTERN})`,
    'i',
  ).exec(text);
  if (compactRange) {
    return {
      startDate: normalizeDate(compactRange[1]),
      endDate: normalizeDate(compactRange[2]),
    };
  }

  return {};
};

const parseDiagnosis = (
  text: string,
): Pick<AuthorizationPdfPrefill, 'diagnosisCode' | 'diagnosisDescription'> => {
  const match =
    /\b(?:diagnosis|icd-?10(?: code)?)\s*:?\s*([A-Z]\d{2}(?:\.\d+)?)\s*(?:-|:)?\s*([A-Za-z][^\n\r]{2,80})?/i.exec(
      text,
    );
  if (!match) {
    return {};
  }

  return {
    diagnosisCode: match[1].toUpperCase(),
    diagnosisDescription: match[2] ? collapseWhitespace(match[2]) : undefined,
  };
};

const parseLabeledUnits = (text: string, label: 'requested' | 'approved'): number | undefined => {
  const match = new RegExp(`\\b${label}(?:\\s+units)?\\s*:?\\s*(\\d+)`, 'i').exec(text);
  return match ? Number(match[1]) : undefined;
};

const parseServices = (text: string): AuthorizationPdfPrefillService[] => {
  const services = new Map<string, AuthorizationPdfPrefillService>();
  const lines = text.split(/\r?\n/).map(collapseWhitespace).filter(Boolean);
  const globalRequestedUnits = parseLabeledUnits(text, 'requested');
  const globalApprovedUnits = parseLabeledUnits(text, 'approved');

  for (const line of lines) {
    const codes = [...line.matchAll(SERVICE_CODE_PATTERN)].map((match) => match[0].toUpperCase());
    for (const serviceCode of codes) {
      const existing = services.get(serviceCode) ?? { serviceCode };
      const requestedUnits = parseLabeledUnits(line, 'requested') ?? existing.requestedUnits;
      const approvedUnits = parseLabeledUnits(line, 'approved') ?? existing.approvedUnits;
      const compactUnits = parseCompactServiceRowUnits(line);

      services.set(serviceCode, {
        serviceCode,
        requestedUnits: requestedUnits ?? compactUnits?.requestedUnits,
        approvedUnits: approvedUnits ?? compactUnits?.approvedUnits,
      });
    }
  }

  if (services.size === 1) {
    const [service] = services.values();
    service.requestedUnits ??= globalRequestedUnits;
    service.approvedUnits ??= globalApprovedUnits;
  }

  return [...services.values()];
};

const parseCompactServiceRowUnits = (
  line: string,
): Pick<AuthorizationPdfPrefillService, 'requestedUnits' | 'approvedUnits'> | undefined => {
  const withoutDates = line.replace(new RegExp(DATE_PATTERN, 'g'), ' ');
  const numbers = withoutDates.match(/\b\d+\b/g)?.map(Number).filter((value) => value > 0) ?? [];
  if (numbers.length < 3) {
    return undefined;
  }

  return {
    requestedUnits: numbers.at(-2),
    approvedUnits: numbers.at(-1),
  };
};

export const parseAuthorizationPdfText = (text: string): AuthorizationPdfPrefill => {
  const normalizedText = text.replace(/\u00a0/g, ' ');
  const authorizationNumber = firstMatch(normalizedText, [
    /\b(?:authorization|auth)\s*(?:(?:#|number)\s*:?\s*|no\.?(?:\s+|:\s*)|:\s*)([A-Z0-9][A-Z0-9-]{3,})/i,
    /\breferral\s*(?:id|#|number)?\s*:?\s*([A-Z0-9][A-Z0-9-]{3,})/i,
  ]);
  const memberId = firstMatch(normalizedText, [
    /\bmember\s*(?:id|#|number)?\s*:?\s*([A-Z0-9][A-Z0-9-]{2,})/i,
    /\bcin\s*:?\s*([A-Z0-9][A-Z0-9-]{2,})/i,
  ]);

  return stripUndefined({
    authorizationNumber,
    status: parseStatus(normalizedText),
    memberId,
    ...parseDiagnosis(normalizedText),
    ...parseDates(normalizedText),
    services: parseServices(normalizedText),
  });
};

export const mergeAuthorizationPdfPrefill = <T extends AuthorizationPdfMergeInput>(
  current: T,
  prefill: AuthorizationPdfPrefill,
  serviceCatalog: Record<string, string>,
  options: AuthorizationPdfMergeOptions = {},
): AuthorizationPdfMergeResult<T> => {
  const next: T = {
    ...current,
    services: [...current.services],
    units: { ...current.units },
  };
  const appliedFields = new Set<string>();
  const skippedServiceCodes = new Set<string>();

  const fillIfBlank = <K extends keyof T>(field: K, value: T[K] | undefined) => {
    if (!next[field] && value) {
      next[field] = value;
      appliedFields.add(String(field));
    }
  };

  fillIfBlank('authorizationNumber', prefill.authorizationNumber as T['authorizationNumber']);
  fillIfBlank('startDate', prefill.startDate as T['startDate']);
  fillIfBlank('endDate', prefill.endDate as T['endDate']);
  fillIfBlank('diagnosisCode', prefill.diagnosisCode as T['diagnosisCode']);
  fillIfBlank('diagnosisDescription', prefill.diagnosisDescription as T['diagnosisDescription']);
  fillIfBlank('memberId', prefill.memberId as T['memberId']);

  if (prefill.status && (!current.status || options.statusFieldIsDefault)) {
    next.status = prefill.status as T['status'];
    appliedFields.add('status');
  }

  for (const service of prefill.services) {
    const code = service.serviceCode.toUpperCase();
    if (!serviceCatalog[code]) {
      skippedServiceCodes.add(code);
      continue;
    }

    if (!next.services.includes(code)) {
      next.services.push(code);
      appliedFields.add('services');
    }

    const units = service.approvedUnits ?? service.requestedUnits;
    if (units && units > 0 && !next.units[code]) {
      next.units[code] = units;
      appliedFields.add('units');
    }
  }

  return {
    data: next,
    appliedFields: [...appliedFields],
    skippedServiceCodes: [...skippedServiceCodes],
  };
};

const stripUndefined = (prefill: AuthorizationPdfPrefill): AuthorizationPdfPrefill => {
  return Object.fromEntries(
    Object.entries(prefill).filter(([, value]) => value !== undefined),
  ) as unknown as AuthorizationPdfPrefill;
};
