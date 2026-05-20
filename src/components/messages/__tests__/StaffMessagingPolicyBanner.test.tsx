import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StaffMessagingPolicyBanner } from '../StaffMessagingPolicyBanner';
import { PHI_POLICY_BANNER } from '../../../lib/messages/constants';

describe('StaffMessagingPolicyBanner', () => {
  it('renders PHI policy copy', () => {
    render(<StaffMessagingPolicyBanner />);
    expect(screen.getByText(PHI_POLICY_BANNER)).toBeInTheDocument();
  });
});
