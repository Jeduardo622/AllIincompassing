import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('../supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  completeSupervisionSessionNote,
  fetchPendingSupervisionSessionNoteCount,
  fetchPendingSupervisionSessionNoteRequests,
} from '../supervision-session-notes';

describe('supervision session note data access', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  it('loads pending org-scoped supervision requests and the stored template', async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    const requestOrder = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'request-1',
          organization_id: 'org-1',
          session_id: 'session-1',
          client_id: 'client-1',
          bt_therapist_id: 'bt-1',
          assigned_admin_user_id: null,
          status: 'pending',
          created_at: '2026-06-29T20:00:00.000Z',
          sessions: { start_time: '2026-06-29T18:00:00.000Z', end_time: '2026-06-29T19:00:00.000Z' },
          clients: { full_name: 'Client One' },
          therapists: { full_name: 'BT One', title: 'BT' },
        },
      ],
      error: null,
    });
    const templateMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'template-1',
        template_name: 'Supervision Session Note',
        template_structure: { sections: [{ key: 'summary', label: 'Summary', fields: [] }] },
      },
      error: null,
    });

    fromMock.mockImplementation((table: string) => {
      if (table === 'supervision_session_note_requests') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: requestOrder,
              }),
            }),
          }),
        };
      }
      if (table === 'session_note_templates') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: templateMaybeSingle,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await fetchPendingSupervisionSessionNoteRequests('org-1');

    expect(rpcMock).toHaveBeenCalledWith('reconcile_supervision_session_note_requests', {});
    expect(fromMock).toHaveBeenCalledWith('supervision_session_note_requests');
    expect(fromMock).toHaveBeenCalledWith('session_note_templates');
    expect(result.template?.id).toBe('template-1');
    expect(result.requests).toEqual([
      expect.objectContaining({
        id: 'request-1',
        clientName: 'Client One',
        btTherapistName: 'BT One',
        btTherapistTitle: 'BT',
      }),
    ]);
  });

  it('completes structured responses through the tenant-checked RPC', async () => {
    rpcMock.mockResolvedValue({ data: 'note-1', error: null });

    const result = await completeSupervisionSessionNote({
      organizationId: 'org-1',
      requestId: 'request-1',
      templateId: 'template-1',
      responses: { summary: 'Observed modeling and feedback.' },
    });

    expect(result.noteId).toBe('note-1');
    expect(rpcMock).toHaveBeenCalledWith('complete_supervision_session_note_request', {
      p_request_id: 'request-1',
      p_template_id: 'template-1',
      p_responses: { summary: 'Observed modeling and feedback.' },
    });
  });

  it('loads a lightweight pending supervision request count for navigation badges', async () => {
    const statusEq = vi.fn().mockResolvedValue({ count: 2, error: null });
    const orgEq = vi.fn().mockReturnValue({ eq: statusEq });
    const select = vi.fn().mockReturnValue({ eq: orgEq });

    fromMock.mockReturnValue({ select });

    const result = await fetchPendingSupervisionSessionNoteCount('org-1');

    expect(result).toBe(2);
    expect(fromMock).toHaveBeenCalledWith('supervision_session_note_requests');
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(orgEq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(statusEq).toHaveBeenCalledWith('status', 'pending');
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
