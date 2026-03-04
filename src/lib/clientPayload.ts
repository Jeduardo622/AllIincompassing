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
  // #region agent log
  fetch('http://127.0.0.1:7802/ingest/c639188e-4d1d-4ae2-8578-fbb07665dceb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'27eafc'},body:JSON.stringify({sessionId:'27eafc',runId:'initial',hypothesisId:'H1',location:'src/lib/clientPayload.ts:21',message:'prepareClientPayload received prepared data',data:{preparedKeys:Object.keys((prepared && typeof prepared === 'object') ? prepared as Record<string, unknown> : {}),hasTopLevelServiceContracts:Boolean(prepared && typeof prepared === 'object' && 'service_contracts' in (prepared as Record<string, unknown>)),hasTopLevelDocumentsConsent:Boolean(prepared && typeof prepared === 'object' && 'documents_consent' in (prepared as Record<string, unknown>)),insuranceInfoType:typeof (prepared as Partial<Client>).insurance_info},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
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
  // #region agent log
  fetch('http://127.0.0.1:7802/ingest/c639188e-4d1d-4ae2-8578-fbb07665dceb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'27eafc'},body:JSON.stringify({sessionId:'27eafc',runId:'initial',hypothesisId:'H2',location:'src/lib/clientPayload.ts:58',message:'about to parse payload with clientPayloadSchema',data:{payloadKeys:Object.keys((payload && typeof payload === 'object') ? payload as Record<string, unknown> : {}),hasTopLevelServiceContracts:Boolean(payload && typeof payload === 'object' && 'service_contracts' in (payload as Record<string, unknown>)),hasInsuranceInfoServiceContracts:Boolean(payload && typeof payload === 'object' && payload.insurance_info && typeof payload.insurance_info === 'object' && !Array.isArray(payload.insurance_info) && 'service_contracts' in (payload.insurance_info as Record<string, unknown>))},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  try {
    return clientPayloadSchema.parse(payload);
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7802/ingest/c639188e-4d1d-4ae2-8578-fbb07665dceb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'27eafc'},body:JSON.stringify({sessionId:'27eafc',runId:'initial',hypothesisId:'H4',location:'src/lib/clientPayload.ts:62',message:'clientPayloadSchema.parse failed',data:{errorType:error instanceof Error ? error.name : typeof error,errorMessage:error instanceof Error ? error.message : 'non-error thrown',zodIssues:error && typeof error === 'object' && 'issues' in (error as Record<string, unknown>) ? (error as { issues?: unknown }).issues : null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    throw error;
  }
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
