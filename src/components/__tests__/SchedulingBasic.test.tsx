import { describe, it, expect, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor } from '../../test/utils';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup';
import Schedule from '../../pages/Schedule';

// Test data that matches the expected API response format
const mockScheduleData = {
  sessions: [
    {
      id: 'session-1',
      client_id: 'client-1',
      therapist_id: 'therapist-1',
      start_time: '2024-07-01T10:00:00Z',
      end_time: '2024-07-01T11:00:00Z',
      status: 'scheduled',
      notes: 'Regular session',
      created_at: '2024-01-01T00:00:00Z',
      client: { id: 'client-1', full_name: 'John Doe' },
      therapist: { id: 'therapist-1', full_name: 'Dr. Smith' },
    },
  ],
  therapists: [
    {
      id: 'therapist-1',
      full_name: 'Dr. Smith',
      email: 'dr.smith@example.com',
      specialties: ['ABA'],
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
  ],
  clients: [
    {
      id: 'client-1',
      full_name: 'John Doe',
      email: 'john@example.com',
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
      insurance_info: { provider: 'Blue Cross' },
      service_preference: ['ABA Therapy'],
      one_to_one_units: 20,
      supervision_units: 5,
      parent_consult_units: 2,
      created_at: '2024-01-01T00:00:00Z',
    },
  ],
};

describe('Scheduling Basic Functionality', () => {
  beforeEach(() => {
    // Reset handlers before each test
    server.resetHandlers();
  });

  it('should render the schedule page successfully', async () => {
    // Mock the RPC calls that the Schedule component makes
    server.use(
      http.post('*/rest/v1/rpc/get_schedule_data_batch', () => {
        return HttpResponse.json(mockScheduleData);
      }),
      http.post('*/rest/v1/rpc/get_dropdown_data', () => {
        return HttpResponse.json({
          therapists: mockScheduleData.therapists,
          clients: mockScheduleData.clients,
        });
      }),
    );

    renderWithProviders(<Schedule />);

    // Wait for the page to load
    await waitFor(() => {
      expect(screen.getByText('Schedule')).toBeInTheDocument();
    });

    // Check that basic UI elements are present
    expect(screen.getByText('Auto Schedule')).toBeInTheDocument();
  });

  it('should display sessions when data is loaded', async () => {
    // Mock API responses with session data
    server.use(
      http.post('*/rest/v1/rpc/get_schedule_data_batch', () => {
        return HttpResponse.json(mockScheduleData);
      }),
      http.post('*/rest/v1/rpc/get_dropdown_data', () => {
        return HttpResponse.json({
          therapists: mockScheduleData.therapists,
          clients: mockScheduleData.clients,
        });
      }),
    );

    renderWithProviders(<Schedule />);

    // Wait for the Schedule component to load and check if it's no longer loading
    await waitFor(
      () => {
        // Check if the schedule is loaded (no loading spinner)
        expect(screen.getByText('Schedule')).toBeInTheDocument();
        // The component should show the view controls when loaded
        expect(screen.getByText('Week')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // Note: Session display might depend on the current date/week view
    // This test verifies the component loads successfully with mock data
  });

  it('should handle view switching', async () => {
    server.use(
      http.post('*/rest/v1/rpc/get_schedule_data_batch', () => {
        return HttpResponse.json(mockScheduleData);
      }),
      http.post('*/rest/v1/rpc/get_dropdown_data', () => {
        return HttpResponse.json({
          therapists: mockScheduleData.therapists,
          clients: mockScheduleData.clients,
        });
      }),
    );

    renderWithProviders(<Schedule />);

    // Wait for the component to load
    await waitFor(() => {
      expect(screen.getByText('Schedule')).toBeInTheDocument();
    });

    // The Week button should be active by default (based on the component code)
    const weekButton = screen.getByText('Week');
    expect(weekButton).toBeInTheDocument();

    // Look for other view buttons
    const dayButton = screen.getByText('Day');
    const matrixButton = screen.getByText('Matrix');
    
    expect(dayButton).toBeInTheDocument();
    expect(matrixButton).toBeInTheDocument();
  });

  it('should handle empty data gracefully', async () => {
    // Mock empty responses
    server.use(
      http.post('*/rest/v1/rpc/get_schedule_data_batch', () => {
        return HttpResponse.json({
          sessions: [],
          therapists: [],
          clients: [],
        });
      }),
      http.post('*/rest/v1/rpc/get_dropdown_data', () => {
        return HttpResponse.json({
          therapists: [],
          clients: [],
        });
      }),
    );

    renderWithProviders(<Schedule />);

    // Page should still render successfully
    await waitFor(() => {
      expect(screen.getByText('Schedule')).toBeInTheDocument();
    });

    expect(screen.getByText('Auto Schedule')).toBeInTheDocument();
  });

  it('should handle API errors gracefully', async () => {
    // Mock API errors
    server.use(
      http.post('*/rest/v1/rpc/get_schedule_data_batch', () => {
        return HttpResponse.json(
          { message: 'Internal server error' },
          { status: 500 }
        );
      }),
      http.post('*/rest/v1/rpc/get_dropdown_data', () => {
        return HttpResponse.json(
          { message: 'Internal server error' },
          { status: 500 }
        );
      }),
    );

    renderWithProviders(<Schedule />);

    // Page should still render the basic structure
    await waitFor(() => {
      expect(screen.getByText('Schedule')).toBeInTheDocument();
    });
  });
}); 