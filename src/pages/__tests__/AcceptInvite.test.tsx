import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent } from '../../test/utils';
import { AcceptInvite } from '../AcceptInvite';
import { callEdge, supabase } from '../../lib/supabase';
import { showError, showSuccess } from '../../lib/toast';

const navigateMock = vi.fn();
let search = '?token=0123456789abcdef0123456789abcdef';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useSearchParams: () => [new URLSearchParams(search)],
  };
});

vi.mock('../../lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('../../lib/supabase')>('../../lib/supabase');
  return {
    ...actual,
    callEdge: vi.fn(),
    supabase: {
      ...actual.supabase,
      auth: {
        ...actual.supabase.auth,
        signOut: vi.fn(async () => ({ error: null })),
      },
    },
  };
});

vi.mock('../../lib/toast', async () => {
  const actual = await vi.importActual<typeof import('../../lib/toast')>('../../lib/toast');
  return {
    ...actual,
    showError: vi.fn(),
    showSuccess: vi.fn(),
  };
});

describe('AcceptInvite', () => {
  beforeEach(() => {
    search = '?token=0123456789abcdef0123456789abcdef';
    window.history.pushState({}, '', `/accept-invite${search}`);
    vi.mocked(callEdge).mockReset();
    vi.mocked(supabase.auth.signOut).mockClear();
    vi.mocked(showError).mockClear();
    vi.mocked(showSuccess).mockClear();
    navigateMock.mockReset();
  });

  it('blocks submission when passwords do not match', async () => {
    renderWithProviders(<AcceptInvite />, { auth: false });

    await userEvent.type(screen.getByLabelText('Password*'), 'StrongPass123!');
    await userEvent.type(screen.getByLabelText('Confirm password*'), 'Different123!');
    await userEvent.click(screen.getByRole('button', { name: /accept invite/i }));

    expect(callEdge).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Passwords do not match.' }));
  });

  it('accepts the invite, signs out any stale session, and shows login handoff', async () => {
    vi.mocked(callEdge).mockResolvedValue(
      new Response(JSON.stringify({ email: 'bt.staff@example.com', role: 'bt' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderWithProviders(<AcceptInvite />, { auth: false });

    await waitFor(() => {
      expect(window.location.search).toBe('');
    });

    await userEvent.type(screen.getByLabelText('First name'), 'Bea');
    await userEvent.type(screen.getByLabelText('Last name'), 'Therapist');
    await userEvent.type(screen.getByLabelText('Password*'), 'StrongPass123!');
    await userEvent.type(screen.getByLabelText('Confirm password*'), 'StrongPass123!');
    await userEvent.click(screen.getByRole('button', { name: /accept invite/i }));

    await waitFor(() => {
      expect(callEdge).toHaveBeenCalledWith(
        'accept-staff-invite',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            token: '0123456789abcdef0123456789abcdef',
            password: 'StrongPass123!',
            first_name: 'Bea',
            last_name: 'Therapist',
          }),
        }),
      );
    });
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    expect(showSuccess).toHaveBeenCalledWith('Invite accepted. Sign in with your new password.');
    expect(await screen.findByText('Invite accepted')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Go to login' }));
    expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('disables acceptance when the token is missing', async () => {
    search = '';
    window.history.pushState({}, '', '/accept-invite');

    renderWithProviders(<AcceptInvite />, { auth: false });

    expect(screen.getByRole('heading', { name: /invite link unavailable/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Password*')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept invite/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to login/i })).toBeInTheDocument();
  });
});
