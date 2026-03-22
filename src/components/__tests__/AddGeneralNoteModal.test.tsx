import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddGeneralNoteModal } from '../AddGeneralNoteModal';

describe('AddGeneralNoteModal', () => {
  it('uses an accessible close button label and title', () => {
    render(
      <AddGeneralNoteModal
        isOpen
        onClose={() => {}}
        onSubmit={vi.fn()}
      />,
    );

    const closeButton = screen.getByRole('button', { name: /close add note modal/i });
    expect(closeButton).toBeInTheDocument();
    expect(closeButton).toHaveAttribute('title', 'Close add note modal');
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();

    render(
      <AddGeneralNoteModal
        isOpen
        onClose={onClose}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /close add note modal/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
