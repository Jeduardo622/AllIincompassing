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
  fetchBtSupervisionCorrectionTasks,
  completeSupervisionSessionNote,
  fetchPendingSupervisionSessionNoteCount,
  fetchPendingSupervisionSessionNoteRequests,
  reconcilePendingSupervisionSessionNoteRequests,
  resubmitBtSupervisionCorrection,
  returnSupervisionRequestToBt,
  SUPERVISION_STATUS_LABELS,
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
        can_return: true,
        correction_id: null,
        correction_round: null,
        correction_reason: null,
        correction_requested_at: null,
        correction_reviewer_user_id: null,
        latest_version_number: 2,
        review_versions: [
          {
            version_number: 1,
            note_id: 'note-1',
            source: 'original',
            responses: { client_status: 'Ready for treatment.' },
            template_snapshot: { sections: [{ key: 'summary', fields: [] }] },
            signature_method: 'typed',
            signature_value: 'Test BT',
            signed_at: '2026-07-17T11:05:00Z',
          },
          {
            version_number: 2,
            note_id: 'amendment-1',
            source: 'amendment',
            correction_round: 1,
            responses: { client_status: 'Updated response.' },
            template_snapshot: { sections: [{ key: 'summary', fields: [] }] },
            signature_method: 'drawn',
            signature_value: '[{"x":1,"y":2}]',
            signed_at: '2026-07-17T12:05:00Z',
          },
        ],
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
      canReturn: true,
      statusLabel: 'Pending Review',
      latestVersionNumber: 2,
      btReview: {
        noteId: 'note-1',
        responses: { client_status: 'Ready for treatment.' },
        signatureMethod: 'typed',
        signedAt: '2026-07-17T11:05:00Z',
      },
      versions: [
        expect.objectContaining({
          versionNumber: 1,
          noteId: 'note-1',
          source: 'original',
        }),
        expect.objectContaining({
          versionNumber: 2,
          noteId: 'amendment-1',
          source: 'amendment',
          correctionRound: 1,
        }),
      ],
    });
  });

  it('maps workflow labels for pending, correction required, resubmitted, completed, and cancelled states', () => {
    expect(SUPERVISION_STATUS_LABELS.pending).toBe('Pending Review');
    expect(SUPERVISION_STATUS_LABELS.correction_required).toBe('Correction Required');
    expect(SUPERVISION_STATUS_LABELS.resubmitted).toBe('Resubmitted');
    expect(SUPERVISION_STATUS_LABELS.completed).toBe('Completed');
    expect(SUPERVISION_STATUS_LABELS.cancelled).toBe('Cancelled');
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
        can_return: false,
        correction_id: 'correction-1',
        correction_round: 1,
        correction_reason: ' Needs revision ',
        correction_requested_at: '2026-07-17T12:15:00Z',
        correction_reviewer_user_id: 'bcba-1',
        latest_version_number: 1,
        review_versions: null,
      }],
      error: null,
    });

    const result = await fetchPendingSupervisionSessionNoteRequests('org-1');

    expect(result.template).toBeNull();
    expect(result.requests[0]).toMatchObject({
      id: 'request-1',
      statusLabel: 'Pending Review',
      canReturn: false,
      correction: {
        id: 'correction-1',
        round: 1,
        reason: 'Needs revision',
        requestedAt: '2026-07-17T12:15:00Z',
        reviewerUserId: 'bcba-1',
      },
      versions: [],
    });
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
        can_return: false,
        correction_id: null,
        correction_round: null,
        correction_reason: null,
        correction_requested_at: null,
        correction_reviewer_user_id: null,
        latest_version_number: 1,
        review_versions: [],
      }],
      error: null,
    });

    await expect(fetchPendingSupervisionSessionNoteRequests('org-1')).rejects.toThrow(
      'Completed BT note is unavailable for supervision review.',
    );
  });

  it('normalizes malformed packet arrays and records defensively', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{
        request_id: 'request-1',
        organization_id: 'org-1',
        session_id: 'session-1',
        client_id: 'client-1',
        bt_therapist_id: 'bt-1',
        assigned_reviewer_user_id: 'bcba-1',
        request_status: 'resubmitted',
        request_created_at: '2026-07-17T12:00:00Z',
        session_start_time: '2026-07-17T10:00:00Z',
        session_end_time: '2026-07-17T11:00:00Z',
        place_of_service: '12 - Home',
        client_name: ' ',
        bt_therapist_name: null,
        bt_therapist_title: 'BT',
        bt_note_id: 'note-2',
        bt_responses: ['invalid'],
        bt_template_snapshot: { sections: 'invalid' },
        bt_signature_method: 'typed',
        bt_signed_at: '2026-07-17T11:05:00Z',
        supervision_template_id: 'template-1',
        supervision_template_name: 'Supervision Session Note',
        supervision_template_structure: { sections: 'invalid' },
        can_complete: true,
        can_return: true,
        correction_id: 'correction-2',
        correction_round: 2,
        correction_reason: ' Updated note ',
        correction_requested_at: '2026-07-17T12:45:00Z',
        correction_reviewer_user_id: 'bcba-2',
        latest_version_number: 2,
        review_versions: [
          {
            version_number: 2,
            note_id: 'amendment-2',
            source: 'amendment',
            correction_round: 2,
            responses: ['invalid'],
            template_snapshot: { sections: 'invalid' },
            signature_method: 'typed',
            signature_value: 'Test BT',
            signed_at: '2026-07-17T12:50:00Z',
          },
        ],
      }],
      error: null,
    });

    const result = await fetchPendingSupervisionSessionNoteRequests('org-1');

    expect(result.template?.sections).toEqual([]);
    expect(result.requests[0]).toMatchObject({
      clientName: 'Client',
      btTherapistName: 'BT/RBT',
      statusLabel: 'Resubmitted',
      btReview: {
        responses: {},
        templateSnapshot: { sections: [] },
      },
      versions: [{
        versionNumber: 2,
        responses: {},
        templateSnapshot: { sections: [] },
      }],
    });
  });

  it('returns BT correction tasks from the RPC contract', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{
        request_id: 'request-1',
        organization_id: 'org-1',
        session_id: 'session-1',
        client_id: 'client-1',
        bt_therapist_id: 'bt-1',
        assigned_reviewer_user_id: 'bcba-1',
        request_status: 'correction_required',
        request_created_at: '2026-07-17T12:00:00Z',
        client_name: 'Test Client',
        bt_therapist_name: 'Test BT',
        bt_therapist_title: 'BT',
        correction_id: 'correction-1',
        correction_round: 1,
        correction_reason: 'Correct the setting narrative.',
        correction_requested_at: '2026-07-17T12:10:00Z',
        correction_reviewer_user_id: 'bcba-1',
        original_version: {
          version_number: 1,
          note_id: 'note-1',
          source: 'original',
          responses: { setting: 'Original setting narrative' },
          template_snapshot: { sections: [{ key: 'setting', fields: [] }] },
          signature_method: 'typed',
          signature_value: 'Test BT',
          signed_at: '2026-07-17T11:05:00Z',
        },
        latest_version: {
          version_number: 2,
          note_id: 'amendment-1',
          source: 'amendment',
          correction_round: 1,
          responses: { setting: 'Updated setting narrative' },
          template_snapshot: { sections: [{ key: 'setting', fields: [] }] },
          signature_method: 'drawn',
          signature_value: '[{"x":1,"y":2}]',
          signed_at: '2026-07-17T12:20:00Z',
        },
        review_versions: [
          {
            version_number: 1,
            note_id: 'note-1',
            source: 'original',
            responses: { setting: 'Original setting narrative' },
            template_snapshot: { sections: [{ key: 'setting', fields: [] }] },
            signature_method: 'typed',
            signature_value: 'Test BT',
            signed_at: '2026-07-17T11:05:00Z',
          },
          {
            version_number: 2,
            note_id: 'amendment-1',
            source: 'amendment',
            correction_round: 1,
            responses: { setting: 'Updated setting narrative' },
            template_snapshot: { sections: [{ key: 'setting', fields: [] }] },
            signature_method: 'drawn',
            signature_value: '[{"x":1,"y":2}]',
            signed_at: '2026-07-17T12:20:00Z',
          },
        ],
      }],
      error: null,
    });

    const result = await fetchBtSupervisionCorrectionTasks('org-1');

    expect(rpcMock).toHaveBeenCalledWith('get_bt_supervision_correction_tasks', {});
    expect(result).toEqual([
      expect.objectContaining({
        id: 'request-1',
        status: 'correction_required',
        statusLabel: 'Correction Required',
        correction: expect.objectContaining({
          id: 'correction-1',
          reason: 'Correct the setting narrative.',
        }),
        originalVersion: expect.objectContaining({
          versionNumber: 1,
          noteId: 'note-1',
        }),
        latestVersion: expect.objectContaining({
          versionNumber: 2,
          noteId: 'amendment-1',
        }),
        versions: [
          expect.objectContaining({ versionNumber: 1 }),
          expect.objectContaining({ versionNumber: 2 }),
        ],
      }),
    ]);
  });

  it('reconciles pending supervision requests through a separate tenant-checked RPC', async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });

    const result = await reconcilePendingSupervisionSessionNoteRequests('org-1');

    expect(rpcMock).toHaveBeenCalledWith('reconcile_supervision_session_note_requests', {});
    expect(fromMock).not.toHaveBeenCalled();
    expect(result).toEqual({ reconciled: true });
  });

  it('rejects reconciliation without organization context before calling the RPC', async () => {
    await expect(reconcilePendingSupervisionSessionNoteRequests('')).rejects.toThrow(
      'Organization context is required to reconcile supervision note requests.',
    );

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('preserves reconciliation RPC errors', async () => {
    const rpcError = new Error('reconcile failed');
    rpcMock.mockResolvedValue({ data: null, error: rpcError });

    await expect(reconcilePendingSupervisionSessionNoteRequests('org-1')).rejects.toBe(rpcError);
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

  it('trims and submits BCBA return reasons through the correction RPC', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'correction-1', error: null });

    const result = await returnSupervisionRequestToBt({
      organizationId: 'org-1',
      requestId: 'request-1',
      reason: '  Correct the setting narrative.  ',
    });

    expect(result).toEqual({ correctionId: 'correction-1' });
    expect(rpcMock).toHaveBeenCalledWith('return_supervision_session_note_request_to_bt', {
      p_request_id: 'request-1',
      p_reason: 'Correct the setting narrative.',
    });
  });

  it('rejects blank correction reasons before calling the return RPC', async () => {
    await expect(returnSupervisionRequestToBt({
      organizationId: 'org-1',
      requestId: 'request-1',
      reason: '   ',
    })).rejects.toThrow('Correction reason is required.');

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('resubmits BT corrections through the amendment RPC', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'amendment-1', error: null });

    const result = await resubmitBtSupervisionCorrection({
      organizationId: 'org-1',
      requestId: 'request-1',
      responses: { setting: 'Updated setting narrative' },
      signature: {
        method: 'typed',
        value: 'Test BT',
      },
    });

    expect(result).toEqual({ amendmentId: 'amendment-1' });
    expect(rpcMock).toHaveBeenCalledWith('resubmit_bt_supervision_correction', {
      p_request_id: 'request-1',
      p_responses: { setting: 'Updated setting narrative' },
      p_signature_method: 'typed',
      p_signature_value: 'Test BT',
    });
  });

  it('loads a lightweight pending supervision request count for navigation badges', async () => {
    rpcMock.mockResolvedValueOnce({ data: 2, error: null });

    const result = await fetchPendingSupervisionSessionNoteCount('org-1');

    expect(result).toBe(2);
    expect(rpcMock).toHaveBeenCalledWith('get_supervision_session_note_action_count', {});
    expect(fromMock).not.toHaveBeenCalled();
  });
});
