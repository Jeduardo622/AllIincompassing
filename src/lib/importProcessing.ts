import type { Client, Therapist } from '../types';
import { prepareFormData } from './validation';

export type ImportEntity = Partial<Client> | Partial<Therapist>;
export type ImportEntityType = 'client' | 'therapist';

export interface CsvMappedRecord {
  rowIndex: number;
  data?: ImportEntity;
  errors: string[];
}

export interface PrepareRecordsResult {
  records: CsvMappedRecord[];
  uniqueEmails: string[];
  uniqueClientIds: string[];
}

type HeaderMap = Record<string, string>;

type RequiredFieldConfig = Record<ImportEntityType, string[]>;

const requiredFields: RequiredFieldConfig = {
  client: ['first_name', 'last_name', 'email', 'date_of_birth'],
  therapist: ['first_name', 'last_name', 'email'],
};

const isValuePresent = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return value !== undefined && value !== null;
};

const pushUniqueError = (errors: string[], message: string): void => {
  if (!errors.includes(message)) {
    errors.push(message);
  }
};

const formatDateOfBirth = (value: string): string => {
  if (!value) {
    return value;
  }

  if (value.includes('/')) {
    const parts = value.split('/').map(part => part.trim());
    if (parts.length === 3) {
      const [month, day, year] = parts;
      if (year.length === 4) {
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    }
  }

  return value;
};

const mapRowToEntity = (
  row: string[],
  headerMap: HeaderMap,
  entityType: ImportEntityType
): ImportEntity => {
  const entityData: Record<string, unknown> = {};

  Object.entries(headerMap).forEach(([index, field]) => {
    if (!field) {
      return;
    }

    const cellValue = row[Number(index)];
    if (cellValue === undefined) {
      return;
    }

    let value = cellValue.trim();

    if (entityType === 'client' && field === 'date_of_birth') {
      value = formatDateOfBirth(value);
    }

    if (['service_preference', 'service_type', 'specialties', 'preferred_areas'].includes(field)) {
      entityData[field] = value
        ? value
            .split(',')
            .map(item => item.trim())
            .filter(item => item.length > 0)
        : [];
      return;
    }

    entityData[field] = value || null;
  });

  const prepared = prepareFormData(entityData);

  if (
    (typeof prepared.first_name === 'string' && prepared.first_name.length > 0) ||
    (typeof prepared.last_name === 'string' && prepared.last_name.length > 0)
  ) {
    const names = [prepared.first_name, prepared.middle_name, prepared.last_name]
      .map(part => (typeof part === 'string' ? part.trim() : ''))
      .filter(part => part.length > 0);
    prepared.full_name = names.join(' ');
  }

  return prepared;
};

export const prepareRecordsForImport = (
  rows: string[][],
  headerMap: HeaderMap,
  entityType: ImportEntityType
): PrepareRecordsResult => {
  const records: CsvMappedRecord[] = [];
  const seenEmails = new Set<string>();
  const seenClientIds = new Set<string>();
  const uniqueEmails = new Set<string>();
  const uniqueClientIds = new Set<string>();

  rows.forEach((row, rowIndex) => {
    const data = mapRowToEntity(row, headerMap, entityType);
    const errors: string[] = [];

    const required = requiredFields[entityType];
    required.forEach(field => {
      const value = (data as Record<string, unknown>)[field];
      if (!isValuePresent(value)) {
        pushUniqueError(errors, `Missing required field: ${field}`);
      }
    });

    const email = typeof (data as Record<string, unknown>).email === 'string'
      ? ((data as Record<string, unknown>).email as string)
      : undefined;
    if (email) {
      uniqueEmails.add(email);
      if (seenEmails.has(email)) {
        pushUniqueError(errors, `Duplicate email in import file: ${email}`);
      } else {
        seenEmails.add(email);
      }
    }

    if (entityType === 'client') {
      const clientId = typeof (data as Record<string, unknown>).client_id === 'string'
        ? ((data as Record<string, unknown>).client_id as string)
        : undefined;
      if (clientId) {
        uniqueClientIds.add(clientId);
        if (seenClientIds.has(clientId)) {
          pushUniqueError(errors, `Duplicate client ID in import file: ${clientId}`);
        } else {
          seenClientIds.add(clientId);
        }
      }
    }

    records.push({ rowIndex, data, errors });
  });

  return {
    records,
    uniqueEmails: Array.from(uniqueEmails),
    uniqueClientIds: Array.from(uniqueClientIds),
  };
};

interface ExistingDuplicateOptions {
  entityType: ImportEntityType;
  existingEmails?: Set<string>;
  existingClientIds?: Set<string>;
}

export const applyExistingDuplicateErrors = (
  records: CsvMappedRecord[],
  { entityType, existingEmails, existingClientIds }: ExistingDuplicateOptions
): CsvMappedRecord[] => {
  const emailSet = existingEmails ?? new Set<string>();
  const clientIdSet = existingClientIds ?? new Set<string>();

  records.forEach(record => {
    if (!record.data) {
      return;
    }

    const email = typeof record.data.email === 'string' ? record.data.email : undefined;
    if (email && emailSet.has(email)) {
      pushUniqueError(record.errors, `Email ${email} already exists`);
    }

    if (entityType === 'client') {
      const clientId = typeof record.data.client_id === 'string' ? record.data.client_id : undefined;
      if (clientId && clientIdSet.has(clientId)) {
        pushUniqueError(record.errors, `Client ID ${clientId} already exists`);
      }
    }
  });

  return records;
};

export const __testing = {
  mapRowToEntity,
  isValuePresent,
  formatDateOfBirth,
  requiredFields,
};
