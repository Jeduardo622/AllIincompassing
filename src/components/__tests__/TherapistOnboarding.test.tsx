import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent } from '../../test/utils';
import { TherapistOnboarding } from '../TherapistOnboarding';

describe('TherapistOnboarding validation', () => {
  const renderOnboarding = () => {
    const handleComplete = vi.fn();
    renderWithProviders(<TherapistOnboarding onComplete={handleComplete} />);
    return { handleComplete };
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
});
