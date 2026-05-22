import { toError } from '../logger/normalizeError';

const readPostgrestCode = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim().length > 0) {
      return code.trim();
    }
  }

  const normalized = toError(error);
  if (normalized.name.startsWith('SupabaseError:')) {
    return normalized.name.slice('SupabaseError:'.length);
  }

  return undefined;
};

/** Missing RPC or stale PostgREST schema cache for staff messaging helpers. */
export const isMessagingRpcUnavailable = (error: unknown): boolean => {
  const code = readPostgrestCode(error);
  const message = toError(error).message.toLowerCase();

  return (
    code === 'PGRST202'
    || message.includes('pgrst202')
    || message.includes('list_staff_message_thread_participant_names')
    || message.includes('list_eligible_staff_for_messaging')
  );
};

export const isMessagingSchemaUnavailable = (error: unknown): boolean => {
  if (isMessagingRpcUnavailable(error)) {
    return true;
  }

  const normalized = toError(error);
  const message = normalized.message.toLowerCase();
  return (
    message.includes('message_threads')
    || message.includes('message_thread_participants')
    || message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('pgrst205')
  );
};
