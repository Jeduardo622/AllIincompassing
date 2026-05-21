import { toError } from '../logger/normalizeError';

export const isMessagingSchemaUnavailable = (error: unknown): boolean => {
  const normalized = toError(error);
  const message = normalized.message.toLowerCase();
  return (
    message.includes('message_threads')
    || message.includes('message_thread_participants')
    || message.includes('does not exist')
    || message.includes('schema cache')
    || normalized.message.includes('PGRST205')
  );
};
