import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { AddSessionNoteModal } from '../AddSessionNoteModal';

describe('AddSessionNoteModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    therapists: [],
    clientId: 'client-1',
  };

  it('uses an accessible close button label and title', () => {
    renderWithProviders(<AddSessionNoteModal {...defaultProps} />, { auth: false });

    const closeButton = screen.getByRole('button', { name: /close add session note modal/i });
    expect(closeButton).toBeInTheDocument();
    expect(closeButton).toHaveAttribute('title', 'Close add session note modal');
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();

    renderWithProviders(<AddSessionNoteModal {...defaultProps} onClose={onClose} />, { auth: false });

    fireEvent.click(screen.getByRole('button', { name: /close add session note modal/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
