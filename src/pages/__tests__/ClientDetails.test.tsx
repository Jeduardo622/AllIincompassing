import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, userEvent } from '../../test/utils';
import { ClientDetails } from '../ClientDetails';
import { supabase } from '../../lib/supabase';
import { fetchClientById } from '../../lib/clients/fetchers';

let mockLocationSearch = '';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ clientId: 'client-1' }),
    useNavigate: () => vi.fn(),
    useLocation: () => ({
      pathname: '/clients/client-1',
      search: mockLocationSearch,
      hash: '',
      state: null,
      key: 'client-details-test',
    }),
  };
});

vi.mock('../../lib/clients/fetchers', () => ({
  fetchClientById: vi.fn(async () => ({
    id: 'client-1',
    full_name: 'Alyana Perez',
    therapist_id: 'admin-user-id',
    authorized_hours_per_month: 12,
  })),
}));

vi.mock('../../components/ClientDetails/ProfileTab', () => ({
  ProfileTab: () => <div>ProfileTabContent</div>,
}));

vi.mock('../../components/ClientDetails/SessionNotesTab', () => ({
  SessionNotesTab: () => <div>SessionNotesTabContent</div>,
}));

vi.mock('../../components/ClientDetails/ProgramsGoalsTab', () => ({
  __esModule: true,
  ProgramsGoalsTab: () => <div>ProgramsGoalsTabContent</div>,
}));

vi.mock('../../components/ClientDetails/PreAuthTab', () => ({
  PreAuthTab: () => <div>PreAuthTabContent</div>,
}));

vi.mock('../../components/ClientDetails/ServiceContractsTab', () => ({
  ServiceContractsTab: () => <div>ServiceContractsTabContent</div>,
}));

const createSessionsBuilder = () => {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.neq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  return builder;
};

const createIssuesBuilder = () => {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.neq = vi.fn(async () => ({ count: 0, error: null }));
  return builder;
};

describe('ClientDetails page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocationSearch = '';
    vi.mocked(fetchClientById).mockResolvedValue({
      id: 'client-1',
      full_name: 'Alyana Perez',
      therapist_id: 'admin-user-id',
      authorized_hours_per_month: 12,
    });
    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'sessions') {
        return createSessionsBuilder();
      }
      if (table === 'client_issues') {
        return createIssuesBuilder();
      }
      return createIssuesBuilder();
    });
  });

  it('switches between client-record tabs and renders tab content', async () => {
    renderWithProviders(<ClientDetails />);

    await waitFor(() => expect(screen.getByText('ProfileTabContent')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Session Notes \/ Physical Auth/i }));
    expect(screen.getByText('SessionNotesTabContent')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Programs & Goals/i }));
    expect(screen.getByText('ProgramsGoalsTabContent')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Pre-Authorizations/i }));
    expect(screen.getByText('PreAuthTabContent')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Service Contracts/i }));
    expect(screen.getByText('ServiceContractsTabContent')).toBeInTheDocument();
  }, 15000);

  it('selects Session Notes tab from tab query param', async () => {
    mockLocationSearch = '?tab=session-notes';

    renderWithProviders(<ClientDetails />);

    await waitFor(() => expect(screen.getByText('SessionNotesTabContent')).toBeInTheDocument());
    expect(screen.queryByText('ProfileTabContent')).not.toBeInTheDocument();
  });

  it('selects Programs & Goals tab from tab query param', async () => {
    mockLocationSearch = '?tab=programs-goals';

    renderWithProviders(<ClientDetails />);

    await waitFor(() => expect(screen.getByText('ProgramsGoalsTabContent')).toBeInTheDocument());
    await waitFor(() => expect(supabase.from).toHaveBeenCalledWith('sessions'));
    expect(supabase.from).toHaveBeenCalledWith('client_issues');
    expect(screen.queryByText('ProfileTabContent')).not.toBeInTheDocument();
  });

  it('does not render Programs & Goals or summary queries for an unassigned therapist deeplink', async () => {
    mockLocationSearch = '?tab=programs-goals';
    vi.mocked(fetchClientById).mockResolvedValue({
      id: 'client-1',
      full_name: 'Alyana Perez',
      therapist_id: 'different-therapist-id',
      authorized_hours_per_month: 12,
    });

    renderWithProviders(<ClientDetails />, {
      auth: { role: 'therapist', userId: 'therapist-user-id' },
    });

    await waitFor(() => expect(screen.getByText('You are not assigned to this client')).toBeInTheDocument());

    expect(screen.queryByText('ProgramsGoalsTabContent')).not.toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('does not render Programs & Goals or summary queries for a client viewing another record', async () => {
    mockLocationSearch = '?tab=programs-goals';

    renderWithProviders(<ClientDetails />, {
      auth: { role: 'client', userId: 'different-client-id' },
    });

    await waitFor(() => expect(screen.getByText('You can only view your own record')).toBeInTheDocument());

    expect(screen.queryByText('ProgramsGoalsTabContent')).not.toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

