import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent } from '../../test/utils';
import { useActiveOrganizationId } from '../../lib/organization';
import { showError, showSuccess } from '../../lib/toast';

vi.mock('../../lib/organization', () => ({
  useActiveOrganizationId: vi.fn(() => 'org-test'),
}));

vi.mock('../../lib/toast', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

const {
  fromMock,
  insertMock,
  insertSelectMock,
  insertSingleMock,
  invokeMock,
} = vi.hoisted(() => {
  const insertSingleMock = vi.fn();
  const insertSelectMock = vi.fn(() => ({
    single: insertSingleMock,
  }));
  const insertMock = vi.fn(() => ({
    select: insertSelectMock,
  }));
  const fromMock = vi.fn(() => ({
    insert: insertMock,
  }));
  const invokeMock = vi.fn();

  return {
    fromMock,
    insertMock,
    insertSelectMock,
    insertSingleMock,
    invokeMock,
  };
});

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: fromMock,
    functions: {
      invoke: invokeMock,
    },
  },
}));

const mockUseActiveOrganizationId = vi.mocked(useActiveOrganizationId);
const mockShowError = vi.mocked(showError);
const mockShowSuccess = vi.mocked(showSuccess);
import { TherapistOnboarding } from '../TherapistOnboarding';

describe('TherapistOnboarding validation', () => {
  const renderOnboarding = () => {
    const handleComplete = vi.fn();
    renderWithProviders(<TherapistOnboarding onComplete={handleComplete} />);
    return { handleComplete };
  };

  beforeEach(() => {
    mockUseActiveOrganizationId.mockReturnValue('org-test');
    mockShowError.mockClear();
    mockShowSuccess.mockClear();
    fromMock.mockClear();
    insertMock.mockClear();
    insertSelectMock.mockClear();
    insertSingleMock.mockReset();
    insertSingleMock.mockResolvedValue({
      data: {
        id: 'therapist-1',
        email: 'avery@example.com',
        organization_id: 'org-test',
        full_name: 'Avery Blake',
      },
      error: null,
    });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: null, error: null });
  });

  const advanceToFinalStep = async () => {
    await userEvent.type(screen.getByLabelText(/first name/i), 'Avery');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Blake');
    await userEvent.type(screen.getByLabelText(/email/i), 'avery@example.com');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await userEvent.type(screen.getByLabelText(/license number/i), 'LIC-12345');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText(/documents & certifications/i)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/i consent to the collection/i));
  };

  it('validates basic information before advancing', async () => {
    renderOnboarding();

    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText('First name is required')).toBeInTheDocument();
    });

    const firstNameInput = screen.getByLabelText(/first name/i);
    expect(firstNameInput).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(firstNameInput);
  });

  it('allows advancing past professional step without a license number', async () => {
    renderOnboarding();

    await userEvent.type(screen.getByLabelText(/first name/i), 'Jordan');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Lee');
    await userEvent.type(screen.getByLabelText(/email/i), 'jordan@example.com');

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/professional information/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => {
      expect(screen.getByText(/address & contact information/i)).toBeInTheDocument();
    });
  });

  it('allows submission without any uploaded documents', async () => {
    const { handleComplete } = renderOnboarding();

    await advanceToFinalStep();

    await userEvent.click(screen.getByRole('button', { name: /complete onboarding/i }));

    await waitFor(() => {
      expect(handleComplete).toHaveBeenCalledTimes(1);
    });

    expect(invokeMock).toHaveBeenCalledWith('admin-invite', {
      body: expect.objectContaining({
        email: 'avery@example.com',
        organizationId: 'org-test',
        role: 'bt',
        targetTherapistId: 'therapist-1',
      }),
    });
  }, 20000);

  it('completes onboarding with a recoverable error when invite delivery fails', async () => {
    const { handleComplete } = renderOnboarding();
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: new Error('Edge function failed'),
    });

    await advanceToFinalStep();
    await userEvent.click(screen.getByRole('button', { name: /complete onboarding/i }));

    await waitFor(() => {
      expect(handleComplete).toHaveBeenCalledTimes(1);
    });

    expect(mockShowError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('invite'),
      }),
    );
    expect(mockShowSuccess).not.toHaveBeenCalledWith('Therapist created successfully');
  }, 20000);

  it('shows an error when organization context is unavailable', async () => {
    mockUseActiveOrganizationId.mockReturnValue(null);
    renderOnboarding();

    await userEvent.type(screen.getByLabelText(/first name/i), 'Sam');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Morgan');
    await userEvent.type(screen.getByLabelText(/email/i), 'sam@example.com');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await userEvent.type(screen.getByLabelText(/license number/i), 'LIC-98765');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    const licenseFile = new File(['test'], 'license.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText(/license document upload/i), licenseFile);
    await userEvent.click(screen.getByLabelText(/i consent to the collection/i));

    await userEvent.click(screen.getByRole('button', { name: /complete onboarding/i }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledTimes(1);
    });
  }, 20000);

  it('does not submit when enter is pressed before final step', async () => {
    const { handleComplete } = renderOnboarding();

    await userEvent.type(screen.getByLabelText(/first name/i), 'Taylor');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Nguyen');
    await userEvent.type(screen.getByLabelText(/email/i), 'taylor@example.com{enter}');

    await waitFor(() => {
      expect(screen.getByText(/professional information/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/documents & certifications/i)).not.toBeInTheDocument();
    expect(handleComplete).not.toHaveBeenCalled();
  });
});
