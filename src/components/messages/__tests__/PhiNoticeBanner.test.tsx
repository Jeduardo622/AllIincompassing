import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PHI_POLICY_BANNER } from '../../../lib/messages/constants';
import { PhiNoticeBanner } from '../PhiNoticeBanner';

describe('PhiNoticeBanner', () => {
  it('renders PHI policy copy', () => {
    render(<PhiNoticeBanner />);
    expect(screen.getByTestId('messages-phi-banner')).toHaveTextContent(PHI_POLICY_BANNER);
  });
});
