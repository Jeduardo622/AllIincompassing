import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../generated/database.types';
import { checkClientEmailExists, createClient, updateClientDocuments } from '../mutations';

const buildSupabaseMock = () => {
  const selectMock = vi.fn();
  const insertMock = vi.fn();
  const rpcMock = vi.fn();

  const fromMock = vi.fn(() => ({
    select: selectMock,
    insert: insertMock,
  }));

  const supabase = {
    rpc: rpcMock,
    from: fromMock,
  } as unknown as SupabaseClient<Database>;

  return { supabase, selectMock, insertMock, rpcMock };
};

describe('checkClientEmailExists', () => {
  it('returns true when RPC succeeds', async () => {
    const { supabase, rpcMock } = buildSupabaseMock();
    rpcMock.mockResolvedValue({ data: true, error: null });

    const exists = await checkClientEmailExists(supabase, 'user@example.com');
    expect(exists).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('client_email_exists', { p_email: 'user@example.com' });
  });

  it('falls back to direct query when RPC missing', async () => {
    const { supabase, rpcMock, selectMock } = buildSupabaseMock();
    rpcMock.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'not found' } });
    selectMock.mockReturnValue({ ilike: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [{ id: '1' }], error: null }) }) });

    const exists = await checkClientEmailExists(supabase, 'user@example.com');
    expect(exists).toBe(true);
  });

  it('returns false when fallback fails', async () => {
    const { supabase, rpcMock, selectMock } = buildSupabaseMock();
    rpcMock.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'not found' } });
    selectMock.mockReturnValue({ ilike: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'failure' } }) }) });

    const exists = await checkClientEmailExists(supabase, 'user@example.com');
    expect(exists).toBe(false);
  });
});

describe('createClient', () => {
  it('returns RPC data when available', async () => {
    const { supabase, rpcMock } = buildSupabaseMock();
    const client = { id: '123', email: 'user@example.com' };
    rpcMock.mockResolvedValue({ data: client, error: null });

    const result = await createClient(supabase, { email: 'user@example.com' });
    expect(result).toEqual(client);
  });

  it('falls back to insert when RPC missing', async () => {
    const { supabase, rpcMock, insertMock } = buildSupabaseMock();
    rpcMock.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'not found' } });
    insertMock.mockReturnValue({ select: () => ({ single: () => Promise.resolve({ data: { id: '1' }, error: null }) }) });

    const result = await createClient(supabase, { email: 'user@example.com' });
    expect(result).toEqual({ id: '1' });
  });

  it('throws when fallback insert fails', async () => {
    const { supabase, rpcMock, insertMock } = buildSupabaseMock();
    rpcMock.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'not found' } });
    insertMock.mockReturnValue({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'insert failed' } }) }) });

    await expect(createClient(supabase, { email: 'user@example.com' })).rejects.toEqual({ message: 'insert failed' });
  });

  it('throws when RPC fails for reasons other than missing function', async () => {
    const { supabase, rpcMock, insertMock } = buildSupabaseMock();
    rpcMock.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    insertMock.mockReturnValue({ select: vi.fn() });

    await expect(createClient(supabase, { email: 'user@example.com' })).rejects.toEqual({
      code: '42501',
      message: 'permission denied',
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('throws when RPC succeeds without returning a client', async () => {
    const { supabase, rpcMock, insertMock } = buildSupabaseMock();
    rpcMock.mockResolvedValue({ data: null, error: null });
    insertMock.mockReturnValue({ select: vi.fn() });

    await expect(createClient(supabase, { email: 'user@example.com' })).rejects.toThrow(
      'create_client RPC returned no data',
    );
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe('updateClientDocuments', () => {
  it('calls the RPC with allowlisted arguments', async () => {
    const { supabase, rpcMock } = buildSupabaseMock();
    rpcMock.mockResolvedValue({ data: null, error: null });

    await updateClientDocuments(supabase, {
      clientId: 'client-id',
      documents: [
        {
          name: 'doc.pdf',
          path: 'clients/client-id/insurance_card_front/doc.pdf',
          size: 123,
          type: 'application/pdf',
        },
      ],
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('update_client_documents', {
      p_client_id: 'client-id',
      p_documents: [
        {
          name: 'doc.pdf',
          path: 'clients/client-id/insurance_card_front/doc.pdf',
          size: 123,
          type: 'application/pdf',
        },
      ],
    });
  });
});
