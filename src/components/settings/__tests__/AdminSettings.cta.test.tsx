import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminSettings from '../../settings/AdminSettings';

vi.mock('../../../lib/authContext', async () => {
  const actual = await vi.importActual<any>('../../../lib/authContext');
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'user-1', user_metadata: {} },
      profile: { role: 'admin' },
    }),
  };
});

vi.mock('../../../lib/supabase', async () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: [], error: null })),
    from: vi.fn(() => ({ select: vi.fn(() => ({ order: vi.fn(() => ({ order: vi.fn(async () => ({ data: [], error: null })) })) })) })),
  },
}));

describe('AdminSettings CTA', () => {
  it('shows Create organization link when missing org', () => {
    render(<AdminSettings />);
    expect(screen.getByText(/Create organization/i)).toBeInTheDocument();
  });
});


