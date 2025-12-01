import type { Client } from '../types';
import { prepareFormData } from './validation';
import { clientPayloadSchema } from './validationSchemas';

interface PrepareClientPayloadOptions {
  enforceFullName?: boolean;
}

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
  const { documents_consent: _documentsConsent, ...sanitizedData } = prepared as typeof prepared & {
    documents_consent?: unknown;
  };

  const payload: Partial<Client> = {
    ...sanitizedData,
  };

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

    throw new Error(typeof error === 'string' ? error : 'Failed to update client');
  }

  return data;
};
