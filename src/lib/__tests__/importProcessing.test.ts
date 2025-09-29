import { describe, expect, it } from 'vitest';
import { applyExistingDuplicateErrors, prepareRecordsForImport } from '../importProcessing';

const clientHeaderMap: Record<string, string> = {
  '0': 'first_name',
  '1': 'last_name',
  '2': 'email',
  '3': 'date_of_birth',
  '4': 'client_id',
};

describe('importProcessing', () => {
  it('prepares and sanitizes client records for import (happy path)', () => {
    const rows = [[
      ' John ',
      ' Doe ',
      'JOHN@EXAMPLE.COM',
      '01/02/2010',
      ' ABC123 ',
    ]];

    const { records, uniqueEmails, uniqueClientIds } = prepareRecordsForImport(rows, clientHeaderMap, 'client');

    expect(records).toHaveLength(1);
    const [record] = records;

    expect(record.errors).toHaveLength(0);
    expect(record.data?.email).toBe('john@example.com');
    expect(record.data?.full_name).toBe('John Doe');
    expect(record.data?.date_of_birth).toBe('2010-01-02');
    expect(record.data?.client_id).toBe('ABC123');
    expect(uniqueEmails).toEqual(['john@example.com']);
    expect(uniqueClientIds).toEqual(['ABC123']);
  });

  it('flags missing required fields for invalid rows', () => {
    const rows = [[
      'Jane',
      'Smith',
      '',
      '02/03/2011',
      '',
    ]];

    const { records } = prepareRecordsForImport(rows, clientHeaderMap, 'client');

    expect(records[0].errors).toContain('Missing required field: email');
    expect(records[0].errors).not.toContain('Missing required field: client_id');
  });

  it('detects duplicate identifiers within the same import batch', () => {
    const rows = [
      ['Amy', 'Adams', 'amy@example.com', '03/04/2012', 'ID1'],
      ['Anna', 'Adams', 'amy@example.com', '03/04/2012', 'ID1'],
    ];

    const { records } = prepareRecordsForImport(rows, clientHeaderMap, 'client');

    expect(records[0].errors).toHaveLength(0);
    expect(records[1].errors).toContain('Duplicate email in import file: amy@example.com');
    expect(records[1].errors).toContain('Duplicate client ID in import file: ID1');
  });

  it('adds errors when duplicates already exist in the database', () => {
    const rows = [['Eve', 'Stone', 'eve@example.com', '05/06/2013', 'ID2']];
    const { records } = prepareRecordsForImport(rows, clientHeaderMap, 'client');

    const updated = applyExistingDuplicateErrors(records, {
      entityType: 'client',
      existingEmails: new Set(['eve@example.com']),
      existingClientIds: new Set(['ID2']),
    });

    const [record] = updated;
    expect(record.errors).toContain('Email eve@example.com already exists');
    expect(record.errors).toContain('Client ID ID2 already exists');
  });
});
