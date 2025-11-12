import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent } from '../../test/utils';
import { useActiveOrganizationId } from '../../lib/organization';
import { showError } from '../../lib/toast';

vi.mock('../../lib/organization', () => ({
  useActiveOrganizationId: vi.fn(() => 'org-test'),
}));

vi.mock('../../lib/toast', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

const mockUseActiveOrganizationId = vi.mocked(useActiveOrganizationId);
const mockShowError = vi.mocked(showError);
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
  });

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

  it('requires a license number on the professional step', async () => {
    renderOnboarding();

    await userEvent.type(screen.getByLabelText(/first name/i), 'Jordan');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Lee');
    await userEvent.type(screen.getByLabelText(/email/i), 'jordan@example.com');

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/professional information/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText('License number is required')).toBeInTheDocument();
    });

    const licenseNumberInput = screen.getByLabelText(/license number/i);
    expect(document.activeElement).toBe(licenseNumberInput);
  });

  it('requires a license document before submission', async () => {
    renderOnboarding();

    await userEvent.type(screen.getByLabelText(/first name/i), 'Avery');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Blake');
    await userEvent.type(screen.getByLabelText(/email/i), 'avery@example.com');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await userEvent.type(screen.getByLabelText(/license number/i), 'LIC-12345');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText(/documents & certifications/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /complete onboarding/i }));

    await waitFor(() => {
      expect(screen.getByText('Professional license document is required')).toBeInTheDocument();
    });

    const licenseInput = screen.getByLabelText(/license document upload/i);
    expect(document.activeElement).toBe(licenseInput);
  });

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
  });
});
