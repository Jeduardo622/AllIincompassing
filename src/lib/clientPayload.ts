import type { Client } from '../types';
import { prepareFormData } from './validation';

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
): Partial<Client> => {
  const prepared = prepareFormData(clientData);

  const payload: Partial<Client> = {
    ...prepared,
  };

  if ('insurance_info' in prepared) {
    payload.insurance_info = prepared.insurance_info || {};
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

  return payload;
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
