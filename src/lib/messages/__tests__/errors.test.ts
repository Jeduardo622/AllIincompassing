import { describe, expect, it } from 'vitest';
import { isMessagingRpcUnavailable, isMessagingSchemaUnavailable } from '../errors';

describe('messaging error guards', () => {
  it('detects missing RPC via PostgREST code metadata', () => {
    const error = {
      code: 'PGRST202',
      message: 'Could not find the function public.list_staff_message_thread_participant_names',
    };

    expect(isMessagingRpcUnavailable(error)).toBe(true);
    expect(isMessagingSchemaUnavailable(error)).toBe(true);
  });

  it('does not treat unrelated errors as schema-unavailable', () => {
    const error = { code: '42501', message: 'permission denied' };

    expect(isMessagingRpcUnavailable(error)).toBe(false);
    expect(isMessagingSchemaUnavailable(error)).toBe(false);
  });
});
