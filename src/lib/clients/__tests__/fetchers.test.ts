import { describe, expect, it, vi } from 'vitest';
import type { PostgrestSingleResponse } from '@supabase/supabase-js';
import type { Client } from '../../../types';
import { CLIENT_SELECT } from '../select';
import {
  fetchClientById,
  fetchClientNotes,
  fetchClients,
  fetchGuardianClientById,
  fetchGuardianClients,
} from '../fetchers';

describe('clients fetchers', () => {
  it('loads clients using the sanitized select clause', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq, order });
    const from = vi.fn().mockReturnValue({ select });

    await fetchClients({ organizationId: 'org-1', client: { from } as any });

    expect(from).toHaveBeenCalledWith('clients');
    expect(select).toHaveBeenCalledWith(CLIENT_SELECT);
    expect(eq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(order).toHaveBeenCalledWith('full_name', { ascending: true });
  });

  it('allows super admins to load all clients when explicitly enabled', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const select = vi.fn().mockReturnValue({ order });
    const from = vi.fn().mockReturnValue({ select });

    await fetchClients({ allowAll: true, client: { from } as any });

    expect(from).toHaveBeenCalledWith('clients');
    expect(select).toHaveBeenCalledWith(CLIENT_SELECT);
    expect(order).toHaveBeenCalledWith('full_name', { ascending: true });
  });

  it('loads an individual client with the sanitized clause', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: null } satisfies PostgrestSingleResponse<Client | null>);
    const secondEq = vi.fn().mockReturnValue({ single });
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
    const select = vi.fn().mockReturnValue({ eq: firstEq });
    const from = vi.fn().mockReturnValue({ select });

    await fetchClientById('client-123', 'org-1', { from } as any);

    expect(from).toHaveBeenCalledWith('clients');
    expect(select).toHaveBeenCalledWith(CLIENT_SELECT);
    expect(firstEq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(secondEq).toHaveBeenCalledWith('id', 'client-123');
    expect(single).toHaveBeenCalled();
  });

  it('retrieves guardian portal clients via RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          client_id: 'child-1',
          client_full_name: 'Kid One',
          client_date_of_birth: '2020-01-01',
          client_email: 'kid1@example.com',
          client_phone: null,
          client_status: 'active',
          guardian_relationship: 'parent',
          guardian_is_primary: true,
          upcoming_sessions: [
            {
              id: 'session-1',
              start_time: '2025-07-01T10:00:00Z',
              end_time: '2025-07-01T11:00:00Z',
              status: 'scheduled',
              therapist: {
                id: 'therapist-1',
                full_name: 'Therapist Name',
              },
            },
          ],
          guardian_notes: [
            {
              id: 'note-1',
              content: 'Visible note',
              created_at: '2025-06-30T12:00:00Z',
              status: 'open',
              created_by: 'therapist-1',
              created_by_name: 'Therapist Name',
            },
          ],
        },
      ],
      error: null,
    });

    const result = await fetchGuardianClients({ rpc } as any);

    expect(rpc).toHaveBeenCalledWith('get_guardian_client_portal');
    expect(result).toEqual([
      {
        clientId: 'child-1',
        fullName: 'Kid One',
        dateOfBirth: '2020-01-01',
        email: 'kid1@example.com',
        phone: null,
        status: 'active',
        relationship: 'parent',
        isPrimaryGuardian: true,
        upcomingSessions: [
          {
            id: 'session-1',
            startTime: '2025-07-01T10:00:00Z',
            endTime: '2025-07-01T11:00:00Z',
            status: 'scheduled',
            therapist: {
              id: 'therapist-1',
              fullName: 'Therapist Name',
            },
          },
        ],
        notes: [
          {
            id: 'note-1',
            content: 'Visible note',
            createdAt: '2025-06-30T12:00:00Z',
            status: 'open',
            createdBy: 'therapist-1',
            createdByName: 'Therapist Name',
          },
        ],
      },
    ]);
  });

  it('retrieves a single guardian portal client when filtered', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          client_id: 'child-2',
          client_full_name: 'Kid Two',
          client_date_of_birth: null,
          client_email: null,
          client_phone: null,
          client_status: 'inactive',
          guardian_relationship: null,
          guardian_is_primary: false,
          upcoming_sessions: [],
          guardian_notes: [],
        },
      ],
      error: null,
    });

    const result = await fetchGuardianClientById('child-2', { rpc } as any);

    expect(rpc).toHaveBeenCalledWith('get_guardian_client_portal', { p_client_id: 'child-2' });
    expect(result).toEqual({
      clientId: 'child-2',
      fullName: 'Kid Two',
      dateOfBirth: null,
      email: null,
      phone: null,
      status: 'inactive',
      relationship: null,
      isPrimaryGuardian: false,
      upcomingSessions: [],
      notes: [],
    });
  });

  it('returns null when guardian RPC yields no records', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    const result = await fetchGuardianClientById('missing', { rpc } as any);

    expect(rpc).toHaveBeenCalledWith('get_guardian_client_portal', { p_client_id: 'missing' });
    expect(result).toBeNull();
  });

  it('hydrates client note author names from profiles lookup', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'note-1',
          content: 'Progress note',
          status: 'open',
          created_at: '2026-02-13T00:00:00Z',
          created_by: 'user-1',
          is_visible_to_parent: true,
          is_visible_to_therapist: true,
        },
      ],
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ order });
    const notesSelect = vi.fn().mockReturnValue({ eq });

    const inFilter = vi.fn().mockResolvedValue({
      data: [{ id: 'user-1', full_name: 'Therapist One' }],
      error: null,
    });
    const profilesSelect = vi.fn().mockReturnValue({ in: inFilter });

    const from = vi.fn((table: string) => {
      if (table === 'client_notes') {
        return { select: notesSelect };
      }
      if (table === 'profiles') {
        return { select: profilesSelect };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await fetchClientNotes('client-1', {}, { from } as any);

    expect(from).toHaveBeenCalledWith('client_notes');
    expect(from).toHaveBeenCalledWith('profiles');
    expect(inFilter).toHaveBeenCalledWith('id', ['user-1']);
    expect(result).toEqual([
      {
        id: 'note-1',
        content: 'Progress note',
        createdAt: '2026-02-13T00:00:00Z',
        status: 'open',
        createdBy: 'user-1',
        createdByName: 'Therapist One',
        isVisibleToParent: true,
        isVisibleToTherapist: true,
      },
    ]);
  });

  it('returns notes even when profile lookup fails', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'note-2',
          content: 'Another note',
          status: null,
          created_at: '2026-02-13T01:00:00Z',
          created_by: 'user-2',
          is_visible_to_parent: false,
          is_visible_to_therapist: true,
        },
      ],
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ order });
    const notesSelect = vi.fn().mockReturnValue({ eq });

    const inFilter = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'profile query failed' },
    });
    const profilesSelect = vi.fn().mockReturnValue({ in: inFilter });

    const from = vi.fn((table: string) => {
      if (table === 'client_notes') {
        return { select: notesSelect };
      }
      if (table === 'profiles') {
        return { select: profilesSelect };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await fetchClientNotes('client-1', {}, { from } as any);

    expect(result).toEqual([
      {
        id: 'note-2',
        content: 'Another note',
        createdAt: '2026-02-13T01:00:00Z',
        status: null,
        createdBy: 'user-2',
        createdByName: null,
        isVisibleToParent: false,
        isVisibleToTherapist: true,
      },
    ]);
  });
});
