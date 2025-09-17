import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup';
import Schedule from '../../pages/Schedule';
import { supabase } from '../../lib/supabase';

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
  beforeEach(() => {
    vi.clearAllMocks();
    // Override supabase.rpc to return our mock therapist/client so we see Dr. Jane Smith in UI
    vi.mocked(supabase.rpc as any).mockImplementation(async (functionName: string) => {
      if (functionName === 'get_schedule_data_batch') {
        return { data: { sessions: [], therapists: [mockTherapist], clients: [mockClient] }, error: null };
      }
      if (functionName === 'get_dropdown_data') {
        return { data: { therapists: [mockTherapist], clients: [mockClient] }, error: null };
      }
      if (functionName === 'get_sessions_optimized') {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    });
  });
  it('should complete the full scheduling workflow', async () => {
    let sessionCreated = false;
    
    // Setup API mocks
    server.use(
      // Override RPC batch + dropdown data to ensure our mock entities are used
      http.post('*/rest/v1/rpc/get_schedule_data_batch', () => {
        return HttpResponse.json({ sessions: [], therapists: [mockTherapist], clients: [mockClient] });
      }),
      http.post('*/rest/v1/rpc/get_dropdown_data', () => {
        return HttpResponse.json({ therapists: [mockTherapist], clients: [mockClient] });
      }),
      http.get('*/rest/v1/therapists*', () => {
        return HttpResponse.json([mockTherapist]);
      }),
      http.get('*/rest/v1/clients*', () => {
        return HttpResponse.json([mockClient]);
      }),
      http.get('*/rest/v1/sessions*', () => {
        return HttpResponse.json([]);
      }),
      http.post('*/functions/v1/sessions-hold*', () => {
        return HttpResponse.json({
          success: true,
          data: {
            holdKey: 'test-hold',
            holdId: 'hold-1',
            expiresAt: '2025-01-01T00:05:00Z',
          },
        });
      }),
      http.post('*/functions/v1/sessions-confirm*', () => {
        sessionCreated = true;
        return HttpResponse.json({
          success: true,
          data: {
            session: {
              id: 'new-session-id',
              client_id: 'client-1',
              therapist_id: 'therapist-1',
              start_time: '2024-03-19T10:00:00Z',
              end_time: '2024-03-19T11:00:00Z',
              status: 'scheduled',
              notes: 'Initial ABA therapy session',
              created_at: '2024-03-19T09:00:00Z',
              duration_minutes: 60,
              location_type: null,
              session_type: null,
              rate_per_hour: null,
              total_cost: null,
            },
          },
        });
      }),
    );

    // Render the Schedule page
    renderWithProviders(<Schedule />);

    // Wait for filters to be ready
    await screen.findByRole('combobox', { name: /therapist/i });

    // Switch to week view for easier interaction
    const weekButton = screen.getByRole('button', { name: /week/i });
    await userEvent.click(weekButton);

    // Open the session modal via the app-level event listener
    const start = '2025-07-01T10:00';
    document.dispatchEvent(new CustomEvent('openScheduleModal', { detail: { start_time: start } }));

    // Session modal should open
    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    // Fill out the session form
    const therapistSelect = document.getElementById('therapist-select') as HTMLSelectElement;
    await userEvent.selectOptions(therapistSelect, 'therapist-1');

    const clientSelect = document.getElementById('client-select') as HTMLSelectElement;
    await userEvent.selectOptions(clientSelect, 'client-1');

    // Add session notes
    const notesInput = screen.getByRole('textbox', { name: /notes/i });
    await userEvent.type(notesInput, 'Initial ABA therapy session');

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /create session/i });
    await userEvent.click(submitButton);

    // Wait for the session to be created
    await waitFor(() => {
      expect(sessionCreated).toBe(true);
    });

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByText('New Session')).not.toBeInTheDocument();
    });
  }, 15000);

  it('should handle scheduling conflicts gracefully', async () => {
    const existingSession = {
      id: 'existing-session',
      client_id: 'client-1',
      therapist_id: 'therapist-1',
      start_time: '2025-07-01T10:00:00Z',
      end_time: '2025-07-01T11:00:00Z',
      status: 'scheduled' as const,
      notes: 'Existing session',
      created_at: '2025-06-30T00:00:00Z',
      therapist: { id: 'therapist-1', full_name: 'Dr. Jane Smith' },
      client: { id: 'client-1', full_name: 'Johnny Appleseed' },
    };

    // Override RPC for this test so batched data contains the existing session
    vi.mocked(supabase.rpc as any).mockImplementationOnce(async (functionName: string) => {
      if (functionName === 'get_schedule_data_batch') {
        return { data: { sessions: [existingSession], therapists: [mockTherapist], clients: [mockClient] }, error: null };
      }
      if (functionName === 'get_dropdown_data') {
        return { data: { therapists: [mockTherapist], clients: [mockClient] }, error: null };
      }
      if (functionName === 'get_sessions_optimized') {
        return { data: [], error: null };
      }
      return { data: null, error: null };
    });

    // Setup API mocks with existing session (fallback if network path used)
    server.use(
      http.post('*/rest/v1/rpc/get_schedule_data_batch', () => {
        return HttpResponse.json({ sessions: [existingSession], therapists: [mockTherapist], clients: [mockClient] });
      }),
      http.post('*/rest/v1/rpc/get_dropdown_data', () => {
        return HttpResponse.json({ therapists: [mockTherapist], clients: [mockClient] });
      }),
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

    // Wait for filters to be ready
    await screen.findByRole('combobox', { name: /therapist/i });

    // Should show existing session
    await waitFor(() => {
      expect(screen.getByText('Johnny Appleseed')).toBeInTheDocument();
    });
  });

  it('should display availability in matrix view', async () => {
    // Setup API mocks
    server.use(
      http.post('*/rest/v1/rpc/get_schedule_data_batch', () => {
        return HttpResponse.json({ sessions: [], therapists: [mockTherapist], clients: [mockClient] });
      }),
      http.post('*/rest/v1/rpc/get_dropdown_data', () => {
        return HttpResponse.json({ therapists: [mockTherapist], clients: [mockClient] });
      }),
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

    // Wait for filters to be ready
    await screen.findByRole('combobox', { name: /therapist/i });

    // Switch to matrix view
    const matrixButton = screen.getByRole('button', { name: /matrix/i });
    await userEvent.click(matrixButton);

    // Should show matrix view with availability
    await waitFor(() => {
      expect(screen.getAllByText(/therapists/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/clients/i).length).toBeGreaterThan(0);
    });
  });

  it('should filter sessions by therapist and client', async () => {
    // Setup API mocks
    server.use(
      http.post('*/rest/v1/rpc/get_schedule_data_batch', () => {
        return HttpResponse.json({ sessions: [], therapists: [mockTherapist], clients: [mockClient] });
      }),
      http.post('*/rest/v1/rpc/get_dropdown_data', () => {
        return HttpResponse.json({ therapists: [mockTherapist], clients: [mockClient] });
      }),
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

    // Wait for filters to render
    await screen.findByRole('combobox', { name: /therapist/i });

    // Use filter selects by stable IDs to avoid ambiguity with modal selects
    const therapistFilter = document.getElementById('therapist-filter') as HTMLSelectElement;
    const clientFilter = document.getElementById('client-filter') as HTMLSelectElement;

    // Apply filters
    await userEvent.selectOptions(therapistFilter, 'therapist-1');
    await userEvent.selectOptions(clientFilter, 'client-1');

    // Filters should be applied
    expect(therapistFilter).toHaveValue('therapist-1');
    expect(clientFilter).toHaveValue('client-1');
  });
}); 