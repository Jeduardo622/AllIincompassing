import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import ClientOnboarding from '../ClientOnboarding';

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

vi.mock('../../lib/clients/mutations', () => ({
  checkClientEmailExists: (...args: unknown[]) => checkClientEmailExistsMock(...args),
  createClient: (...args: unknown[]) => createClientMock(...args),
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
    checkClientEmailExistsMock.mockResolvedValue(false);
    createClientMock.mockResolvedValue({ id: 'client-123' });
  });

  const setup = () => {
    const queryClient = new QueryClient();
    const user = userEvent.setup();
    const onComplete = vi.fn();

    render(
      <MemoryRouter>
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
    expect(screen.getByText('Parent/Guardian Information')).toBeInTheDocument();

    await user.click(nextButton());
    expect(screen.getByText('Address & Contact Information')).toBeInTheDocument();

    await user.click(nextButton());
    expect(screen.getByText('Service Information')).toBeInTheDocument();
  };

  it('blocks advancing from service step when insurance contracts are missing', async () => {
    const { user, onComplete } = setup();

    await advanceToServiceStep(user);

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Service Information')).toBeInTheDocument();
    expect(screen.getByText('Add at least one insurance contract')).toBeInTheDocument();
    expect(createClientMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  }, 15000);

  it('prevents submit from bypassing service-step validations', async () => {
    const { user, onComplete } = setup();

    await advanceToServiceStep(user);

    const form = screen.getByText('Service Information').closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(screen.getByText('Service Information')).toBeInTheDocument();
    expect(createClientMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  }, 15000);

  it('keeps service step gated even when next is clicked repeatedly', async () => {
    const { user, onComplete } = setup();

    await advanceToServiceStep(user);

    const nextButton = screen.getByRole('button', { name: 'Next' });

    await user.click(nextButton);
    await user.click(nextButton);
    expect(screen.getByText('Service Information')).toBeInTheDocument();
    expect(screen.getByText('Add at least one insurance contract')).toBeInTheDocument();
    expect(createClientMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  }, 15000);
});
