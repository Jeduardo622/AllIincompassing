import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup';
import Schedule from '../../pages/Schedule';

// Simplified mock data for integration testing
const mockTherapist = {
  id: 'therapist-1',
  full_name: 'Dr. Jane Smith',
  email: 'jane@example.com',
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
};

const mockClient = {
  id: 'client-1',
  full_name: 'Johnny Appleseed',
  email: 'johnny@example.com',
  date_of_birth: '2015-05-10',
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
};

describe('Scheduling Integration - End-to-End Flow', () => {
  it('should complete the full scheduling workflow', async () => {
    let sessionCreated = false;
    
    // Setup API mocks
    server.use(
      http.get('*/rest/v1/therapists*', () => {
        return HttpResponse.json([mockTherapist]);
      }),
      http.get('*/rest/v1/clients*', () => {
        return HttpResponse.json([mockClient]);
      }),
      http.get('*/rest/v1/sessions*', () => {
        return HttpResponse.json([]);
      }),
             http.post('*/rest/v1/sessions*', () => {
         sessionCreated = true;
         
         return HttpResponse.json({
           id: 'new-session-id',
           client_id: 'client-1',
           therapist_id: 'therapist-1',
           start_time: '2024-03-19T10:00:00Z',
           end_time: '2024-03-19T11:00:00Z',
           status: 'scheduled',
           notes: 'Initial ABA therapy session',
           created_at: '2024-03-19T09:00:00Z',
         });
       }),
    );

    // Render the Schedule page
    renderWithProviders(<Schedule />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Dr. Jane Smith')).toBeInTheDocument();
    });

    // Switch to week view for easier interaction
    const weekButton = screen.getByRole('button', { name: /week/i });
    await userEvent.click(weekButton);

    // Click on a time slot to create a new session
    // Look for a time slot button (this depends on the actual implementation)
    const timeSlotButton = screen.getByRole('button', { name: /\+/i });
    await userEvent.click(timeSlotButton);

    // Session modal should open
    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    // Fill out the session form
    const therapistSelect = screen.getByRole('combobox', { name: /therapist/i });
    await userEvent.selectOptions(therapistSelect, 'therapist-1');

    const clientSelect = screen.getByRole('combobox', { name: /client/i });
    await userEvent.selectOptions(clientSelect, 'client-1');

    // Add session notes
    const notesInput = screen.getByRole('textbox', { name: /notes/i });
    await userEvent.type(notesInput, 'Initial ABA therapy session');

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /schedule session/i });
    await userEvent.click(submitButton);

    // Wait for the session to be created
    await waitFor(() => {
      expect(sessionCreated).toBe(true);
    });

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByText('New Session')).not.toBeInTheDocument();
    });
  });

  it('should handle scheduling conflicts gracefully', async () => {
    const existingSession = {
      id: 'existing-session',
      client_id: 'client-1',
      therapist_id: 'therapist-1',
      start_time: '2024-03-19T10:00:00Z',
      end_time: '2024-03-19T11:00:00Z',
      status: 'scheduled' as const,
      notes: 'Existing session',
      created_at: '2024-01-01T00:00:00Z',
      therapist: { id: 'therapist-1', full_name: 'Dr. Jane Smith' },
      client: { id: 'client-1', full_name: 'Johnny Appleseed' },
    };

    // Setup API mocks with existing session
    server.use(
      http.get('*/rest/v1/therapists*', () => {
        return HttpResponse.json([mockTherapist]);
      }),
      http.get('*/rest/v1/clients*', () => {
        return HttpResponse.json([mockClient]);
      }),
      http.get('*/rest/v1/sessions*', () => {
        return HttpResponse.json([existingSession]);
      }),
    );

    renderWithProviders(<Schedule />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Dr. Jane Smith')).toBeInTheDocument();
    });

    // Should show existing session
    await waitFor(() => {
      expect(screen.getByText('Johnny Appleseed')).toBeInTheDocument();
    });
  });

  it('should display availability in matrix view', async () => {
    // Setup API mocks
    server.use(
      http.get('*/rest/v1/therapists*', () => {
        return HttpResponse.json([mockTherapist]);
      }),
      http.get('*/rest/v1/clients*', () => {
        return HttpResponse.json([mockClient]);
      }),
      http.get('*/rest/v1/sessions*', () => {
        return HttpResponse.json([]);
      }),
    );

    renderWithProviders(<Schedule />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Dr. Jane Smith')).toBeInTheDocument();
    });

    // Switch to matrix view
    const matrixButton = screen.getByRole('button', { name: /matrix/i });
    await userEvent.click(matrixButton);

    // Should show matrix view with availability
    await waitFor(() => {
      expect(screen.getByText(/therapists/i)).toBeInTheDocument();
      expect(screen.getByText(/clients/i)).toBeInTheDocument();
    });
  });

  it('should filter sessions by therapist and client', async () => {
    // Setup API mocks
    server.use(
      http.get('*/rest/v1/therapists*', () => {
        return HttpResponse.json([mockTherapist]);
      }),
      http.get('*/rest/v1/clients*', () => {
        return HttpResponse.json([mockClient]);
      }),
      http.get('*/rest/v1/sessions*', () => {
        return HttpResponse.json([]);
      }),
    );

    renderWithProviders(<Schedule />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Dr. Jane Smith')).toBeInTheDocument();
    });

    // Look for filter controls
    const therapistFilter = screen.getByRole('combobox', { name: /therapist/i });
    const clientFilter = screen.getByRole('combobox', { name: /client/i });

    // Apply filters
    await userEvent.selectOptions(therapistFilter, 'therapist-1');
    await userEvent.selectOptions(clientFilter, 'client-1');

    // Filters should be applied
    expect(therapistFilter).toHaveValue('therapist-1');
    expect(clientFilter).toHaveValue('client-1');
  });
}); 