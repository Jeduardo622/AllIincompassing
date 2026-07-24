import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { PHI_POLICY_BANNER } from '../../../lib/messages/constants';
import { MessagesNew } from '../MessagesNew';

vi.mock('../../../lib/authContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1' },
    effectiveRole: 'therapist',
    hasCapability: () => false,
  }),
}));

vi.mock('../../../lib/organization', () => ({
  useActiveOrganizationId: () => 'org-1',
}));

const mockFetchStaffRecipients = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/messages/fetchStaffRecipients', () => ({
  fetchStaffRecipients: mockFetchStaffRecipients,
}));

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MessagesNew />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('MessagesNew', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchStaffRecipients.mockResolvedValue([
      { id: 'staff-2', full_name: 'Alex Admin', email: 'alex@test.com', role: 'admin' },
      { id: 'staff-3', full_name: 'Blake Therapist', email: 'blake@test.com', role: 'therapist' },
    ]);
  });

  it('shows PHI policy banner for compose', async () => {
    renderPage();
    expect(await screen.findByText(PHI_POLICY_BANNER)).toBeInTheDocument();
  });

  it('does not offer group thread type for therapists', async () => {
    renderPage();
    await screen.findByTestId('staff-recipient-picker');
    expect(screen.queryByRole('radio', { name: /group/i })).not.toBeInTheDocument();
  });

  it('shows a loading state while recipients are fetched', async () => {
    mockFetchStaffRecipients.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve([
              { id: 'staff-2', full_name: 'Alex Admin', email: 'alex@test.com', role: 'admin' },
            ]);
          }, 25);
        }),
    );

    renderPage();

    expect(screen.getByText('Loading staff...')).toBeInTheDocument();
  });

  it('shows an empty state when no eligible staff are returned', async () => {
    mockFetchStaffRecipients.mockResolvedValueOnce([]);

    renderPage();

    expect(await screen.findByTestId('staff-recipient-empty')).toHaveTextContent(
      'No eligible staff found in your organization.',
    );
  });

  it('shows a retryable error state when recipients cannot be loaded', async () => {
    const user = userEvent.setup();
    mockFetchStaffRecipients.mockRejectedValueOnce(new Error('backend details should stay hidden'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load eligible staff right now.');
    const retryButton = screen.getByTestId('messages-retry-recipient-load');
    expect(retryButton).toBeEnabled();
    expect(screen.getByTestId('messages-create-thread')).toBeDisabled();

    await user.click(retryButton);

    expect(await screen.findByTestId('staff-recipient-picker')).toBeInTheDocument();
    expect(mockFetchStaffRecipients).toHaveBeenCalledTimes(2);
  });

  it('allows switching the direct-message recipient after an initial selection', async () => {
    const user = userEvent.setup();
    renderPage();

    const first = await screen.findByTestId('staff-recipient-staff-2');
    const second = await screen.findByTestId('staff-recipient-staff-3');

    await user.click(first);
    expect(first).toBeChecked();
    expect(second).not.toBeChecked();

    await user.click(second);
    expect(second).toBeChecked();
    expect(first).not.toBeChecked();
  });
});
