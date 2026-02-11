import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders, screen, userEvent } from '../../test/utils';
import ServiceContractsTab from '../ClientDetails/ServiceContractsTab';
import { supabase } from '../../lib/supabase';
import { showError } from '../../lib/toast';

vi.mock('../../lib/toast', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

const createChain = (result: { data: unknown; error: unknown }) => {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(async () => result),
  };
  return chain;
};

describe('ServiceContractsTab', () => {
  const fromSpy = vi.spyOn(supabase, 'from');
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

  beforeEach(() => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'cpt_codes') {
        return createChain({
          data: [
            { code: 'H0031', short_description: 'Assessment (Medi-Cal/IEHP)' },
            { code: '97153', short_description: 'Adaptive behavior treatment by protocol' },
          ],
          error: null,
        });
      }

      if (table === 'service_contracts') {
        return createChain({
          data: [
            {
              id: 'contract-1',
              payer_name: 'CalOptima Health',
              effective_date: '2025-01-01',
              termination_date: '2025-12-31',
              reimbursement_method: 'ACH',
              file_url: null,
              confidence_score: 0.9,
              versions: [
                {
                  id: 'version-1',
                  uploaded_at: '2024-12-15T10:30:00Z',
                  uploaded_by: 'admin-user-id',
                },
              ],
              rates: [
                {
                  rate: 120,
                  modifiers: ['HO'],
                  cpt_code: {
                    code: 'H0031',
                    short_description: 'Assessment (Medi-Cal/IEHP)',
                  },
                },
              ],
            },
          ],
          error: null,
        });
      }

      return createChain({ data: [], error: null });
    });
  });

  afterEach(() => {
    fromSpy.mockReset();
    openSpy.mockClear();
  });

  it('renders persisted service contracts with CPT descriptions', async () => {
    renderWithProviders(<ServiceContractsTab client={{ id: 'client-1' }} />);

    const contractToggle = await screen.findByRole('button', { name: /CalOptima Health/i });
    await userEvent.click(contractToggle);

    expect(await screen.findByText('H0031')).toBeInTheDocument();
    expect(screen.getByText('Assessment (Medi-Cal/IEHP)')).toBeInTheDocument();
  });

  it('shows a safe error when original contract file is unavailable', async () => {
    renderWithProviders(<ServiceContractsTab client={{ id: 'client-1' }} />);

    const contractToggle = await screen.findByRole('button', { name: /CalOptima Health/i });
    await userEvent.click(contractToggle);
    await userEvent.click(screen.getByRole('button', { name: /download original/i }));

    expect(showError).toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});
