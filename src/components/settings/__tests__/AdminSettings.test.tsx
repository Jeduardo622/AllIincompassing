import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent } from '../../../test/utils';
import AdminSettings from '../AdminSettings';
import { supabase } from '../../../lib/supabase';
import { logger } from '../../../lib/logger/logger';

vi.mock('../../../lib/logger/logger', () => {
  const info = vi.fn();
  const error = vi.fn();
  const warn = vi.fn();
  const debug = vi.fn();
  return {
    logger: { info, error, warn, debug },
    info,
    error,
    warn,
    debug
  };
});

const rpcMock = vi.mocked(supabase.rpc);
const defaultRpcImplementation = rpcMock.getMockImplementation();
const fallbackRpc = defaultRpcImplementation
  ?? (async (_functionName: string, _params?: Record<string, unknown>) => ({ data: null, error: null }));

const mockAdminUser = {
  id: 'admin-id',
  user_id: 'user-123',
  email: 'admin@example.com',
  first_name: 'Ada',
  last_name: 'Admin',
  title: 'Administrator',
  created_at: new Date('2025-01-01T00:00:00Z').toISOString(),
  raw_user_meta_data: {
    first_name: 'Ada',
    last_name: 'Admin',
    title: 'Administrator'
  }
};

describe('AdminSettings logging', () => {
  beforeEach(() => {
    rpcMock.mockClear();
    rpcMock.mockImplementation(async (functionName: string, params?: Record<string, unknown>) => {
      if (functionName === 'get_admin_users') {
        return { data: [mockAdminUser], error: null };
      }
      if (functionName === 'manage_admin_users') {
        return { data: null, error: new Error('failed to remove admin') };
      }
      if (defaultRpcImplementation) {
        return defaultRpcImplementation(functionName, params as never);
      }
      return fallbackRpc(functionName, params);
    });
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.info).mockClear();
  });

  afterEach(() => {
    rpcMock.mockImplementation(defaultRpcImplementation ?? fallbackRpc);
  });

  it('logs errors when admin removal fails', async () => {
    renderWithProviders(<AdminSettings />);

    const removeButton = await screen.findByTitle('Remove admin');
    await userEvent.click(removeButton);

    await waitFor(() => {
      const errorCalls = vi.mocked(logger.error).mock.calls;
      expect(
        errorCalls.some(([message, options]) =>
          message === 'Admin removal RPC failed'
          && options?.context?.component === 'AdminSettings'
          && options?.context?.operation === 'removeAdminRpc'
        )
      ).toBe(true);
    });
  });
});
