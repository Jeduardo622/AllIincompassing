import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { ClientOnboarding } from '../ClientOnboarding';
import { showError } from '../../lib/toast';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../lib/authContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    profile: { id: 'user-1', role: 'admin' },
    isAdmin: () => true,
    isSuperAdmin: () => false,
  }),
}));

vi.mock('../../lib/organization', () => ({
  useActiveOrganizationId: () => 'org-1',
}));

vi.mock('../../lib/supabase', () => {
  const uploadMock = vi.fn().mockResolvedValue({ error: null });
  return {
    supabase: {
      storage: {
        from: vi.fn(() => ({
          upload: uploadMock,
        })),
      },
    },
  };
});

const checkClientEmailExistsMock = vi.fn();
const createClientMock = vi.fn();
const callEdgeFunctionHttpMock = vi.fn();

vi.mock('../../lib/clients/mutations', () => ({
  checkClientEmailExists: (...args: unknown[]) => checkClientEmailExistsMock(...args),
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock('../../lib/api', () => ({
  callEdgeFunctionHttp: (...args: unknown[]) => callEdgeFunctionHttpMock(...args),
}));

vi.mock('../../lib/toast', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('../../lib/logger/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ClientOnboarding step progression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    callEdgeFunctionHttpMock.mockReset();
    checkClientEmailExistsMock.mockResolvedValue(false);
    createClientMock.mockResolvedValue({ id: 'client-123' });
  });

  const setup = (initialPath: string = '/clients/new') => {
    const queryClient = new QueryClient();
    const user = userEvent.setup();
    const onComplete = vi.fn();

    render(
      <MemoryRouter initialEntries={[initialPath]}>
        <QueryClientProvider client={queryClient}>
          <ClientOnboarding onComplete={onComplete} />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    return { user, onComplete };
  };

  const advanceToServiceStep = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText('First Name'), 'Ada');
    await user.type(screen.getByLabelText('Last Name'), 'Lovelace');
    await user.type(screen.getByLabelText('Date of Birth'), '2010-01-01');
    const emailInput = screen.getByLabelText('Email');
    await user.type(emailInput, 'ada@example.com');
    await user.tab();

    await waitFor(() => {
      expect(checkClientEmailExistsMock).toHaveBeenCalled();
    });

    const nextButton = () => screen.getByRole('button', { name: 'Next' });

    await user.click(nextButton());
    await screen.findByText('Parent/Guardian Information');

    await user.click(nextButton());
    await screen.findByText('Address & Contact Information');

    await user.click(nextButton());
    await screen.findByText('Service Information');
  };

  it('blocks advancing from service step when insurance contracts are missing', async () => {
    const { user, onComplete } = setup();

    await advanceToServiceStep(user);

    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByText('Service Information');
    await screen.findByText('Add at least one insurance contract');
    expect(createClientMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  }, 15000);

  it('prevents submit from bypassing service-step validations', async () => {
    const { user, onComplete } = setup();

    await advanceToServiceStep(user);

    const form = screen.getByText('Service Information').closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await screen.findByText('Service Information');
    expect(createClientMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  }, 15000);

  it('keeps service step gated even when next is clicked repeatedly', async () => {
    const { user, onComplete } = setup();

    await advanceToServiceStep(user);

    const nextButton = screen.getByRole('button', { name: 'Next' });

    await user.click(nextButton);
    await user.click(nextButton);
    await screen.findByText('Service Information');
    await screen.findByText('Add at least one insurance contract');
    expect(createClientMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  }, 15000);

  it('fails closed when email uniqueness check is unavailable', async () => {
    const { user, onComplete } = setup();
    checkClientEmailExistsMock.mockRejectedValueOnce(new Error('supabase unavailable'));

    await user.type(screen.getByLabelText('First Name'), 'Ada');
    await user.type(screen.getByLabelText('Last Name'), 'Lovelace');
    const emailInput = screen.getByLabelText('Email');
    await user.type(emailInput, 'ada@example.com');
    await user.tab();

    await screen.findByText('Unable to validate email. Please try again.');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(createClientMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(vi.mocked(showError)).not.toHaveBeenCalled();
  });

  it('hydrates fields from secure prefill token and strips query params after success', async () => {
    callEdgeFunctionHttpMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        prefill: {
          first_name: 'Token',
          last_name: 'User',
          email: 'token@example.com',
          referral_source: 'Care coordinator',
          service_preference: ['ABA'],
        },
      }),
    });

    setup('/clients/new?prefill_token=4fd7922b-9cd7-4f01-8ee2-ccf1f5508f98');

    await waitFor(() => {
      expect(callEdgeFunctionHttpMock).toHaveBeenCalledWith('initiate-client-onboarding', expect.objectContaining({
        method: 'POST',
      }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('First Name')).toHaveValue('Token');
      expect(screen.getByLabelText('Last Name')).toHaveValue('User');
      expect(screen.getByLabelText('Email')).toHaveValue('token@example.com');
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      { pathname: '/clients/new', search: '' },
      { replace: true },
    );
  });

  it('shows retry UI on consume failure while keeping token in memory', async () => {
    callEdgeFunctionHttpMock.mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'prefill_not_found' }),
    });

    const { user } = setup('/clients/new?prefill_token=4fd7922b-9cd7-4f01-8ee2-ccf1f5508f98');

    await waitFor(() => {
      expect(callEdgeFunctionHttpMock).toHaveBeenCalled();
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      { pathname: '/clients/new', search: '' },
      { replace: true },
    );
    expect(vi.mocked(showError)).toHaveBeenCalledWith(
      'This onboarding link has expired or is invalid. Please request a new link.',
    );
    await screen.findByText('This onboarding token could not be loaded. Please request a new onboarding link.');

    await user.click(screen.getByRole('button', { name: 'Retry secure prefill' }));
    await waitFor(() => {
      expect(callEdgeFunctionHttpMock).toHaveBeenCalledTimes(2);
    });
  });

  it('ignores legacy plaintext query prefill fields', () => {
    setup('/clients/new?email=legacy%40example.com&first_name=Legacy');
    expect(screen.getByLabelText('First Name')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('');
  });
});

