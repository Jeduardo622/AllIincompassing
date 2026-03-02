export type ParsedServiceBreakdown = {
  h0032Hours: number | null;
  hoHours: number | null;
  s5111Visits: number | null;
};

export type ParsedApprovalRow = {
  rowNumber: number;
  clientNameRaw: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  nameKey: string;
  authType: string | null;
  authAmountRaw: string;
  authorizedHoursPerMonth: number | null;
  iehpLabel: string | null;
  iehpRaw: string;
  location: string | null;
  staffingNotes: string | null;
  serviceBreakdown: ParsedServiceBreakdown;
  warnings: string[];
};

const compactWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeNameToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export const normalizeNameKey = (value: string): string => normalizeNameToken(value);

const titleCase = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

export const parseClientName = (rawName: string): {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  nameKey: string;
} => {
  const cleaned = compactWhitespace(rawName);
  if (!cleaned) {
    return { fullName: '', firstName: null, lastName: null, nameKey: '' };
  }

  if (cleaned.includes(',')) {
    const [lastPart, firstPart] = cleaned.split(',').map(part => compactWhitespace(part));
    const firstName = firstPart || null;
    const lastName = lastPart || null;
    const fullName = compactWhitespace(`${firstName ?? ''} ${lastName ?? ''}`);
    return {
      fullName,
      firstName,
      lastName,
      nameKey: normalizeNameToken(fullName),
    };
  }

  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 1) {
    return {
      fullName: titleCase(parts[0]),
      firstName: titleCase(parts[0]),
      lastName: null,
      nameKey: normalizeNameToken(parts[0]),
    };
  }

  const firstName = titleCase(parts[0]);
  const lastName = titleCase(parts.slice(1).join(' '));
  const fullName = compactWhitespace(`${firstName} ${lastName}`);
  return {
    fullName,
    firstName,
    lastName,
    nameKey: normalizeNameToken(fullName),
  };
};

export const parseAuthorizedHours = (rawValue: string): number | null => {
  const normalized = compactWhitespace(rawValue).toLowerCase();
  if (!normalized) {
    return null;
  }

  const hoursMatch = normalized.match(/(\d+(?:\.\d+)?)\s*hrs?/);
  if (hoursMatch) {
    return Number(hoursMatch[1]);
  }

  const bareNumber = normalized.match(/^(\d+(?:\.\d+)?)$/);
  if (bareNumber) {
    return Number(bareNumber[1]);
  }

  return null;
};

const sumPatternMatches = (text: string, pattern: RegExp): number | null => {
  let total = 0;
  let found = false;
  for (const match of text.matchAll(pattern)) {
    const candidate = Number(match[1]);
    if (Number.isFinite(candidate)) {
      total += candidate;
      found = true;
    }
  }
  return found ? total : null;
};

const coalescePatternTotal = (first: number | null, second: number | null): number | null => {
  if (first === null) {
    return second;
  }
  if (second === null) {
    return first;
  }
  // Some rows express the same unit in both "code-first" and "hours-first" shape;
  // keep the higher total to avoid counting duplicated captures twice.
  return Math.max(first, second);
};

export const parseServiceBreakdown = (rawValue: string): ParsedServiceBreakdown => {
  const normalized = compactWhitespace(rawValue).toUpperCase();
  if (!normalized) {
    return {
      h0032Hours: null,
      hoHours: null,
      s5111Visits: null,
    };
  }

  const h0032CodeFirst = sumPatternMatches(normalized, /\b(?:H0032|0032)\b\s*(\d+(?:\.\d+)?)\s*HRS?\b/g);
  const h0032HoursFirst = sumPatternMatches(normalized, /(\d+(?:\.\d+)?)\s*HRS?\s*(?:H0032|0032)\b/g);
  const h0032Hours = coalescePatternTotal(h0032CodeFirst, h0032HoursFirst);

  const hoCodeFirst = sumPatternMatches(normalized, /\b(?:H0032HO|0032HO|HO)\b\s*(\d+(?:\.\d+)?)\s*HRS?\b/g);
  const hoHoursFirst = sumPatternMatches(normalized, /(\d+(?:\.\d+)?)\s*HRS?\s*HO\b/g);
  const hoHours = coalescePatternTotal(hoCodeFirst, hoHoursFirst);

  const s5111CodeFirst = sumPatternMatches(normalized, /\bS5111\b\s*(\d+)\s*VISITS?\b/g);
  const s5111HoursFirst = sumPatternMatches(normalized, /(\d+)\s*VISITS?\s*S5111\b/g);
  const s5111Visits = coalescePatternTotal(s5111CodeFirst, s5111HoursFirst);

  return { h0032Hours, hoHours, s5111Visits };
};

const readCell = (row: string[], index: number): string => compactWhitespace(String(row[index] ?? ''));

const isHeaderRow = (row: string[]): boolean => readCell(row, 0).toLowerCase().includes('client name');

const isEmptyRow = (row: string[]): boolean => row.every(cell => compactWhitespace(String(cell ?? '')).length === 0);

export const parseIehpApprovalRows = (rows: string[][]): ParsedApprovalRow[] => {
  const dataStartIndex = rows.findIndex(isHeaderRow);
  if (dataStartIndex < 0) {
    throw new Error('Unable to locate header row with "Client Name".');
  }

  const parsedRows: ParsedApprovalRow[] = [];
  for (let index = dataStartIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || isEmptyRow(row)) {
      continue;
    }

    const clientNameRaw = readCell(row, 0);
    if (!clientNameRaw) {
      continue;
    }

    const authType = readCell(row, 1) || null;
    const authAmountRaw = readCell(row, 2);
    const iehpLabel = readCell(row, 3) || null;
    const iehpRaw = readCell(row, 4);
    const locationRaw = readCell(row, 5);
    const staffingNotesRaw = readCell(row, 6);
    const warnings: string[] = [];

    const name = parseClientName(clientNameRaw);
    if (!name.nameKey) {
      warnings.push('Unable to generate a normalized name key.');
    }

    const authorizedHoursPerMonth = parseAuthorizedHours(authAmountRaw);
    if (authAmountRaw && authorizedHoursPerMonth === null) {
      warnings.push(`Unable to parse authorized hours from "${authAmountRaw}".`);
    }

    const serviceBreakdown = parseServiceBreakdown(iehpRaw);
    if (
      iehpRaw &&
      serviceBreakdown.h0032Hours === null &&
      serviceBreakdown.hoHours === null &&
      serviceBreakdown.s5111Visits === null
    ) {
      warnings.push(`Unable to parse service breakdown from "${iehpRaw}".`);
    }

    parsedRows.push({
      rowNumber: index + 1,
      clientNameRaw,
      fullName: name.fullName,
      firstName: name.firstName,
      lastName: name.lastName,
      nameKey: name.nameKey,
      authType,
      authAmountRaw,
      authorizedHoursPerMonth,
      iehpLabel,
      iehpRaw,
      location: locationRaw || null,
      staffingNotes: staffingNotesRaw || null,
      serviceBreakdown,
      warnings,
    });
  }

  return parsedRows;
};
