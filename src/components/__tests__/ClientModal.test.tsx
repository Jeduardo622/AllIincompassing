import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '../../test/utils';
import { renderWithProviders } from '../../test/utils';
import { SCHOOL_DAYCARE_LABEL } from '../../lib/constants/servicePreferences';
import type { Client } from '../../types';
import { ClientModal } from '../ClientModal';

const getInputByName = (name: string) => {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);

  if (!input) {
    throw new Error(`Input with name attribute "${name}" was not found`);
  }

  return input;
};

const createClientWithContractAuthorization = (): Client => ({
  id: 'client-1',
  email: 'jamie@example.com',
  full_name: 'Jamie Rivera',
  first_name: 'Jamie',
  last_name: 'Rivera',
  date_of_birth: '2012-05-01',
  insurance_info: {
    provider: 'IEHP',
    service_contracts: [
      {
        provider: 'IEHP',
        units: 8,
        cpt_codes: ['H2019'],
        code_authorizations: [
          {
            code: 'H2019',
            units: 8,
            auth_start_date: '2026-01-01',
            auth_end_date: '2026-12-31',
          },
        ],
      },
    ],
  },
  service_preference: [],
  one_to_one_units: 0,
  supervision_units: 0,
  parent_consult_units: 0,
  assessment_units: 0,
  auth_units: 8,
  availability_hours: {},
  created_at: '2026-01-01T00:00:00.000Z',
});

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
    });

    const submitButton = screen.getByRole('button', { name: /create client/i });
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });
    expect(handleSubmit).not.toHaveBeenCalled();
  }, 15000);

  it('renders insurance contract controls instead of a raw insurance JSON input', () => {
    const handleSubmit = vi.fn();

    renderWithProviders(
      <ClientModal
        isOpen
        onClose={() => {}}
        onSubmit={handleSubmit}
      />
    );

    expect(screen.getByRole('button', { name: /add insurance/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter insurance information in JSON format (optional)')).not.toBeInTheDocument();
  });

  it('saves clients that do not provide an email', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

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

    fireEvent.click(screen.getByRole('button', { name: /create client/i }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalled();
    });

    const submitted = handleSubmit.mock.calls[0][0];
    expect(submitted.email).toBeNull();
  });

  it('hides legacy aggregate unit/date fields from service details', () => {
    const handleSubmit = vi.fn();

    renderWithProviders(
      <ClientModal
        isOpen
        onClose={() => {}}
        onSubmit={handleSubmit}
      />
    );

    expect(screen.queryByLabelText('1:1 Units')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Supervision Units')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Parent Consult Units')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Assessment Units')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Auth Units')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Authorization Start Date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Authorization End Date')).not.toBeInTheDocument();
  });

  it('submits selected service preferences', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

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

    fireEvent.click(screen.getByLabelText('In clinic'));
    fireEvent.click(screen.getByLabelText('Telehealth'));

    fireEvent.click(screen.getByRole('button', { name: /create client/i }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalled();
    });

    const submitted = handleSubmit.mock.calls[0][0];
    expect(submitted.service_preference).toEqual(['In clinic', 'Telehealth']);
  });

  it('supports the school/daycare/preschool preference option', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <ClientModal
        isOpen
        onClose={() => {}}
        onSubmit={handleSubmit}
      />,
    );

    fireEvent.change(getInputByName('first_name'), { target: { value: 'Luca' } });
    fireEvent.change(getInputByName('last_name'), { target: { value: 'Diaz' } });
    fireEvent.change(getInputByName('date_of_birth'), { target: { value: '2015-09-21' } });
    fireEvent.change(getInputByName('email'), { target: { value: 'luca@example.com' } });

    fireEvent.click(screen.getByLabelText(SCHOOL_DAYCARE_LABEL));

    fireEvent.click(screen.getByRole('button', { name: /create client/i }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalled();
    });

    const submitted = handleSubmit.mock.calls[0][0];
    expect(submitted.service_preference).toEqual([SCHOOL_DAYCARE_LABEL]);
  });

  it('honors external saving state when provided', () => {
    const handleSubmit = vi.fn();

    renderWithProviders(
      <ClientModal
        isOpen
        onClose={() => {}}
        onSubmit={handleSubmit}
        isSaving
      />,
    );

    const submitButton = screen.getByRole('button', { name: /create client/i });
    expect(submitButton).toHaveTextContent('Saving...');
    expect(submitButton).toBeDisabled();
  });

  it('shows the provided error banner when saveError is set', () => {
    const handleSubmit = vi.fn();
    const errorMessage = 'Unable to save client';

    renderWithProviders(
      <ClientModal
        isOpen
        onClose={() => {}}
        onSubmit={handleSubmit}
        saveError={errorMessage}
      />,
    );

    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('converts hours input to units and persists only units in payload', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const client = createClientWithContractAuthorization();

    renderWithProviders(
      <ClientModal
        isOpen
        onClose={() => {}}
        onSubmit={handleSubmit}
        client={client}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Authorization by CPT code')).toBeInTheDocument();
    });

    const inputModeSelect = document.getElementById('modal-contract-auth-input-mode-0-H2019') as HTMLSelectElement;
    const amountInput = document.getElementById('modal-contract-auth-units-0-H2019') as HTMLInputElement;

    expect(inputModeSelect.value).toBe('units');
    expect(amountInput.value).toBe('8');

    fireEvent.change(inputModeSelect, { target: { value: 'hours' } });
    expect(amountInput.value).toBe('2');

    fireEvent.change(amountInput, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /update client/i }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });

    const submitted = handleSubmit.mock.calls[0][0];
    const submittedContracts = submitted.insurance_info.service_contracts as Array<Record<string, unknown>>;
    const firstContract = submittedContracts[0];
    const codeAuthorizations = firstContract.code_authorizations as Array<Record<string, unknown>>;
    const firstAuthorization = codeAuthorizations[0];

    expect(firstAuthorization.units).toBe(12);
    expect(firstAuthorization).not.toHaveProperty('input_mode');
  });

  it('keeps units value unchanged when toggling between units and hours', async () => {
    const handleSubmit = vi.fn();
    const client = createClientWithContractAuthorization();

    renderWithProviders(
      <ClientModal
        isOpen
        onClose={() => {}}
        onSubmit={handleSubmit}
        client={client}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Authorization by CPT code')).toBeInTheDocument();
    });

    const inputModeSelect = document.getElementById('modal-contract-auth-input-mode-0-H2019') as HTMLSelectElement;
    const amountInput = document.getElementById('modal-contract-auth-units-0-H2019') as HTMLInputElement;

    expect(amountInput.value).toBe('8');

    fireEvent.change(inputModeSelect, { target: { value: 'hours' } });
    expect(amountInput.value).toBe('2');

    fireEvent.change(inputModeSelect, { target: { value: 'units' } });
    expect(amountInput.value).toBe('8');
  });
});
