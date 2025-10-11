import { describe, expect, it, vi } from 'vitest';
import type { PostgrestSingleResponse } from '@supabase/supabase-js';
import type { Client } from '../../../types';
import { CLIENT_SELECT } from '../select';
import { fetchClientById, fetchClients } from '../fetchers';

describe('clients fetchers', () => {
  it('loads clients using the sanitized select clause', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const select = vi.fn().mockReturnValue({ order });
    const from = vi.fn().mockReturnValue({ select });

    await fetchClients({ from } as any);

    expect(from).toHaveBeenCalledWith('clients');
    expect(select).toHaveBeenCalledWith(CLIENT_SELECT);
    expect(order).toHaveBeenCalledWith('full_name', { ascending: true });
  });

  it('loads an individual client with the sanitized clause', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: null } satisfies PostgrestSingleResponse<Client | null>);
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    await fetchClientById('client-123', { from } as any);

    expect(from).toHaveBeenCalledWith('clients');
    expect(select).toHaveBeenCalledWith(CLIENT_SELECT);
    expect(eq).toHaveBeenCalledWith('id', 'client-123');
    expect(single).toHaveBeenCalled();
  });
});
