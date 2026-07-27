import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger/logger';
import { toError } from '../logger/normalizeError';
import type { Database, Tables, TablesInsert } from '../generated/database.types';
import { describePostgrestError, isMissingRpcFunctionError } from '../supabase/isMissingRpcFunctionError';

export type ClientsTable = Tables<'clients'>;
export type ClientInsert = TablesInsert<'clients'>;

type RpcResponse = { data: ClientsTable | null; error: unknown } | { data: ClientsTable; error: null };

type ClientSupabase = SupabaseClient<Database>;

type ClientCreateConflict = 'client_id' | 'duplicate';

interface MaybePostgrestConflictError {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}

export class ClientCreateConflictError extends Error {
  readonly conflict: ClientCreateConflict;
  override readonly cause: unknown;

  constructor(conflict: ClientCreateConflict, message: string, cause: unknown) {
    super(message);
    this.name = 'ClientCreateConflictError';
    this.conflict = conflict;
    this.cause = cause;
  }
}

const sanitizeEmailPattern = (email: string): string => email.replace(/[%_]/g, (char) => `\\${char}`);

const toSearchableText = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const getPostgrestConflictError = (error: unknown): MaybePostgrestConflictError => (
  error && typeof error === 'object'
    ? (error as MaybePostgrestConflictError)
    : {}
);

const isUniqueConflictError = (error: unknown): boolean => {
  const postgrestError = getPostgrestConflictError(error);
  const code = toSearchableText(postgrestError.code);
  if (code) {
    return code === '23505';
  }

  const status = typeof postgrestError.status === 'number' ? postgrestError.status : null;
  if (status !== 409) {
    return false;
  }

  const combined = [
    postgrestError.message,
    postgrestError.details,
    postgrestError.hint,
  ]
    .map(toSearchableText)
    .join(' ');

  return combined.includes('duplicate key value violates unique constraint');
};

const toClientCreateConflictError = (error: unknown): ClientCreateConflictError | null => {
  if (!isUniqueConflictError(error)) {
    return null;
  }

  const postgrestError = getPostgrestConflictError(error);
  const combined = [
    postgrestError.message,
    postgrestError.details,
    postgrestError.hint,
  ]
    .map(toSearchableText)
    .join(' ');

  if (
    combined.includes('clients_org_client_id_idx')
    || combined.includes('(organization_id, client_id)')
  ) {
    return new ClientCreateConflictError(
      'client_id',
      'This client ID is already in use for this organization. Enter a different client ID.',
      error,
    );
  }

  return new ClientCreateConflictError(
    'duplicate',
    'A duplicate client record already exists. Review the client details and try again.',
    error,
  );
};

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
  const mappedRpcConflictError = toClientCreateConflictError(rpcResult.error);

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
      error: toError(
        mappedRpcConflictError ?? rpcResult.error,
        describePostgrestError(rpcResult.error),
      ),
      metadata: { providedFields: Object.keys(payload) },
      track: false,
    });
    throw mappedRpcConflictError ?? rpcResult.error;
  }

  logger.warn('create_client RPC missing; attempting direct insert fallback', {
    metadata: { providedFields: Object.keys(payload) },
    track: false,
  });

  try {
    return await insertClientDirectly(supabase, payload);
  } catch (fallbackError) {
    const mappedConflictError = toClientCreateConflictError(fallbackError);
    logger.error('Client insert fallback failed', {
      error: toError(mappedConflictError ?? fallbackError, 'Client insert fallback failed'),
      metadata: { providedFields: Object.keys(payload) },
      track: false,
    });
    throw mappedConflictError ?? fallbackError;
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
