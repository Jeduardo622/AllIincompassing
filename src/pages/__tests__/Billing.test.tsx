import { describe, expect, it } from 'vitest';
import { renderWithProviders, screen } from '../../test/utils';
import { Billing } from '../Billing';

describe('Billing', () => {
  it('keeps billing tabs horizontally scrollable and shows a mobile overflow affordance', () => {
    renderWithProviders(<Billing />);

    const plansTab = screen.getByRole('button', { name: /subscription plans/i });
    const tabList = plansTab.closest('nav');
    const scroller = tabList?.parentElement;

    expect(tabList).toHaveClass('min-w-max');
    expect(scroller).toHaveClass('overflow-x-auto');
    expect(screen.getByText(/scroll to view more billing sections on smaller screens/i)).toBeInTheDocument();
  });
});
