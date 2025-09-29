import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '../../test/utils';
import { renderWithProviders } from '../../test/utils';
import ClientModal from '../ClientModal';

const getInputByName = (name: string) => {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);

  if (!input) {
    throw new Error(`Input with name attribute "${name}" was not found`);
  }

  return input;
};

describe('ClientModal validation', () => {
  it('shows inline errors and disables submit when required fields are missing', async () => {
    const handleSubmit = vi.fn();

    renderWithProviders(
      <ClientModal
        isOpen
        onClose={() => {}}
        onSubmit={handleSubmit}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /create client/i }));

    await waitFor(() => {
      expect(screen.getByText('First name is required')).toBeInTheDocument();
      expect(screen.getByText('Last name is required')).toBeInTheDocument();
      expect(screen.getByText('Date of birth is required')).toBeInTheDocument();
      expect(screen.getByText('Email is required')).toBeInTheDocument();
    });

    const submitButton = screen.getByRole('button', { name: /create client/i });
    expect(submitButton).toBeDisabled();
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('shows a JSON validation error when insurance information is invalid', async () => {
    const handleSubmit = vi.fn();

    renderWithProviders(
      <ClientModal
        isOpen
        onClose={() => {}}
        onSubmit={handleSubmit}
      />
    );

    fireEvent.change(getInputByName('first_name'), { target: { value: 'Jamie' } });
    fireEvent.change(getInputByName('last_name'), { target: { value: 'Rivera' } });
    fireEvent.change(getInputByName('date_of_birth'), { target: { value: '2012-05-01' } });
    fireEvent.change(getInputByName('email'), { target: { value: 'jamie@example.com' } });

    const insuranceField = screen.getByPlaceholderText('Enter insurance information in JSON format');
    fireEvent.change(insuranceField, { target: { value: 'not-json' } });

    fireEvent.click(screen.getByRole('button', { name: /create client/i }));

    await waitFor(() => {
      expect(screen.getByText('Insurance information must be valid JSON')).toBeInTheDocument();
    });

    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('prevents submission when unit inputs contain negative values', async () => {
    const handleSubmit = vi.fn();

    renderWithProviders(
      <ClientModal
        isOpen
        onClose={() => {}}
        onSubmit={handleSubmit}
      />
    );

    fireEvent.change(getInputByName('first_name'), { target: { value: 'Jamie' } });
    fireEvent.change(getInputByName('last_name'), { target: { value: 'Rivera' } });
    fireEvent.change(getInputByName('date_of_birth'), { target: { value: '2012-05-01' } });
    fireEvent.change(getInputByName('email'), { target: { value: 'jamie@example.com' } });

    fireEvent.change(getInputByName('one_to_one_units'), { target: { value: -5 } });

    fireEvent.click(screen.getByRole('button', { name: /create client/i }));

    await waitFor(() => {
      expect(screen.getByText('1:1 units must be 0 or greater')).toBeInTheDocument();
    });

    expect(handleSubmit).not.toHaveBeenCalled();
  });
});
