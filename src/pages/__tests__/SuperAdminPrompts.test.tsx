import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen } from '../../test/utils';
import { SuperAdminPrompts } from '../SuperAdminPrompts';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: vi.fn(async () => ({ data: [], error: null })),
      }),
      update: vi.fn(),
      insert: vi.fn(),
    }),
  },
}));

describe('SuperAdminPrompts', () => {
  it('renders an explicit empty history state', async () => {
    renderWithProviders(<SuperAdminPrompts />);

    expect(await screen.findByText(/No prompt history yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Set the current prompt and tool version to create the first entry./i)).toBeInTheDocument();
  });
});
