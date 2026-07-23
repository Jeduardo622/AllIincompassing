import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen } from '../../test/utils';
import { ProfileTab } from '../ClientDetails/ProfileTab';

vi.mock('../../lib/clients/hooks', () => ({
  useClientNotes: () => ({ data: [], isLoading: false }),
  useClientIssues: () => ({ data: [], isLoading: false }),
}));

vi.mock('../../lib/toast', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('../ClientModal', () => ({
  ClientModal: () => null,
}));

vi.mock('../AddGeneralNoteModal', () => ({
  AddGeneralNoteModal: () => null,
}));

describe('ProfileTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders DOB as the stored calendar day for date-only values', () => {
    renderWithProviders(
      <ProfileTab
        client={{
          id: 'client-1',
          full_name: 'Alyana Perez',
          client_id: 'CL-1',
          date_of_birth: '2015-04-20',
        }}
      />,
    );

    expect(screen.getByText('4/20/2015')).toBeInTheDocument();
  });
});
