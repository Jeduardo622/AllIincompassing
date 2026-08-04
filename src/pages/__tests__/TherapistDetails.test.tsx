import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TherapistDetails } from '../TherapistDetails';

const mockUseAuth = vi.fn();
const mockFrom = vi.fn();

vi.mock('../../lib/authContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock('../../components/TherapistDetails/ProfileTab', () => ({
  ProfileTab: () => <div>Profile content</div>,
}));

vi.mock('../../components/TherapistDetails/CertificationsTab', () => ({
  CertificationsTab: () => <div>Certifications content</div>,
}));

vi.mock('../../components/TherapistDetails/ScheduleTab', () => ({
  ScheduleTab: () => <div>Schedule content</div>,
}));

vi.mock('../../components/TherapistDetails/ClientsTab', () => ({
  ClientsTab: () => <div>Clients content</div>,
}));

const renderDetails = (therapistId: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/therapists/${therapistId}`]}>
        <Routes>
          <Route path="/therapists/:therapistId" element={<TherapistDetails />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('TherapistDetails record authorization', () => {
  const therapistRecord = {
    id: 'own-therapist-id',
    full_name: 'Own Therapist',
    weekly_hours_min: 10,
    weekly_hours_max: 20,
    service_type: ['In-home'],
  };

  beforeEach(() => {
    mockFrom.mockReset();
    mockUseAuth.mockReturnValue({
      effectiveRole: 'bt',
      profile: { id: 'auth-user-id', role: 'bt' },
      user: {
        id: 'auth-user-id',
        user_metadata: { therapist_id: 'own-therapist-id' },
      },
    });
  });

  it('blocks a BT from fetching a foreign therapist record', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'user_therapist_links') {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }

      throw new Error('A foreign therapist query must not be issued');
    });

    renderDetails('foreign-therapist-id');

    expect(await screen.findByText(/only view your own therapist profile/i)).toBeInTheDocument();
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('user_therapist_links'));
    expect(mockFrom).not.toHaveBeenCalledWith('therapists');
  });

  it('does not trust therapist ownership from mutable auth metadata', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'user_therapist_links') {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    renderDetails('own-therapist-id');

    expect(await screen.findByText(/only view your own therapist profile/i)).toBeInTheDocument();
    expect(mockFrom).toHaveBeenCalledWith('user_therapist_links');
    expect(mockFrom).not.toHaveBeenCalledWith('therapists');
  });

  it('allows a BT to fetch a therapist record through the canonical user link', async () => {
    const linkedTherapist = { ...therapistRecord, id: 'linked-therapist-id' };
    mockUseAuth.mockReturnValue({
      effectiveRole: 'bt',
      profile: { id: 'auth-user-id', role: 'bt' },
      user: { id: 'auth-user-id', user_metadata: {} },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'user_therapist_links') {
        return {
          select: () => ({
            eq: async () => ({
              data: [{ therapist_id: 'linked-therapist-id' }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'therapists') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: linkedTherapist, error: null }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    renderDetails('linked-therapist-id');

    expect(await screen.findByText('Therapist Records: Own Therapist')).toBeInTheDocument();
    expect(mockFrom).toHaveBeenCalledWith('user_therapist_links');
    expect(mockFrom).toHaveBeenCalledWith('therapists');
  });

  it('fails closed when the canonical therapist link lookup fails', async () => {
    mockUseAuth.mockReturnValue({
      effectiveRole: 'bt',
      profile: { id: 'auth-user-id', role: 'bt' },
      user: { id: 'auth-user-id', user_metadata: {} },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'user_therapist_links') {
        return {
          select: () => ({
            eq: async () => ({ data: null, error: new Error('link lookup failed') }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    renderDetails('foreign-therapist-id');

    expect(await screen.findByText(/only view your own therapist profile/i)).toBeInTheDocument();
    expect(mockFrom).not.toHaveBeenCalledWith('therapists');
  });

  it('preserves therapist record access for an admin role', async () => {
    mockUseAuth.mockReturnValue({
      effectiveRole: 'admin',
      profile: { id: 'admin-user-id', role: 'admin' },
      user: { id: 'admin-user-id', user_metadata: {} },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'therapists') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: therapistRecord, error: null }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    renderDetails('foreign-therapist-id');

    expect(await screen.findByText('Therapist Records: Own Therapist')).toBeInTheDocument();
    expect(mockFrom).not.toHaveBeenCalledWith('user_therapist_links');
    expect(mockFrom).toHaveBeenCalledWith('therapists');
  });
});
