import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup';
import Schedule from '../../pages/Schedule';
import SessionModal from '../SessionModal';
import { format, addDays, addHours } from 'date-fns';

// Mock data for testing
const mockTherapists = [
  {
    id: 'therapist-1',
    full_name: 'Dr. John Smith',
    email: 'john@example.com',
    specialties: ['ABA', 'Behavioral Therapy'],
    availability_hours: {
      monday: { start: '09:00', end: '17:00' },
      tuesday: { start: '09:00', end: '17:00' },
      wednesday: { start: '09:00', end: '17:00' },
      thursday: { start: '09:00', end: '17:00' },
      friday: { start: '09:00', end: '17:00' },
      saturday: { start: null, end: null },
      sunday: { start: null, end: null },
    },
    max_clients: 20,
    service_type: ['ABA Therapy'],
    weekly_hours_min: 20,
    weekly_hours_max: 40,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'therapist-2',
    full_name: 'Dr. Sarah Johnson',
    email: 'sarah@example.com',
    specialties: ['Speech Therapy', 'Occupational Therapy'],
    availability_hours: {
      monday: { start: '08:00', end: '16:00' },
      tuesday: { start: '08:00', end: '16:00' },
      wednesday: { start: '08:00', end: '16:00' },
      thursday: { start: '08:00', end: '16:00' },
      friday: { start: '08:00', end: '16:00' },
      saturday: { start: null, end: null },
      sunday: { start: null, end: null },
    },
    max_clients: 15,
    service_type: ['Speech Therapy'],
    weekly_hours_min: 15,
    weekly_hours_max: 30,
    created_at: '2024-01-01T00:00:00Z',
  },
];

const mockClients = [
  {
    id: 'client-1',
    full_name: 'Alex Thompson',
    email: 'alex@example.com',
    date_of_birth: '2015-03-15',
    availability_hours: {
      monday: { start: '10:00', end: '15:00' },
      tuesday: { start: '10:00', end: '15:00' },
      wednesday: { start: '10:00', end: '15:00' },
      thursday: { start: '10:00', end: '15:00' },
      friday: { start: '10:00', end: '15:00' },
      saturday: { start: null, end: null },
      sunday: { start: null, end: null },
    },
    insurance_info: { provider: 'Blue Cross', policy_number: '123456' },
    service_preference: ['ABA Therapy'],
    one_to_one_units: 20,
    supervision_units: 5,
    parent_consult_units: 2,
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'client-2',
    full_name: 'Emma Davis',
    email: 'emma@example.com',
    date_of_birth: '2018-07-22',
    availability_hours: {
      monday: { start: '09:00', end: '14:00' },
      tuesday: { start: '09:00', end: '14:00' },
      wednesday: { start: '09:00', end: '14:00' },
      thursday: { start: '09:00', end: '14:00' },
      friday: { start: '09:00', end: '14:00' },
      saturday: { start: null, end: null },
      sunday: { start: null, end: null },
    },
    insurance_info: { provider: 'Aetna', policy_number: '789012' },
    service_preference: ['Speech Therapy'],
    one_to_one_units: 15,
    supervision_units: 3,
    parent_consult_units: 1,
    created_at: '2024-01-01T00:00:00Z',
  },
];

const mockExistingSessions = [
  {
    id: 'session-1',
    client_id: 'client-1',
    therapist_id: 'therapist-1',
    start_time: '2024-03-18T14:00:00Z',
    end_time: '2024-03-18T15:00:00Z',
    status: 'scheduled' as const,
    notes: 'Regular session',
    created_at: '2024-01-01T00:00:00Z',
    therapist: { id: 'therapist-1', full_name: 'Dr. John Smith' },
    client: { id: 'client-1', full_name: 'Alex Thompson' },
  },
];

describe('Scheduling Flow - Client with Therapist', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Setup default API responses
    server.use(
      http.get('*/rest/v1/therapists*', () => {
        return HttpResponse.json(mockTherapists);
      }),
      http.get('*/rest/v1/clients*', () => {
        return HttpResponse.json(mockClients);
      }),
      http.get('*/rest/v1/sessions*', () => {
        return HttpResponse.json(mockExistingSessions);
      }),
    );
  });

  describe('Schedule Page Integration', () => {
    it('should display available therapists and clients', async () => {
      renderWithProviders(<Schedule />);

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText('Dr. John Smith')).toBeInTheDocument();
      });

      expect(screen.getByText('Dr. Sarah Johnson')).toBeInTheDocument();
      expect(screen.getByText('Alex Thompson')).toBeInTheDocument();
      expect(screen.getByText('Emma Davis')).toBeInTheDocument();
    });

    it('should show existing sessions on the schedule', async () => {
      renderWithProviders(<Schedule />);

      // Wait for sessions to load
      await waitFor(() => {
        expect(screen.getByText('Alex Thompson')).toBeInTheDocument();
      });

      expect(screen.getByText('Dr. John Smith')).toBeInTheDocument();
    });

    it('should allow switching between schedule views', async () => {
      renderWithProviders(<Schedule />);

      // Test view switches
      const weekButton = screen.getByRole('button', { name: /week/i });
      const matrixButton = screen.getByRole('button', { name: /matrix/i });

      await userEvent.click(weekButton);
      await userEvent.click(matrixButton);

      // Should show matrix view
      expect(screen.getByText(/therapists/i)).toBeInTheDocument();
      expect(screen.getByText(/clients/i)).toBeInTheDocument();
    });
  });

  describe('Session Modal - Creating New Session', () => {
    const defaultProps = {
      isOpen: true,
      onClose: vi.fn(),
      onSubmit: vi.fn(),
      therapists: mockTherapists,
      clients: mockClients,
      existingSessions: mockExistingSessions,
      selectedDate: new Date('2024-03-19T10:00:00Z'),
      selectedTime: '10:00',
    };

    it('should render session modal with pre-filled date and time', async () => {
      renderWithProviders(<SessionModal {...defaultProps} />);

      expect(screen.getByText('New Session')).toBeInTheDocument();
      expect(screen.getByDisplayValue('2024-03-19T10:00')).toBeInTheDocument();
    });

    it('should allow selecting therapist and client', async () => {
      renderWithProviders(<SessionModal {...defaultProps} />);

      // Select therapist
      const therapistSelect = screen.getByRole('combobox', { name: /therapist/i });
      await userEvent.selectOptions(therapistSelect, 'therapist-1');

      // Select client
      const clientSelect = screen.getByRole('combobox', { name: /client/i });
      await userEvent.selectOptions(clientSelect, 'client-1');

      expect(therapistSelect).toHaveValue('therapist-1');
      expect(clientSelect).toHaveValue('client-1');
    });

    it('should validate session timing and show conflicts', async () => {
      const props = {
        ...defaultProps,
        selectedDate: new Date('2024-03-18T14:00:00Z'),
        selectedTime: '14:00',
      };

      renderWithProviders(<SessionModal {...props} />);

      // Select therapist and client that have a conflict
      const therapistSelect = screen.getByRole('combobox', { name: /therapist/i });
      await userEvent.selectOptions(therapistSelect, 'therapist-1');

      const clientSelect = screen.getByRole('combobox', { name: /client/i });
      await userEvent.selectOptions(clientSelect, 'client-1');

      // Should show conflict warning
      await waitFor(() => {
        expect(screen.getByText(/conflict/i)).toBeInTheDocument();
      });
    });

    it('should create new session with valid data', async () => {
      const mockOnSubmit = vi.fn();
      const props = {
        ...defaultProps,
        onSubmit: mockOnSubmit,
      };

      // Mock successful session creation
      server.use(
        http.post('*/rest/v1/sessions*', () => {
          return HttpResponse.json({
            id: 'new-session-id',
            client_id: 'client-2',
            therapist_id: 'therapist-2',
            start_time: '2024-03-19T10:00:00Z',
            end_time: '2024-03-19T11:00:00Z',
            status: 'scheduled',
            notes: 'Test session',
            created_at: '2024-03-19T09:00:00Z',
          });
        }),
      );

      renderWithProviders(<SessionModal {...props} />);

      // Fill out form
      const therapistSelect = screen.getByRole('combobox', { name: /therapist/i });
      await userEvent.selectOptions(therapistSelect, 'therapist-2');

      const clientSelect = screen.getByRole('combobox', { name: /client/i });
      await userEvent.selectOptions(clientSelect, 'client-2');

      const notesInput = screen.getByRole('textbox', { name: /notes/i });
      await userEvent.type(notesInput, 'Test session');

      // Submit form
      const submitButton = screen.getByRole('button', { name: /schedule session/i });
      await userEvent.click(submitButton);

      // Should call onSubmit with correct data
      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith({
          therapist_id: 'therapist-2',
          client_id: 'client-2',
          start_time: '2024-03-19T10:00',
          end_time: '2024-03-19T11:00',
          notes: 'Test session',
          status: 'scheduled',
        });
      });
    });

    it('should handle session creation errors gracefully', async () => {
      const mockOnSubmit = vi.fn().mockRejectedValue(new Error('Failed to create session'));
      const props = {
        ...defaultProps,
        onSubmit: mockOnSubmit,
      };

      renderWithProviders(<SessionModal {...props} />);

      // Fill out form
      const therapistSelect = screen.getByRole('combobox', { name: /therapist/i });
      await userEvent.selectOptions(therapistSelect, 'therapist-1');

      const clientSelect = screen.getByRole('combobox', { name: /client/i });
      await userEvent.selectOptions(clientSelect, 'client-1');

      // Submit form
      const submitButton = screen.getByRole('button', { name: /schedule session/i });
      await userEvent.click(submitButton);

      // Should show error message
      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument();
      });
    });
  });

  describe('Availability Checking', () => {
    it('should check therapist availability before scheduling', async () => {
      const props = {
        isOpen: true,
        onClose: vi.fn(),
        onSubmit: vi.fn(),
        therapists: mockTherapists,
        clients: mockClients,
        existingSessions: [],
        selectedDate: new Date('2024-03-19T18:00:00Z'), // After hours
        selectedTime: '18:00',
      };

      renderWithProviders(<SessionModal {...props} />);

      // Select therapist
      const therapistSelect = screen.getByRole('combobox', { name: /therapist/i });
      await userEvent.selectOptions(therapistSelect, 'therapist-1');

      // Select client
      const clientSelect = screen.getByRole('combobox', { name: /client/i });
      await userEvent.selectOptions(clientSelect, 'client-1');

      // Should show availability conflict
      await waitFor(() => {
        expect(screen.getByText(/not available/i)).toBeInTheDocument();
      });
    });

    it('should check client availability before scheduling', async () => {
      const props = {
        isOpen: true,
        onClose: vi.fn(),
        onSubmit: vi.fn(),
        therapists: mockTherapists,
        clients: mockClients,
        existingSessions: [],
        selectedDate: new Date('2024-03-19T16:00:00Z'), // After client hours
        selectedTime: '16:00',
      };

      renderWithProviders(<SessionModal {...props} />);

      // Select therapist
      const therapistSelect = screen.getByRole('combobox', { name: /therapist/i });
      await userEvent.selectOptions(therapistSelect, 'therapist-1');

      // Select client
      const clientSelect = screen.getByRole('combobox', { name: /client/i });
      await userEvent.selectOptions(clientSelect, 'client-1');

      // Should show availability conflict
      await waitFor(() => {
        expect(screen.getByText(/not available/i)).toBeInTheDocument();
      });
    });
  });

  describe('Alternative Time Suggestions', () => {
    it('should suggest alternative times when conflicts exist', async () => {
      const props = {
        isOpen: true,
        onClose: vi.fn(),
        onSubmit: vi.fn(),
        therapists: mockTherapists,
        clients: mockClients,
        existingSessions: mockExistingSessions,
        selectedDate: new Date('2024-03-18T14:00:00Z'),
        selectedTime: '14:00',
      };

      renderWithProviders(<SessionModal {...props} />);

      // Select therapist and client with conflict
      const therapistSelect = screen.getByRole('combobox', { name: /therapist/i });
      await userEvent.selectOptions(therapistSelect, 'therapist-1');

      const clientSelect = screen.getByRole('combobox', { name: /client/i });
      await userEvent.selectOptions(clientSelect, 'client-1');

      // Should show alternative times
      await waitFor(() => {
        expect(screen.getByText(/alternative times/i)).toBeInTheDocument();
      });
    });

    it('should allow selecting alternative time', async () => {
      const mockOnSubmit = vi.fn();
      const props = {
        isOpen: true,
        onClose: vi.fn(),
        onSubmit: mockOnSubmit,
        therapists: mockTherapists,
        clients: mockClients,
        existingSessions: mockExistingSessions,
        selectedDate: new Date('2024-03-18T14:00:00Z'),
        selectedTime: '14:00',
      };

      renderWithProviders(<SessionModal {...props} />);

      // Select therapist and client
      const therapistSelect = screen.getByRole('combobox', { name: /therapist/i });
      await userEvent.selectOptions(therapistSelect, 'therapist-1');

      const clientSelect = screen.getByRole('combobox', { name: /client/i });
      await userEvent.selectOptions(clientSelect, 'client-1');

      // Wait for alternatives to load
      await waitFor(() => {
        expect(screen.getByText(/alternative times/i)).toBeInTheDocument();
      });

      // Select an alternative time
      const alternativeButton = screen.getByRole('button', { name: /10:00/i });
      await userEvent.click(alternativeButton);

      // Should update the form with new time
      expect(screen.getByDisplayValue('2024-03-18T10:00')).toBeInTheDocument();
    });
  });

  describe('Session Editing', () => {
    it('should allow editing existing sessions', async () => {
      const mockOnSubmit = vi.fn();
      const props = {
        isOpen: true,
        onClose: vi.fn(),
        onSubmit: mockOnSubmit,
        session: mockExistingSessions[0],
        therapists: mockTherapists,
        clients: mockClients,
        existingSessions: mockExistingSessions,
      };

      renderWithProviders(<SessionModal {...props} />);

      expect(screen.getByText('Edit Session')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Regular session')).toBeInTheDocument();

      // Update notes
      const notesInput = screen.getByRole('textbox', { name: /notes/i });
      await userEvent.clear(notesInput);
      await userEvent.type(notesInput, 'Updated session notes');

      // Submit form
      const submitButton = screen.getByRole('button', { name: /update session/i });
      await userEvent.click(submitButton);

      // Should call onSubmit with updated data
      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            notes: 'Updated session notes',
          }),
        );
      });
    });
  });

  describe('Keyboard Navigation and Accessibility', () => {
    it('should support keyboard navigation', async () => {
      const props = {
        isOpen: true,
        onClose: vi.fn(),
        onSubmit: vi.fn(),
        therapists: mockTherapists,
        clients: mockClients,
        existingSessions: [],
        selectedDate: new Date('2024-03-19T10:00:00Z'),
        selectedTime: '10:00',
      };

      renderWithProviders(<SessionModal {...props} />);

      // Tab through form elements
      const therapistSelect = screen.getByRole('combobox', { name: /therapist/i });
      therapistSelect.focus();
      
      await userEvent.tab();
      const clientSelect = screen.getByRole('combobox', { name: /client/i });
      expect(clientSelect).toHaveFocus();
    });

    it('should have proper ARIA labels', async () => {
      const props = {
        isOpen: true,
        onClose: vi.fn(),
        onSubmit: vi.fn(),
        therapists: mockTherapists,
        clients: mockClients,
        existingSessions: [],
        selectedDate: new Date('2024-03-19T10:00:00Z'),
        selectedTime: '10:00',
      };

      renderWithProviders(<SessionModal {...props} />);

      expect(screen.getByLabelText(/therapist/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/client/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/start time/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/end time/i)).toBeInTheDocument();
    });
  });
}); 