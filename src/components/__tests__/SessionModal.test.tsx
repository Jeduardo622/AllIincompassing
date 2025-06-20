import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, userEvent } from '../../test/utils';
import { fireEvent } from '@testing-library/react';
import SessionModal from '../SessionModal';

describe('SessionModal', () => {
  const mockTherapists = [
    {
      id: 'test-therapist-1',
      email: 'therapist1@example.com',
      full_name: 'Test Therapist 1',
      specialties: ['ABA Therapy'],
      service_type: ['In clinic'],
      availability_hours: {
        monday: { start: '09:00', end: '17:00' },
      },
    },
  ];

  const mockClients = [
    {
      id: 'test-client-1',
      email: 'client1@example.com',
      full_name: 'Test Client 1',
      date_of_birth: '2020-01-01',
      service_preference: ['In clinic'],
      authorized_hours: 10,
      availability_hours: {
        monday: { start: '09:00', end: '17:00' },
      },
    },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    therapists: mockTherapists,
    clients: mockClients,
    existingSessions: [],
  };

  it('renders the modal when open', () => {
    renderWithProviders(<SessionModal {...defaultProps} />);
    expect(screen.getByText(/New Session/)).toBeInTheDocument();
  });

  it('shows validation errors for required fields', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);
    
    const form = document.querySelector('form');
    fireEvent.submit(form!);

    expect(screen.getByText(/Therapist is required/)).toBeInTheDocument();
    expect(screen.getByText(/Client is required/)).toBeInTheDocument();
  });

  it('calls onSubmit with form data when valid', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);

    // Fill out the form
    await userEvent.selectOptions(
      screen.getByLabelText(/Therapist/i),
      'test-therapist-1'
    );
    await userEvent.selectOptions(
      screen.getByLabelText(/Client/i),
      'test-client-1'
    );

    // Set start and end times
    const startTime = screen.getByLabelText(/Start Time/i);
    const endTime = screen.getByLabelText(/End Time/i);
    await userEvent.type(startTime, '2025-03-18T10:00');
    await userEvent.type(endTime, '2025-03-18T11:00');

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /Create Session/i });
    await userEvent.click(submitButton);

    expect(defaultProps.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      therapist_id: 'test-therapist-1',
      client_id: 'test-client-1',
      start_time: '2025-03-18T10:00',
      end_time: '2025-03-18T11:00',
      status: 'scheduled',
    }));
  });

  it('closes modal when cancel button is clicked', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);
    
    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    await userEvent.click(cancelButton);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});