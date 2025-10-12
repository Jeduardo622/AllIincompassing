import React from 'react';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor, renderWithProviders } from '../../test/utils';
import ClientOnboarding from '../ClientOnboarding';
import * as clientMutations from '../../lib/clients/mutations';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

vi.mock('../../lib/clients/mutations', () => ({
  checkClientEmailExists: vi.fn(),
  createClient: vi.fn(),
}));

const checkEmailExistsMock = clientMutations.checkClientEmailExists as unknown as ReturnType<typeof vi.fn>;

describe('ClientOnboarding validation', () => {
  beforeEach(() => {
    checkEmailExistsMock.mockReset();
    checkEmailExistsMock.mockResolvedValue(false);
  });

  it('shows required field errors when attempting to proceed without input', async () => {
    renderWithProviders(<ClientOnboarding />);

    const nextButton = screen.getByRole('button', { name: /next/i });

    await waitFor(() => {
      expect(nextButton).not.toBeDisabled();
    });

    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText('First name is required')).toBeInTheDocument();
      expect(screen.getByText('Last name is required')).toBeInTheDocument();
      expect(screen.getByText('Date of birth is required')).toBeInTheDocument();
      expect(screen.getByText('Email is required')).toBeInTheDocument();
    });

    expect(screen.queryByText('Parent/Guardian Information')).not.toBeInTheDocument();
  });

  it('disables step progression when email already exists', async () => {
    checkEmailExistsMock.mockResolvedValue(true);

    renderWithProviders(<ClientOnboarding />);

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Jamie' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '2015-01-01' } });

    const emailInput = screen.getByLabelText(/email/i);
    fireEvent.change(emailInput, { target: { value: 'duplicate@example.com' } });
    fireEvent.blur(emailInput);

    await waitFor(() => {
      expect(screen.getByText('A client with this email address already exists')).toBeInTheDocument();
    });

    const nextButton = screen.getByRole('button', { name: /next/i });
    expect(nextButton).toBeDisabled();
  });

  it('advances to the parent information step when required fields are provided', async () => {
    renderWithProviders(<ClientOnboarding />);

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Jamie' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Rivera' } });
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '2012-05-01' } });
    const emailInput = screen.getByLabelText(/email/i);
    fireEvent.change(emailInput, { target: { value: 'jamie@example.com' } });
    fireEvent.blur(emailInput);

    await waitFor(() => {
      expect(checkEmailExistsMock).toHaveBeenCalledWith(expect.anything(), 'jamie@example.com');
    });

    await waitFor(() => {
      expect(screen.queryByText(/checking email availability/i)).not.toBeInTheDocument();
    });

    const nextButton = screen.getByRole('button', { name: /next/i });

    await waitFor(() => {
      expect(nextButton).not.toBeDisabled();
    });

    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText('Primary Parent/Guardian')).toBeInTheDocument();
    });
  });
});
