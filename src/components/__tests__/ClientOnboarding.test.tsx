import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import ClientOnboarding from '../ClientOnboarding';

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

  it('shows the document step before submitting the onboarding form', async () => {
    const { user, onComplete } = setup();

    await advanceToServiceStep(user);

    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('Documents & Consent')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: 'Complete Onboarding' })
    ).toBeDisabled();
    expect(createClientMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('advances to the document step when the form submits before reaching the final step', async () => {
    const { user, onComplete } = setup();

    await advanceToServiceStep(user);

    const form = screen.getByText('Service Information').closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(screen.getByText('Documents & Consent')).toBeInTheDocument();
    });

    expect(createClientMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('requires consent even when the services next button is double clicked', async () => {
    const { user, onComplete } = setup();

    await advanceToServiceStep(user);

    const nextButton = screen.getByRole('button', { name: 'Next' });

    await user.dblClick(nextButton);

    await waitFor(() => {
      expect(screen.getByText('Documents & Consent')).toBeInTheDocument();
    });

    const submitButton = screen.getByRole('button', { name: 'Complete Onboarding' });

    expect(submitButton).toBeDisabled();
    expect(createClientMock).not.toHaveBeenCalled();

    const consentCheckbox = screen.getByLabelText('I consent to the collection and processing of this information');
    await user.click(consentCheckbox);

    await waitFor(() => {
      expect(submitButton).toBeEnabled();
    });

    await user.click(submitButton);

    await waitFor(() => {
      expect(createClientMock).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
