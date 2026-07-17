import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardView } from '../Dashboard';

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
