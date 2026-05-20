import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StaffRecipientPicker } from '../StaffRecipientPicker';

const staff = [
  { id: 'user-self', fullName: 'Self', email: 'self@example.com' },
  { id: 'user-other', fullName: 'Other Staff', email: 'other@example.com' },
];

describe('StaffRecipientPicker', () => {
  it('uses radio selection for direct threads', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <StaffRecipientPicker
        threadType="direct"
        staff={staff}
        selectedIds={[]}
        currentUserId="user-self"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByLabelText(/Other Staff/i));
    expect(onChange).toHaveBeenCalledWith(['user-other']);
  });

  it('uses checkbox selection for group threads', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <StaffRecipientPicker
        threadType="group"
        staff={staff}
        selectedIds={[]}
        currentUserId="user-self"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByLabelText(/Other Staff/i));
    expect(onChange).toHaveBeenCalledWith(['user-other']);
  });
});
