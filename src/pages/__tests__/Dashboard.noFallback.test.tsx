import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('renders pending supervision note requests and submits grouped template fields', async () => {
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
                { key: 'purpose_of_session', label: 'Purpose of session', type: 'checkbox', options: ['Treatment plan review'] },
                { key: 'session_type', label: 'Session type', type: 'checkbox_group', options: ['Direct Supervision', 'Indirect Supervision'] },
                { key: 'link_unlinked_data', label: 'Link unlinked data', type: 'checkbox' },
                { key: 'collected_by', label: 'Collected by', type: 'select' },
                { key: 'rbt_prepared', label: 'RBT prepared', type: 'radio_group', options: ['Yes', 'No'] },
                { key: 'session_note_description', label: 'Session note description', type: 'textarea' },
              ],
            },
          ],
        }}
        onCompleteSupervisionNote={onCompleteSupervisionNote}
      />,
    );

    expect(screen.getByText('Supervision Notes Due')).toBeInTheDocument();
    expect(screen.getByText('Client One')).toBeInTheDocument();
    expect(screen.getByText(/BT One/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /complete supervision note for client one/i }));

    expect(screen.getByRole('dialog', { name: /supervision session note/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Purpose of session')).toBeInTheDocument();
    expect(screen.getByLabelText('Session type')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Link unlinked data' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Collected by' })).toBeInTheDocument();
    expect(screen.getByLabelText('RBT prepared')).toBeInTheDocument();
    expect(screen.getByLabelText('Session note description')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Treatment plan review' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Direct Supervision' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Link unlinked data' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    fireEvent.change(screen.getByLabelText('Session note description'), {
      target: { value: 'Observed prompting and feedback.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save supervision note/i }));

    await waitFor(() => {
      expect(onCompleteSupervisionNote).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'request-1' }),
        expect.objectContaining({
          purpose_of_session: ['Treatment plan review'],
          session_type: ['Direct Supervision'],
          link_unlinked_data: true,
          collected_by: '',
          rbt_prepared: 'Yes',
          session_note_description: 'Observed prompting and feedback.',
        }),
      );
    });
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
    fireEvent.click(screen.getByRole('button', { name: /save supervision note/i }));

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
    fireEvent.click(screen.getByRole('button', { name: /save supervision note/i }));

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
