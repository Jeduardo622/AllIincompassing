import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, userEvent } from '../../test/utils';
import ClientDetails from '../ClientDetails';
import { supabase } from '../../lib/supabase';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ clientId: 'client-1' }),
    useNavigate: () => vi.fn(),
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
  __esModule: true,
  default: () => <div>ProfileTabContent</div>,
}));

vi.mock('../../components/ClientDetails/SessionNotesTab', () => ({
  __esModule: true,
  default: () => <div>SessionNotesTabContent</div>,
}));

vi.mock('../../components/ClientDetails/ProgramsGoalsTab', () => ({
  __esModule: true,
  default: () => <div>ProgramsGoalsTabContent</div>,
}));

vi.mock('../../components/ClientDetails/PreAuthTab', () => ({
  __esModule: true,
  default: () => <div>PreAuthTabContent</div>,
}));

vi.mock('../../components/ClientDetails/ServiceContractsTab', () => ({
  __esModule: true,
  default: () => <div>ServiceContractsTabContent</div>,
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
  });
});
