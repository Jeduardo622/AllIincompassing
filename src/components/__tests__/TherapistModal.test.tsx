import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent } from '../../test/utils';
import { TherapistModal } from '../TherapistModal';

describe('TherapistModal validation', () => {
  const renderModal = () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <TherapistModal
        isOpen
        onClose={() => {}}
        onSubmit={handleSubmit}
      />
    );

    return { handleSubmit };
  };

  it('shows errors and focuses the first invalid field on submit', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /create therapist/i }));

    await waitFor(() => {
      expect(screen.getByText('First name is required')).toBeInTheDocument();
      expect(screen.getByText('Last name is required')).toBeInTheDocument();
      expect(screen.getByText('Email is required')).toBeInTheDocument();
      expect(screen.getByText('License number is required')).toBeInTheDocument();
    });

    const firstNameInput = screen.getByLabelText(/first name/i);
    expect(firstNameInput).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(firstNameInput);
  });

  it('prevents submission when license number is missing and focuses the field', async () => {
    const { handleSubmit } = renderModal();

    await userEvent.type(screen.getByLabelText(/first name/i), 'Casey');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Morgan');
    await userEvent.type(screen.getByLabelText(/email/i), 'casey@example.com');

    await userEvent.click(screen.getByRole('button', { name: /create therapist/i }));

    await waitFor(() => {
      expect(screen.getByText('License number is required')).toBeInTheDocument();
    });

    const licenseInput = screen.getByLabelText(/license number/i);
    expect(document.activeElement).toBe(licenseInput);
    expect(handleSubmit).not.toHaveBeenCalled();
  });
});
