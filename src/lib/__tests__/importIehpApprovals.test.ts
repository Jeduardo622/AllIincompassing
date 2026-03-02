import { describe, expect, it } from 'vitest';
import {
  normalizeNameKey,
  parseAuthorizedHours,
  parseClientName,
  parseIehpApprovalRows,
  parseServiceBreakdown,
} from '../importIehpApprovals';

describe('parseClientName', () => {
  it('normalizes last-first name pairs', () => {
    const parsed = parseClientName('Aguilar, Eli');
    expect(parsed.firstName).toBe('Eli');
    expect(parsed.lastName).toBe('Aguilar');
    expect(parsed.fullName).toBe('Eli Aguilar');
    expect(parsed.nameKey).toBe('eliaguilar');
  });

  it('normalizes keys for fuzzy matching', () => {
    expect(normalizeNameKey("Eli O'Connor-Smith")).toBe('elioconnorsmith');
  });
});

describe('parseAuthorizedHours', () => {
  it('extracts numeric hour values from mixed formatting', () => {
    expect(parseAuthorizedHours('30hrs')).toBe(30);
    expect(parseAuthorizedHours(' 20 hrs ')).toBe(20);
    expect(parseAuthorizedHours('12.5hrs')).toBe(12.5);
  });

  it('returns null when no hour token exists', () => {
    expect(parseAuthorizedHours('PC and Sup')).toBeNull();
  });
});

describe('parseServiceBreakdown', () => {
  it('parses known IEHP/CO service tokens', () => {
    const parsed = parseServiceBreakdown('H0032 5hrs H0032HO 6hrs S5111 50 visits');
    expect(parsed.h0032Hours).toBe(5);
    expect(parsed.hoHours).toBe(6);
    expect(parsed.s5111Visits).toBe(50);
  });
});

describe('parseIehpApprovalRows', () => {
  it('skips blank separator rows and parses data rows', () => {
    const rows = [
      ['Client Name ', 'Client auth amount', '', 'IEHP', '', 'Client Location', 'Staff Needed'],
      ['', '', '', '', ''],
      ['Aguilar, Eli', '1to1', '20hrs', 'PC and Sup', 'H0032HO 4 hrs', 'San Bernardino', '2 staff'],
      ['', '', '', '', ''],
    ];

    const parsedRows = parseIehpApprovalRows(rows);
    expect(parsedRows).toHaveLength(1);
    expect(parsedRows[0]).toMatchObject({
      fullName: 'Eli Aguilar',
      authorizedHoursPerMonth: 20,
      location: 'San Bernardino',
    });
    expect(parsedRows[0].serviceBreakdown.hoHours).toBe(4);
  });
});
