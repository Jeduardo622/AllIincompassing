import { http, HttpResponse } from 'msw';

// Mock Supabase API endpoints
export const handlers = [
  // Auth handlers
  http.post('*/auth/v1/token', () => {
    return HttpResponse.json({
      access_token: 'test-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'test-refresh-token',
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
      },
    });
  }),

  http.post('*/auth/v1/signup', () => {
    return HttpResponse.json({
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
      },
      session: null,
    });
  }),

  http.post('*/auth/v1/signout', () => {
    return HttpResponse.json({});
  }),

  // Data handlers
  http.get('*/rest/v1/clients*', () => {
    return HttpResponse.json([
      {
        id: 'test-client-1',
        email: 'client1@example.com',
        full_name: 'Test Client 1',
        first_name: 'Test',
        last_name: 'Client',
        date_of_birth: '2020-01-01',
        service_preference: ['In clinic'],
        authorized_hours: 10,
        availability_hours: {
          monday: { start: '09:00', end: '17:00' },
          tuesday: { start: '09:00', end: '17:00' },
          wednesday: { start: '09:00', end: '17:00' },
          thursday: { start: '09:00', end: '17:00' },
          friday: { start: '09:00', end: '17:00' },
        },
      },
    ]);
  }),

  http.get('*/rest/v1/therapists*', () => {
    return HttpResponse.json([
      {
        id: 'test-therapist-1',
        email: 'therapist1@example.com',
        full_name: 'Test Therapist 1',
        first_name: 'Test',
        last_name: 'Therapist',
        specialties: ['ABA Therapy'],
        service_type: ['In clinic'],
        availability_hours: {
          monday: { start: '09:00', end: '17:00' },
          tuesday: { start: '09:00', end: '17:00' },
          wednesday: { start: '09:00', end: '17:00' },
          thursday: { start: '09:00', end: '17:00' },
          friday: { start: '09:00', end: '17:00' },
        },
      },
    ]);
  }),

  http.get('*/rest/v1/sessions*', () => {
    return HttpResponse.json([
      {
        id: 'test-session-1',
        client_id: 'test-client-1',
        therapist_id: 'test-therapist-1',
        start_time: '2025-03-18T10:00:00Z',
        end_time: '2025-03-18T11:00:00Z',
        status: 'scheduled',
        therapist: {
          id: 'test-therapist-1',
          full_name: 'Test Therapist',
        },
        client: {
          id: 'test-client-1',
          full_name: 'Test Client',
        },
      },
    ]);
  }),

  http.post('*/rest/v1/sessions', () => {
    return HttpResponse.json({
      id: 'new-session-id',
      client_id: 'test-client-1',
      therapist_id: 'test-therapist-1',
      start_time: '2025-03-18T10:00:00Z',
      end_time: '2025-03-18T11:00:00Z',
      status: 'scheduled',
    });
  }),

  // RPC handler for batched schedule data
  http.post('*/rest/v1/rpc/get_schedule_data_batch', () => {
    return HttpResponse.json({
      sessions: [
        {
          id: 'test-session-1',
          client_id: 'test-client-1',
          therapist_id: 'test-therapist-1',
          start_time: '2025-03-18T10:00:00Z',
          end_time: '2025-03-18T11:00:00Z',
          status: 'scheduled',
          therapist: { id: 'test-therapist-1', full_name: 'Test Therapist' },
          client: { id: 'test-client-1', full_name: 'Test Client' },
        },
      ],
      therapists: [
        {
          id: 'test-therapist-1',
          full_name: 'Test Therapist 1',
          email: 'therapist1@example.com',
          specialties: ['ABA Therapy'],
          service_type: ['In clinic'],
          availability_hours: { monday: { start: '09:00', end: '17:00' } },
        },
      ],
      clients: [
        {
          id: 'test-client-1',
          full_name: 'Test Client 1',
          email: 'client1@example.com',
          date_of_birth: '2020-01-01',
          service_preference: ['In clinic'],
          authorized_hours: 10,
          availability_hours: { monday: { start: '09:00', end: '17:00' } },
        },
      ],
    });
  }),

  // Company settings
  http.get('*/rest/v1/company_settings*', () => {
    return HttpResponse.json([{
      id: 'test-settings',
      company_name: 'Test Company',
      time_zone: 'UTC',
      date_format: 'MM/dd/yyyy',
      time_format: '12h',
    }]);
  }),
];