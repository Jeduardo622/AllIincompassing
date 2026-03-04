import type { Client } from '../types';
import { prepareFormData } from './validation';
import { clientPayloadSchema } from './validationSchemas';

interface PrepareClientPayloadOptions {
  enforceFullName?: boolean;
}

const normalizeNullableDateField = (value: unknown): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const formatSupabaseError = (error: unknown): string => {
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message =
      typeof record.message === 'string' && record.message.trim().length > 0
        ? record.message.trim()
        : 'Failed to update client';
    const details =
      typeof record.details === 'string' && record.details.trim().length > 0
        ? record.details.trim()
        : null;
    const hint =
      typeof record.hint === 'string' && record.hint.trim().length > 0
        ? record.hint.trim()
        : null;

    return [message, details, hint].filter(Boolean).join(' | ');
  }

  return 'Failed to update client';
};

const computeFullName = (client: Partial<Client>): string => {
  const parts = [client.first_name, client.middle_name, client.last_name]
    .map(part => (typeof part === 'string' ? part.trim() : ''))
    .filter(part => part.length > 0);

  return parts.join(' ').trim();
};

export const prepareClientPayload = (
  clientData: Partial<Client>,
  options: PrepareClientPayloadOptions = {}
) => {
  const prepared = prepareFormData(clientData);
  const {
    documents_consent: _documentsConsent,
    service_contracts: _serviceContracts,
    ...sanitizedData
  } = prepared as typeof prepared & {
    documents_consent?: unknown;
    service_contracts?: unknown;
  };

  const payload: Partial<Client> = {
    ...sanitizedData,
  };

  payload.date_of_birth = normalizeNullableDateField(sanitizedData.date_of_birth);
  payload.auth_start_date = normalizeNullableDateField(sanitizedData.auth_start_date);
  payload.auth_end_date = normalizeNullableDateField(sanitizedData.auth_end_date);

  if ('insurance_info' in sanitizedData) {
    const info = sanitizedData.insurance_info;
    const hasContent =
      info &&
      typeof info === 'object' &&
      !Array.isArray(info) &&
      Object.keys(info).length > 0;

    payload.insurance_info = hasContent ? info : null;
  }

  if ('service_preference' in prepared) {
    payload.service_preference = prepared.service_preference;
  }

  const computedFullName = computeFullName(prepared);
  const shouldSetFullName = options.enforceFullName || computedFullName.length > 0;

  if (shouldSetFullName) {
    if (computedFullName.length > 0) {
      payload.full_name = computedFullName;
    } else if (typeof prepared.full_name === 'string') {
      payload.full_name = prepared.full_name.trim();
    } else {
      payload.full_name = '';
    }
  }

  return clientPayloadSchema.parse(payload);
};

type SupabaseUpdateResponse<T> = Promise<{ data: T | null; error: unknown }>;

interface SupabaseLike {
  from: (table: string) => {
    update: (values: Partial<Client>) => {
      eq: (column: string, value: string) => {
        select: () => {
          single: () => SupabaseUpdateResponse<Client>;
        };
      };
    };
  };
}

export const updateClientRecord = async (
  supabaseClient: SupabaseLike,
  clientId: string,
  clientData: Partial<Client>
) => {
  const payload = prepareClientPayload(clientData);

  const { data, error } = await supabaseClient
    .from('clients')
    .update(payload)
    .eq('id', clientId)
    .select()
    .single();

  if (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(formatSupabaseError(error));
  }

  return data;
};
