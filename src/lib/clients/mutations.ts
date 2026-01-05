import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger/logger';
import { toError } from '../logger/normalizeError';
import type { Database, Tables, TablesInsert } from '../generated/database.types';
import { describePostgrestError, isMissingRpcFunctionError } from '../supabase/isMissingRpcFunctionError';

export type ClientsTable = Tables<'clients'>;
export type ClientInsert = TablesInsert<'clients'>;

type RpcResponse = { data: ClientsTable | null; error: unknown } | { data: ClientsTable; error: null };

type ClientSupabase = SupabaseClient<Database>;

const sanitizeEmailPattern = (email: string): string => email.replace(/[%_]/g, (char) => `\\${char}`);

const fetchClientByEmail = async (
  supabase: ClientSupabase,
  email: string,
): Promise<boolean> => {
  const pattern = sanitizeEmailPattern(email);
  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .ilike('email', pattern)
    .limit(1);

  if (error) {
    throw error;
  }

  return Array.isArray(data) && data.length > 0;
};

export const checkClientEmailExists = async (
  supabase: ClientSupabase,
  email: string,
): Promise<boolean> => {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  const { data, error } = await supabase.rpc('client_email_exists', { p_email: normalizedEmail });

  if (!error) {
    return Boolean(data);
  }

  if (!isMissingRpcFunctionError(error, 'client_email_exists')) {
    logger.warn('Client email uniqueness RPC failed; attempting fallback query', {
      error: toError(error, 'client_email_exists RPC failed'),
      metadata: { normalizedEmail },
      track: false,
    });
  }

  try {
    return await fetchClientByEmail(supabase, normalizedEmail);
  } catch (fallbackError) {
    logger.error('Client email uniqueness fallback failed', {
      error: toError(fallbackError, 'Client email fallback failed'),
      metadata: { normalizedEmail },
      track: false,
    });
    return false;
  }
};

const insertClientDirectly = async (
  supabase: ClientSupabase,
  payload: Partial<ClientInsert>,
): Promise<ClientsTable> => {
  const { data, error } = await supabase
    .from('clients')
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Client insert succeeded without returning data');
  }

  return data;
};

const createClientViaRpc = async (
  supabase: ClientSupabase,
  payload: Partial<ClientInsert>,
): Promise<RpcResponse> => {
  const { data, error } = await supabase.rpc('create_client', {
    p_client_data: payload,
  });

  return { data: data ?? null, error };
};

export const createClient = async (
  supabase: ClientSupabase,
  payload: Partial<ClientInsert>,
): Promise<ClientsTable> => {
  const rpcResult = await createClientViaRpc(supabase, payload);

  if (!rpcResult.error) {
    if (rpcResult.data) {
      return rpcResult.data;
    }

    const emptyResponseError = new Error('create_client RPC returned no data');
    logger.error('create_client RPC did not return a client record', {
      error: toError(emptyResponseError, 'create_client RPC returned no data'),
      metadata: { providedFields: Object.keys(payload) },
      track: false,
    });
    throw emptyResponseError;
  }

  if (!isMissingRpcFunctionError(rpcResult.error, 'create_client')) {
    logger.error('create_client RPC failed', {
      error: toError(rpcResult.error, describePostgrestError(rpcResult.error)),
      metadata: { providedFields: Object.keys(payload) },
      track: false,
    });
    throw rpcResult.error;
  }

  logger.warn('create_client RPC missing; attempting direct insert fallback', {
    metadata: { providedFields: Object.keys(payload) },
    track: false,
  });

  try {
    return await insertClientDirectly(supabase, payload);
  } catch (fallbackError) {
    logger.error('Client insert fallback failed', {
      error: toError(fallbackError, 'Client insert fallback failed'),
      metadata: { providedFields: Object.keys(payload) },
      track: false,
    });
    throw fallbackError;
  }
};

export interface ClientDocumentInput {
  name: string;
  path: string;
  size: number;
  type: string;
}

export const updateClientDocuments = async (
  supabase: ClientSupabase,
  input: { clientId: string; documents: ClientDocumentInput[] },
): Promise<void> => {
  const { error } = await supabase.rpc('update_client_documents', {
    p_client_id: input.clientId,
    p_documents: input.documents,
  });

  if (error) {
    throw error;
  }
};
