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
  reconcilePendingSupervisionSessionNoteRequests,
} from '../supervision-session-notes';

describe('supervision session note data access', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  it('loads pending supervision review packets from the RPC contract', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{
        request_id: 'request-1',
        organization_id: 'org-1',
        session_id: 'session-1',
        client_id: 'client-1',
        bt_therapist_id: 'bt-1',
        assigned_reviewer_user_id: 'bcba-1',
        request_status: 'pending',
        request_created_at: '2026-07-17T12:00:00Z',
        session_start_time: '2026-07-17T10:00:00Z',
        session_end_time: '2026-07-17T11:00:00Z',
        place_of_service: '12 - Home',
        client_name: 'Test Client',
        bt_therapist_name: 'Test BT',
        bt_therapist_title: 'BT',
        bt_note_id: 'note-1',
        bt_responses: { client_status: 'Ready for treatment.' },
        bt_template_snapshot: { sections: [] },
        bt_signature_method: 'typed',
        bt_signed_at: '2026-07-17T11:05:00Z',
        supervision_template_id: 'template-1',
        supervision_template_name: 'Supervision Session Note',
        supervision_template_structure: { sections: [{ key: 'summary', fields: [] }] },
        can_complete: true,
      }],
      error: null,
    });

    const result = await fetchPendingSupervisionSessionNoteRequests('org-1');

    expect(rpcMock).toHaveBeenCalledWith('get_pending_supervision_review_packets', {});
    expect(fromMock).not.toHaveBeenCalled();
    expect(result.template?.id).toBe('template-1');
    expect(result.requests[0]).toMatchObject({
      id: 'request-1',
      assignedAdminUserId: 'bcba-1',
      canComplete: true,
      btReview: {
        noteId: 'note-1',
        responses: { client_status: 'Ready for treatment.' },
        signatureMethod: 'typed',
        signedAt: '2026-07-17T11:05:00Z',
      },
    });
  });

  it('returns a null template when the first packet does not provide a usable template identity', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{
        request_id: 'request-1',
        organization_id: 'org-1',
        session_id: 'session-1',
        client_id: 'client-1',
        bt_therapist_id: 'bt-1',
        assigned_reviewer_user_id: 'bcba-1',
        request_status: 'pending',
        request_created_at: '2026-07-17T12:00:00Z',
        session_start_time: '2026-07-17T10:00:00Z',
        session_end_time: '2026-07-17T11:00:00Z',
        place_of_service: '12 - Home',
        client_name: 'Test Client',
        bt_therapist_name: 'Test BT',
        bt_therapist_title: 'BT',
        bt_note_id: 'note-1',
        bt_responses: { client_status: 'Ready for treatment.' },
        bt_template_snapshot: { sections: [] },
        bt_signature_method: 'typed',
        bt_signed_at: '2026-07-17T11:05:00Z',
        supervision_template_id: '',
        supervision_template_name: '   ',
        supervision_template_structure: { sections: [{ key: 'summary', fields: [] }] },
        can_complete: true,
      }],
      error: null,
    });

    const result = await fetchPendingSupervisionSessionNoteRequests('org-1');

    expect(result.template).toBeNull();
    expect(result.requests[0]?.id).toBe('request-1');
  });

  it('rejects packets when the completed BT note is unavailable', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{
        request_id: 'request-1',
        organization_id: 'org-1',
        session_id: 'session-1',
        client_id: 'client-1',
        bt_therapist_id: 'bt-1',
        assigned_reviewer_user_id: 'bcba-1',
        request_status: 'pending',
        request_created_at: '2026-07-17T12:00:00Z',
        session_start_time: '2026-07-17T10:00:00Z',
        session_end_time: '2026-07-17T11:00:00Z',
        place_of_service: '12 - Home',
        client_name: 'Test Client',
        bt_therapist_name: 'Test BT',
        bt_therapist_title: 'BT',
        bt_note_id: null,
        bt_responses: { client_status: 'Ready for treatment.' },
        bt_template_snapshot: { sections: [] },
        bt_signature_method: 'typed',
        bt_signed_at: '2026-07-17T11:05:00Z',
        supervision_template_id: 'template-1',
        supervision_template_name: 'Supervision Session Note',
        supervision_template_structure: { sections: [{ key: 'summary', fields: [] }] },
        can_complete: true,
      }],
      error: null,
    });

    await expect(fetchPendingSupervisionSessionNoteRequests('org-1')).rejects.toThrow(
      'Completed BT note is unavailable for supervision review.',
    );
  });

  it('reconciles pending supervision requests through a separate tenant-checked RPC', async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });

    await reconcilePendingSupervisionSessionNoteRequests('org-1');

    expect(rpcMock).toHaveBeenCalledWith('reconcile_supervision_session_note_requests', {});
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('completes structured responses through the tenant-checked RPC', async () => {
    rpcMock.mockResolvedValue({ data: 'note-1', error: null });

    const result = await completeSupervisionSessionNote({
      organizationId: 'org-1',
      requestId: 'request-1',
      templateId: 'template-1',
      responses: {
        summary: 'Observed modeling and feedback.',
        bcba_supervisor_signature: { method: 'typed', value: 'Test BCBA' },
      },
    });

    expect(result.noteId).toBe('note-1');
    expect(rpcMock).toHaveBeenCalledWith('complete_supervision_session_note_request', {
      p_request_id: 'request-1',
      p_template_id: 'template-1',
      p_responses: {
        summary: 'Observed modeling and feedback.',
        bcba_supervisor_signature: { method: 'typed', value: 'Test BCBA' },
      },
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
