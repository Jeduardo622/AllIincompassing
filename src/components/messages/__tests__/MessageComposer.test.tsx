import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageComposer } from '../MessageComposer';
import { PHI_POLICY_COMPOSER_HINT } from '../../../lib/messages/constants';

describe('MessageComposer', () => {
  it('renders PHI composer hint and sends trimmed body', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);

    render(<MessageComposer onSend={onSend} />);

    expect(screen.getByText(PHI_POLICY_COMPOSER_HINT)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/message body/i), '  Hello team  ');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith('  Hello team  ');
  });
});
