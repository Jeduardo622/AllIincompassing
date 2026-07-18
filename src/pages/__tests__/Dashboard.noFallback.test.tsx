import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardView } from '../Dashboard';
import type { BtAbaSessionNoteResponses } from '../../lib/bt-aba-session-note';

vi.mock('../../components/Dashboard/ReportsSummary', () => ({
  ReportsSummary: () => <div data-testid="reports-summary" />,
}));

const baseProps = {
  dashboardData: {
    todaySessions: [],
    incompleteSessions: [],
    billingAlerts: [],
    clientMetrics: { total: 10, active: 5, totalUnits: 30 },
    therapistMetrics: { total: 3, active: 2, totalHours: 60 },
  },
  isLoading: false,
  error: null,
  refetch: vi.fn(),
  isLiveRole: true,
  intervalMs: 30000,
};

const validBtCorrectionResponses = (): BtAbaSessionNoteResponses => ({
  purpose_of_session: ['RBT/BT worked on goals as stated in the treatment plan'],
  client_status: 'Client tolerated transitions with one prompt.',
  skill_strategies: ['Role playing or modeling'],
  behavior_strategies: ['Modeling'],
  supervisor_support: ['Problem-solved concerns'],
  progress_toward_goals: 'Original setting narrative',
  client_response_to_treatment: 'Client responded well to reinforcement.',
  data_point_scope: 'linked',
  link_unlinked_data: false,
  bt_signature: { method: 'typed', value: 'BT Signed Name' },
});

const makeBtCorrectionTask = (overrides: Record<string, unknown> = {}) => {
  const latestResponses = validBtCorrectionResponses();
  return {
    id: 'bt-task-1',
    organizationId: 'org-1',
    sessionId: 'session-bt-1',
    clientId: 'client-bt-1',
    btTherapistId: 'bt-1',
    assignedAdminUserId: 'bcba-1',
    status: 'correction_required',
    statusLabel: 'Correction Required',
    createdAt: '2026-07-18T17:00:00.000Z',
    clientName: 'Client BT',
    btTherapistName: 'BT One',
    btTherapistTitle: 'BT',
    correction: {
      id: 'correction-1',
      round: 1,
      reason: 'Correct the setting narrative.',
      requestedAt: '2026-07-18T18:00:00.000Z',
      reviewerUserId: 'bcba-1',
    },
    originalVersion: {
      versionNumber: 1,
      noteId: 'bt-note-v1',
      source: 'original',
      correctionRound: null,
      responses: latestResponses,
      templateSnapshot: { sections: [] },
      signatureMethod: 'typed',
      signatureValue: 'BT Signed Name',
      signedAt: '2026-07-18T16:00:00.000Z',
    },
    latestVersion: {
      versionNumber: 1,
      noteId: 'bt-note-v1',
      source: 'original',
      correctionRound: null,
      responses: latestResponses,
      templateSnapshot: { sections: [] },
      signatureMethod: 'typed',
      signatureValue: 'BT Signed Name',
      signedAt: '2026-07-18T16:00:00.000Z',
    },
    versions: [],
    ...overrides,
  };
};

describe('Dashboard without client fallbacks', () => {
  it('renders metrics from provided data and shows summary cards', () => {
    render(<DashboardView {...baseProps} />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Active Clients')).toBeInTheDocument();
    expect(screen.getByText('Billing Alerts')).toBeInTheDocument();
  });

  it('shows an empty state when there is no recent documentation or billing activity', () => {
    render(<DashboardView {...baseProps} />);

    expect(screen.getByRole('status', { name: /no recent documentation or billing activity/i })).toHaveTextContent(
      'No pending documentation or billing alerts right now.',
    );
  });

  it('renders a fallback when activity dates are malformed', () => {
    render(
      <DashboardView
        {...baseProps}
        dashboardData={{
          ...baseProps.dashboardData,
          incompleteSessions: [
            {
              id: 'session-with-bad-date',
              start_time: 'not-a-date',
              status: 'scheduled',
              client: { id: 'client-1', full_name: 'Bad Date Client' },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText(/Session with/i)).toHaveTextContent('Bad Date Client');
    expect(screen.getByText('Date unavailable')).toBeInTheDocument();
  });

  it('submits structured BCBA signature payload from the dashboard modal', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const user = userEvent.setup();
    const onCompleteSupervisionNote = vi.fn().mockResolvedValue(undefined);

    render(
      <View
        {...baseProps}
        supervisionRequests={[
          {
            id: 'request-1',
            organizationId: 'org-1',
            sessionId: 'session-1',
            clientId: 'client-1',
            btTherapistId: 'bt-1',
            assignedAdminUserId: null,
            status: 'pending',
            createdAt: '2026-06-29T20:00:00.000Z',
            sessionStartTime: '2026-06-29T18:00:00.000Z',
            sessionEndTime: '2026-06-29T19:00:00.000Z',
            placeOfService: 'Home',
            clientName: 'Client One',
            btTherapistName: 'BT One',
            btTherapistTitle: 'BT',
            canComplete: true,
            canReturn: true,
            btReview: {
              noteId: 'bt-note-1',
              responses: {
                session_summary: 'Ready for treatment.',
                behavior_targets: ['Manding', 'Pairing'],
                parent_present: true,
                bt_signature: {
                  method: 'typed',
                  value: 'BT One',
                },
              },
              templateSnapshot: {
                sections: [
                  {
                    key: 'bt_review',
                    label: 'Completed BT ABA Session Note',
                    fields: [
                      { key: 'session_summary', label: 'Session Summary', type: 'textarea' },
                      { key: 'behavior_targets', label: 'Behavior Targets', type: 'checkbox_group' },
                      { key: 'parent_present', label: 'Parent Present', type: 'checkbox' },
                      { key: 'bt_signature', label: 'BT Signature', type: 'signature' },
                    ],
                  },
                ],
              },
              signatureMethod: 'typed',
              signedAt: '2026-06-29T19:05:00.000Z',
            },
          },
        ]}
        supervisionTemplate={{
          id: 'template-1',
          templateName: 'Supervision Session Note',
          sections: [
            {
              key: 'session_overview',
              label: 'Session overview',
              fields: [
                { key: 'purpose_of_session', label: 'Purpose of session', type: 'checkbox', options: ['Treatment plan review'] },
                { key: 'session_type', label: 'Session type', type: 'checkbox_group', options: ['Direct Supervision', 'Indirect Supervision'] },
                { key: 'link_unlinked_data', label: 'Link unlinked data', type: 'checkbox' },
                { key: 'collected_by', label: 'Collected by', type: 'select' },
                { key: 'rbt_prepared', label: 'RBT prepared', type: 'radio_group', options: ['Yes', 'No'] },
                { key: 'session_note_description', label: 'Session note description', type: 'textarea' },
                { key: 'bcba_supervisor_signature', label: 'BCBA Supervisor Signature', type: 'signature', required: true },
              ],
            },
          ],
        }}
        onCompleteSupervisionNote={onCompleteSupervisionNote}
      />,
    );

    await user.click(screen.getByRole('button', { name: /complete supervision note for client one/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Treatment plan review' }));
    await user.click(screen.getByRole('checkbox', { name: 'Direct Supervision' }));
    await user.click(screen.getByRole('checkbox', { name: 'Link unlinked data' }));
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    fireEvent.change(screen.getByLabelText('Session note description'), {
      target: { value: 'Observed prompting and feedback.' },
    });
    await user.click(screen.getByRole('radio', { name: 'Type signature' }));
    await user.type(screen.getByLabelText('Type BCBA signature'), 'Supervisor Name');

    expect(screen.getByLabelText('Type BCBA signature')).toHaveValue('Supervisor Name');
    expect(screen.getByLabelText('Correction reason')).not.toHaveAttribute('required');
    expect(screen.getByRole('button', { name: /sign and complete supervision note/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /sign and complete supervision note/i }).closest('form')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /sign and complete supervision note/i }));

    await waitFor(() => {
      expect(onCompleteSupervisionNote).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'request-1' }),
        expect.objectContaining({
          bcba_supervisor_signature: { method: 'typed', value: 'Supervisor Name' },
        }),
      );
    });
  });

  it('resets the BCBA signature state after header close', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const user = userEvent.setup();

    render(
      <View
        {...baseProps}
        supervisionRequests={[
          {
            id: 'request-1',
            organizationId: 'org-1',
            sessionId: 'session-1',
            clientId: 'client-1',
            btTherapistId: 'bt-1',
            assignedAdminUserId: null,
            status: 'pending',
            createdAt: '2026-06-29T20:00:00.000Z',
            sessionStartTime: '2026-06-29T18:00:00.000Z',
            sessionEndTime: '2026-06-29T19:00:00.000Z',
            placeOfService: 'Home',
            clientName: 'Client One',
            btTherapistName: 'BT One',
            btTherapistTitle: 'BT',
            canComplete: true,
            btReview: {
              noteId: 'bt-note-1',
              responses: {
                session_summary: 'Ready for treatment.',
              },
              templateSnapshot: {
                sections: [
                  {
                    key: 'bt_review',
                    label: 'Completed BT ABA Session Note',
                    fields: [
                      { key: 'session_summary', label: 'Session Summary', type: 'textarea' },
                    ],
                  },
                ],
              },
              signatureMethod: 'typed',
              signedAt: '2026-06-29T19:05:00.000Z',
            },
          },
        ]}
        supervisionTemplate={{
          id: 'template-1',
          templateName: 'Supervision Session Note',
          sections: [
            {
              key: 'session_overview',
              label: 'Session overview',
              fields: [
                { key: 'bcba_supervisor_signature', label: 'BCBA Supervisor Signature', type: 'signature', required: true },
              ],
            },
          ],
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /complete supervision note for client one/i }));
    await user.click(screen.getByRole('radio', { name: 'Type signature' }));
    await user.type(screen.getByLabelText('Type BCBA signature'), 'Stale Signature');
    expect(screen.getByLabelText('Type BCBA signature')).toHaveValue('Stale Signature');
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: /complete supervision note for client one/i }));
    expect(screen.getByRole('application', { name: 'Draw BCBA signature' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Type signature' }));
    expect(screen.getByLabelText('Type BCBA signature')).toHaveValue('');
  });

  it('shows review content but disables submission when only another BCBA can sign', () => {
    const View = DashboardView as React.ComponentType<any>;

    render(
      <View
        {...baseProps}
        supervisionRequests={[
          {
            id: 'request-2',
            organizationId: 'org-1',
            sessionId: 'session-2',
            clientId: 'client-2',
            btTherapistId: 'bt-2',
            assignedAdminUserId: 'bcba-2',
            status: 'pending',
            createdAt: '2026-06-29T20:00:00.000Z',
            sessionStartTime: '2026-06-29T18:00:00.000Z',
            sessionEndTime: '2026-06-29T19:00:00.000Z',
            placeOfService: 'Clinic',
            clientName: 'Client Two',
            btTherapistName: 'BT Two',
            btTherapistTitle: 'RBT',
            canComplete: false,
            btReview: {
              noteId: 'bt-note-2',
              responses: {
                session_summary: 'BT note review copy.',
              },
              templateSnapshot: {
                sections: [
                  {
                    key: 'bt_review',
                    label: 'Completed BT ABA Session Note',
                    fields: [{ key: 'session_summary', label: 'Session Summary', type: 'textarea' }],
                  },
                ],
              },
              signatureMethod: 'drawn',
              signedAt: '2026-06-29T19:05:00.000Z',
            },
          },
        ]}
        supervisionTemplate={{
          id: 'template-1',
          templateName: 'Supervision Session Note',
          sections: [
            {
              key: 'session_overview',
              label: 'Session overview',
              fields: [
                { key: 'bcba_supervisor_signature', label: 'BCBA Supervisor Signature', type: 'signature', required: true },
              ],
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /complete supervision note for client two/i }));

    expect(screen.getByRole('heading', { name: 'Completed BT ABA Session Note' })).toBeInTheDocument();
    expect(screen.getByText('BT note review copy.')).toBeInTheDocument();
    expect(screen.getByText('Only the assigned BCBA can complete and sign this supervision note.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign and complete supervision note/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('renders BCBA status labels, immutable BT versions, and correction metadata in the modal', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const user = userEvent.setup();

    render(
      <View
        {...baseProps}
        supervisionRequests={[
          {
            id: 'request-3',
            organizationId: 'org-1',
            sessionId: 'session-3',
            clientId: 'client-3',
            btTherapistId: 'bt-3',
            assignedAdminUserId: 'bcba-3',
            status: 'resubmitted',
            statusLabel: 'Resubmitted',
            createdAt: '2026-07-01T20:00:00.000Z',
            sessionStartTime: '2026-07-01T18:00:00.000Z',
            sessionEndTime: '2026-07-01T19:00:00.000Z',
            placeOfService: 'Clinic',
            clientName: 'Client Three',
            btTherapistName: 'BT Three',
            btTherapistTitle: 'RBT',
            canComplete: true,
            canReturn: true,
            latestVersionNumber: 2,
            correction: {
              id: 'correction-1',
              round: 1,
              reason: 'Please add the replacement behavior details.',
              requestedAt: '2026-07-01T19:15:00.000Z',
              reviewerUserId: 'bcba-3',
            },
            versions: [
              {
                versionNumber: 1,
                noteId: 'bt-note-3-v1',
                source: 'original',
                correctionRound: null,
                responses: {
                  session_summary: 'Initial submission.',
                },
                templateSnapshot: {
                  sections: [
                    {
                      key: 'bt_review',
                      label: 'Completed BT ABA Session Note',
                      fields: [{ key: 'session_summary', label: 'Session Summary', type: 'textarea' }],
                    },
                  ],
                },
                signatureMethod: 'typed',
                signatureValue: 'BT Three',
                signedAt: '2026-07-01T19:00:00.000Z',
              },
              {
                versionNumber: 2,
                noteId: 'bt-note-3-v2',
                source: 'amendment',
                correctionRound: 1,
                responses: {
                  session_summary: 'Corrected submission.',
                },
                templateSnapshot: {
                  sections: [
                    {
                      key: 'bt_review',
                      label: 'Completed BT ABA Session Note',
                      fields: [{ key: 'session_summary', label: 'Session Summary', type: 'textarea' }],
                    },
                  ],
                },
                signatureMethod: 'drawn',
                signatureValue: 'points:[[0,0],[1,1]]',
                signedAt: '2026-07-01T19:30:00.000Z',
              },
            ],
            btReview: {
              noteId: 'bt-note-3-v2',
              responses: {
                session_summary: 'Corrected submission.',
              },
              templateSnapshot: {
                sections: [
                  {
                    key: 'bt_review',
                    label: 'Completed BT ABA Session Note',
                    fields: [{ key: 'session_summary', label: 'Session Summary', type: 'textarea' }],
                  },
                ],
              },
              signatureMethod: 'drawn',
              signedAt: '2026-07-01T19:30:00.000Z',
            },
          },
        ]}
        supervisionTemplate={{
          id: 'template-1',
          templateName: 'Supervision Session Note',
          sections: [
            {
              key: 'session_overview',
              label: 'Session overview',
              fields: [
                { key: 'bcba_supervisor_signature', label: 'BCBA Supervisor Signature', type: 'signature', required: true },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Resubmitted')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /complete supervision note for client three/i }));

    expect(screen.getAllByText('Correction round 1')).toHaveLength(2);
    expect(screen.getByText('Please add the replacement behavior details.')).toBeInTheDocument();
    expect(screen.getByText(/requested jul 1, 2026/i)).toBeInTheDocument();
    const versionHeadings = screen.getAllByRole('heading', { name: /version \d/i }).map((heading) => heading.textContent);
    expect(versionHeadings).toEqual(['Version 2', 'Version 1']);
    expect(screen.getAllByText('Corrected submission.').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Initial submission.')).toBeInTheDocument();
  });

  it('shows a Return to BT action only when the request can be returned and trims the reason', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const user = userEvent.setup();
    const onReturnSupervisionNote = vi.fn().mockResolvedValue(undefined);

    render(
      <View
        {...baseProps}
        supervisionRequests={[
          {
            id: 'request-4',
            organizationId: 'org-1',
            sessionId: 'session-4',
            clientId: 'client-4',
            btTherapistId: 'bt-4',
            assignedAdminUserId: 'bcba-4',
            status: 'pending',
            statusLabel: 'Pending Review',
            createdAt: '2026-07-02T20:00:00.000Z',
            sessionStartTime: '2026-07-02T18:00:00.000Z',
            sessionEndTime: '2026-07-02T19:00:00.000Z',
            placeOfService: 'Home',
            clientName: 'Client Four',
            btTherapistName: 'BT Four',
            btTherapistTitle: 'BT',
            canComplete: true,
            canReturn: true,
            latestVersionNumber: 1,
            correction: null,
            versions: [],
            btReview: {
              noteId: 'bt-note-4',
              responses: {},
              templateSnapshot: { sections: [] },
              signatureMethod: 'typed',
              signedAt: '2026-07-02T19:00:00.000Z',
            },
          },
        ]}
        supervisionTemplate={null}
        onReturnSupervisionNote={onReturnSupervisionNote}
      />,
    );

    await user.click(screen.getByRole('button', { name: /complete supervision note for client four/i }));
    expect(screen.getByRole('button', { name: /return to bt/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Correction reason')).not.toHaveAttribute('required');
    expect(screen.getByLabelText('Correction reason')).toHaveAttribute('aria-required', 'true');

    await user.click(screen.getByRole('button', { name: /return to bt/i }));
    const reasonInput = screen.getByLabelText('Correction reason');
    const reasonError = await screen.findByText('Correction reason is required.');
    expect(reasonInput).toHaveAttribute('aria-invalid', 'true');
    expect(reasonError).toHaveAttribute('id', 'supervision-return-reason-error');
    expect(reasonInput).toHaveAttribute('aria-describedby', 'supervision-return-reason-error');

    await user.type(reasonInput, '  Need graph details updated.  ');
    await user.click(screen.getByRole('button', { name: /return to bt/i }));

    await waitFor(() => {
      expect(onReturnSupervisionNote).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'request-4' }),
        'Need graph details updated.',
      );
    });
  });

  it('allows a 2000 character correction reason and rejects 2001 characters', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const user = userEvent.setup();
    const onReturnSupervisionNote = vi.fn().mockResolvedValue(undefined);
    const validReason = 'a'.repeat(2000);
    const invalidReason = 'b'.repeat(2001);

    render(
      <View
        {...baseProps}
        supervisionRequests={[
          {
            id: 'request-4b',
            organizationId: 'org-1',
            sessionId: 'session-4b',
            clientId: 'client-4b',
            btTherapistId: 'bt-4b',
            assignedAdminUserId: 'bcba-4b',
            status: 'pending',
            statusLabel: 'Pending Review',
            createdAt: '2026-07-02T20:00:00.000Z',
            sessionStartTime: '2026-07-02T18:00:00.000Z',
            sessionEndTime: '2026-07-02T19:00:00.000Z',
            placeOfService: 'Home',
            clientName: 'Client Four B',
            btTherapistName: 'BT Four B',
            btTherapistTitle: 'BT',
            canComplete: true,
            canReturn: true,
            latestVersionNumber: 1,
            correction: null,
            versions: [],
            btReview: {
              noteId: 'bt-note-4b',
              responses: {},
              templateSnapshot: { sections: [] },
              signatureMethod: 'typed',
              signedAt: '2026-07-02T19:00:00.000Z',
            },
          },
        ]}
        supervisionTemplate={null}
        onReturnSupervisionNote={onReturnSupervisionNote}
      />,
    );

    await user.click(screen.getByRole('button', { name: /complete supervision note for client four b/i }));
    const reasonInput = screen.getByLabelText('Correction reason');

    fireEvent.change(reasonInput, { target: { value: validReason } });
    await user.click(screen.getByRole('button', { name: /return to bt/i }));

    await waitFor(() => {
      expect(onReturnSupervisionNote).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'request-4b' }),
        validReason,
      );
    });

    render(
      <View
        {...baseProps}
        supervisionRequests={[
          {
            id: 'request-4c',
            organizationId: 'org-1',
            sessionId: 'session-4c',
            clientId: 'client-4c',
            btTherapistId: 'bt-4c',
            assignedAdminUserId: 'bcba-4c',
            status: 'pending',
            statusLabel: 'Pending Review',
            createdAt: '2026-07-02T20:00:00.000Z',
            sessionStartTime: '2026-07-02T18:00:00.000Z',
            sessionEndTime: '2026-07-02T19:00:00.000Z',
            placeOfService: 'Home',
            clientName: 'Client Four C',
            btTherapistName: 'BT Four C',
            btTherapistTitle: 'BT',
            canComplete: true,
            canReturn: true,
            latestVersionNumber: 1,
            correction: null,
            versions: [],
            btReview: {
              noteId: 'bt-note-4c',
              responses: {},
              templateSnapshot: { sections: [] },
              signatureMethod: 'typed',
              signedAt: '2026-07-02T19:00:00.000Z',
            },
          },
        ]}
        supervisionTemplate={null}
        onReturnSupervisionNote={onReturnSupervisionNote}
      />,
    );

    await user.click(screen.getByRole('button', { name: /complete supervision note for client four c/i }));
    const invalidReasonInput = screen.getByLabelText('Correction reason');
    fireEvent.change(invalidReasonInput, { target: { value: invalidReason } });
    await user.click(screen.getByRole('button', { name: /return to bt/i }));

    expect(await screen.findByText('Correction reason must be 2000 characters or fewer.')).toBeInTheDocument();
  });

  it('does not allow correction-required requests to be completed', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const user = userEvent.setup();

    render(
      <View
        {...baseProps}
        supervisionRequests={[
          {
            id: 'request-5',
            organizationId: 'org-1',
            sessionId: 'session-5',
            clientId: 'client-5',
            btTherapistId: 'bt-5',
            assignedAdminUserId: 'bcba-5',
            status: 'correction_required',
            statusLabel: 'Correction Required',
            createdAt: '2026-07-03T20:00:00.000Z',
            sessionStartTime: '2026-07-03T18:00:00.000Z',
            sessionEndTime: '2026-07-03T19:00:00.000Z',
            placeOfService: 'School',
            clientName: 'Client Five',
            btTherapistName: 'BT Five',
            btTherapistTitle: 'RBT',
            canComplete: true,
            canReturn: false,
            latestVersionNumber: 1,
            correction: {
              id: 'correction-2',
              round: 2,
              reason: 'Missing intervention notes.',
              requestedAt: '2026-07-03T19:05:00.000Z',
              reviewerUserId: 'bcba-5',
            },
            versions: [],
            btReview: {
              noteId: 'bt-note-5',
              responses: {},
              templateSnapshot: { sections: [] },
              signatureMethod: 'typed',
              signedAt: '2026-07-03T19:00:00.000Z',
            },
          },
        ]}
        supervisionTemplate={{
          id: 'template-1',
          templateName: 'Supervision Session Note',
          sections: [
            {
              key: 'session_overview',
              label: 'Session overview',
              fields: [
                { key: 'bcba_supervisor_signature', label: 'BCBA Supervisor Signature', type: 'signature', required: true },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Correction Required')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /complete supervision note for client five/i }));

    expect(screen.getByRole('button', { name: /sign and complete supervision note/i })).toBeDisabled();
    expect(screen.getByText('This supervision note must be corrected by the BT before it can be completed.')).toBeInTheDocument();
  });

  it('renders BT correction details, prefills the latest narrative, and requires a fresh signature', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const user = userEvent.setup();

    render(
      <View
        {...baseProps}
        btCorrectionTasks={[makeBtCorrectionTask()]}
        onResubmitBtCorrection={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: /corrections required/i })).toBeInTheDocument();
    expect(screen.getByText('Correct the setting narrative.')).toBeInTheDocument();
    expect(screen.getByText(/requested jul 18, 2026/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /amend bt note for client bt/i }));

    expect(screen.getByDisplayValue('Original setting narrative')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Type signature' }));
    expect(screen.getByLabelText('Type Behavior Technician signature')).toHaveValue('');
    expect(screen.getByRole('button', { name: /re-attest and resubmit/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /finalize session/i })).not.toBeInTheDocument();
  });

  it('validates and submits a BT correction exactly once after a fresh signature', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const user = userEvent.setup();
    const onResubmitBtCorrection = vi.fn().mockResolvedValue(undefined);

    render(
      <View
        {...baseProps}
        btCorrectionTasks={[makeBtCorrectionTask()]}
        onResubmitBtCorrection={onResubmitBtCorrection}
      />,
    );

    await user.click(screen.getByRole('button', { name: /amend bt note for client bt/i }));
    await user.click(screen.getByRole('radio', { name: 'Type signature' }));
    fireEvent.change(screen.getByLabelText('Type Behavior Technician signature'), {
      target: { value: 'BT Fresh Signature' },
    });

    const submitButton = screen.getByRole('button', { name: /re-attest and resubmit/i });
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);

    await waitFor(() => {
      expect(onResubmitBtCorrection).toHaveBeenCalledTimes(1);
    });
    expect(onResubmitBtCorrection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bt-task-1' }),
      expect.objectContaining({
        progress_toward_goals: 'Original setting narrative',
        bt_signature: { method: 'typed', value: 'BT Fresh Signature' },
      }),
    );
  });

  it('blocks rapid double-click resubmits before parent rerender', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const user = userEvent.setup();
    let resolveSubmit: (() => void) | null = null;
    const onResubmitBtCorrection = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    }));

    render(
      <View
        {...baseProps}
        btCorrectionTasks={[makeBtCorrectionTask()]}
        onResubmitBtCorrection={onResubmitBtCorrection}
      />,
    );

    await user.click(screen.getByRole('button', { name: /amend bt note for client bt/i }));
    await user.click(screen.getByRole('radio', { name: 'Type signature' }));
    await user.type(screen.getByLabelText('Type Behavior Technician signature'), 'BT Fresh Signature');

    const submitButton = screen.getByRole('button', { name: /re-attest and resubmit/i });
    expect(submitButton).toBeEnabled();

    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    expect(onResubmitBtCorrection).toHaveBeenCalledTimes(1);
    expect(submitButton).toBeDisabled();

    resolveSubmit?.();

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Amend BT Note' })).not.toBeInTheDocument();
    });
  });

  it('focuses the first invalid BT correction field after validation fails', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const user = userEvent.setup();
    const onResubmitBtCorrection = vi.fn();

    render(
      <View
        {...baseProps}
        btCorrectionTasks={[makeBtCorrectionTask()]}
        onResubmitBtCorrection={onResubmitBtCorrection}
      />,
    );

    await user.click(screen.getByRole('button', { name: /amend bt note for client bt/i }));
    const purposeCheckbox = screen.getByRole('checkbox', { name: /rbt\/bt worked on goals as stated in the treatment plan/i });
    expect(purposeCheckbox).toBeChecked();
    await user.click(purposeCheckbox);
    expect(purposeCheckbox).not.toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Type signature' }));
    await user.type(screen.getByLabelText('Type Behavior Technician signature'), 'BT Fresh Signature');
    await user.click(screen.getByRole('button', { name: /re-attest and resubmit/i }));

    await waitFor(() => {
      expect(screen.getByText('Purpose of Session').closest('fieldset')?.querySelector('[data-field="purpose_of_session"]')).toHaveFocus();
    });
  });

  it('shows a normalization error for an invalid latest BT correction payload', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const user = userEvent.setup();

    render(
      <View
        {...baseProps}
        btCorrectionTasks={[
          makeBtCorrectionTask({
            latestVersion: {
              versionNumber: 2,
              noteId: 'bt-note-v2',
              source: 'amendment',
              correctionRound: 1,
              responses: { progress_toward_goals: 'Only one field present' },
              templateSnapshot: { sections: [] },
              signatureMethod: 'typed',
              signatureValue: 'Old signature',
              signedAt: '2026-07-18T17:30:00.000Z',
            },
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /amend bt note for client bt/i }));

    expect(await screen.findByText('The latest BT note payload could not be prepared for correction.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /re-attest and resubmit/i })).not.toBeInTheDocument();
  });

  it('does not show a BT correction empty state when no tasks are provided', () => {
    const View = DashboardView as React.ComponentType<any>;

    render(
      <View
        {...baseProps}
        btCorrectionTasks={[]}
      />,
    );

    expect(screen.queryByRole('heading', { name: /corrections required/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/no bt corrections are due/i)).not.toBeInTheDocument();
  });

  it('blocks submit when a required checkbox group has no selection', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const onCompleteSupervisionNote = vi.fn().mockResolvedValue(undefined);

    render(
      <View
        {...baseProps}
        supervisionRequests={[
          {
            id: 'request-1',
            organizationId: 'org-1',
            sessionId: 'session-1',
            clientId: 'client-1',
            btTherapistId: 'bt-1',
            assignedAdminUserId: null,
            status: 'pending',
            createdAt: '2026-06-29T20:00:00.000Z',
            sessionStartTime: '2026-06-29T18:00:00.000Z',
            sessionEndTime: '2026-06-29T19:00:00.000Z',
            clientName: 'Client One',
            btTherapistName: 'BT One',
            btTherapistTitle: 'BT',
          },
        ]}
        supervisionTemplate={{
          id: 'template-1',
          templateName: 'Supervision Session Note',
          sections: [
            {
              key: 'session_overview',
              label: 'Session overview',
              fields: [
                {
                  key: 'rbt_support_received',
                  label: 'RBT support received',
                  type: 'checkbox_group',
                  required: true,
                  options: ['Performance feedback', 'Protocol review'],
                },
              ],
            },
          ],
        }}
        onCompleteSupervisionNote={onCompleteSupervisionNote}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /complete supervision note for client one/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign and complete supervision note/i }));

    expect(await screen.findByText('Select at least one RBT support received.')).toBeInTheDocument();
    expect(onCompleteSupervisionNote).not.toHaveBeenCalled();
  });

  it('blocks submit when a conditional required field is triggered by an Other selection', async () => {
    const View = DashboardView as React.ComponentType<any>;
    const onCompleteSupervisionNote = vi.fn().mockResolvedValue(undefined);

    render(
      <View
        {...baseProps}
        supervisionRequests={[
          {
            id: 'request-1',
            organizationId: 'org-1',
            sessionId: 'session-1',
            clientId: 'client-1',
            btTherapistId: 'bt-1',
            assignedAdminUserId: null,
            status: 'pending',
            createdAt: '2026-06-29T20:00:00.000Z',
            sessionStartTime: '2026-06-29T18:00:00.000Z',
            sessionEndTime: '2026-06-29T19:00:00.000Z',
            clientName: 'Client One',
            btTherapistName: 'BT One',
            btTherapistTitle: 'BT',
          },
        ]}
        supervisionTemplate={{
          id: 'template-1',
          templateName: 'Supervision Session Note',
          sections: [
            {
              key: 'session_overview',
              label: 'Session overview',
              fields: [
                {
                  key: 'purpose_of_session',
                  label: 'Purpose of session',
                  type: 'checkbox_group',
                  required: true,
                  options: ['Direct Supervision', 'Other'],
                },
                {
                  key: 'purpose_of_session_other',
                  label: 'Other',
                  type: 'text',
                  required_when: 'purpose_of_session includes Other',
                },
              ],
            },
          ],
        }}
        onCompleteSupervisionNote={onCompleteSupervisionNote}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /complete supervision note for client one/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
    fireEvent.click(screen.getByRole('button', { name: /sign and complete supervision note/i }));

    expect(await screen.findByText('Other is required.')).toBeInTheDocument();
    expect(onCompleteSupervisionNote).not.toHaveBeenCalled();
  });

  it('shows supervision queue load failures instead of a false empty state', () => {
    const View = DashboardView as React.ComponentType<any>;

    render(
      <View
        {...baseProps}
        supervisionRequests={[]}
        supervisionRequestsError={new Error('Reconcile failed')}
      />,
    );

    expect(screen.getByText('Unable to load supervision notes due.')).toBeInTheDocument();
    expect(screen.queryByText('No supervision notes are due.')).not.toBeInTheDocument();
  });

  it('shows supervision queue loading without a false empty state', () => {
    const View = DashboardView as React.ComponentType<any>;

    render(
      <View
        {...baseProps}
        supervisionRequests={[]}
        isLoadingSupervisionRequests
      />,
    );

    expect(screen.getByText('Loading supervision notes due...')).toBeInTheDocument();
    expect(screen.queryByText('No supervision notes are due.')).not.toBeInTheDocument();
  });

  it('keeps every pending supervision request actionable', () => {
    const View = DashboardView as React.ComponentType<any>;
    const requests = Array.from({ length: 6 }, (_, index) => ({
      id: `request-${index + 1}`,
      organizationId: 'org-1',
      sessionId: `session-${index + 1}`,
      clientId: `client-${index + 1}`,
      btTherapistId: 'bt-1',
      assignedAdminUserId: null,
      status: 'pending',
      createdAt: '2026-06-29T20:00:00.000Z',
      sessionStartTime: '2026-06-29T18:00:00.000Z',
      sessionEndTime: '2026-06-29T19:00:00.000Z',
      clientName: `Client ${index + 1}`,
      btTherapistName: 'BT One',
      btTherapistTitle: 'BT',
    }));

    render(
      <View
        {...baseProps}
        supervisionRequests={requests}
      />,
    );

    expect(screen.getAllByRole('button', { name: /complete supervision note for client/i })).toHaveLength(6);
    expect(screen.getByRole('button', { name: /complete supervision note for client 6/i })).toBeInTheDocument();
  });
});
