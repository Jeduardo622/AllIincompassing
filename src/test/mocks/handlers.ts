import { http, HttpResponse } from 'msw';

// Mock data that matches our schema
const mockClients = [
  {
    id: '1',
    full_name: 'Test Client',
    first_name: 'Test',
    last_name: 'Client',
    email: 'test@client.com',
    phone: '555-0123',
    date_of_birth: '1990-01-01',
    service_preference: ['ABA Therapy', 'In Home'],
    one_to_one_units: 20,
    supervision_units: 4,
    parent_consult_units: 2,
    insurance_info: { provider: 'Test Insurance' },
    availability_hours: {
      monday: { start: '09:00', end: '17:00' },
      tuesday: { start: '09:00', end: '17:00' },
    },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  },
  {
    id: '2',
    full_name: 'Another Client',
    first_name: 'Another',
    last_name: 'Client',
    email: 'another@client.com',
    phone: '555-0124',
    date_of_birth: '1985-05-15',
    service_preference: ['ABA Therapy', 'In Clinic'],
    one_to_one_units: 15,
    supervision_units: 3,
    parent_consult_units: 1,
    insurance_info: { provider: 'Another Insurance' },
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z'
  }
];

const mockTherapists = [
  {
    id: '1',
    full_name: 'Test Therapist',
    first_name: 'Test',
    last_name: 'Therapist',
    email: 'test@therapist.com',
    phone: '555-0200',
    service_type: ['ABA Therapy', 'BCBA'],
    specialties: ['Autism', 'Behavioral Analysis'],
    credentials: 'BCBA',
    status: 'active',
    max_clients: 10,
    weekly_hours_min: 20,
    weekly_hours_max: 40,
    rbt_number: 'RBT123',
    bcba_number: 'BCBA456',
    availability_hours: {
      monday: { start: '08:00', end: '18:00' },
      tuesday: { start: '08:00', end: '18:00' },
    },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  },
  {
    id: '2',
    full_name: 'Another Therapist',
    first_name: 'Another',
    last_name: 'Therapist',
    email: 'another@therapist.com',
    phone: '555-0201',
    service_type: ['ABA Therapy', 'RBT'],
    specialties: ['Autism', 'Early Intervention'],
    credentials: 'RBT',
    status: 'active',
    max_clients: 8,
    weekly_hours_min: 25,
    weekly_hours_max: 35,
    rbt_number: 'RBT789',
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z'
  }
];

const mockSessions = [
  {
    id: '1',
    client_id: '1',
    therapist_id: '1',
    start_time: '2024-06-25T10:00:00Z',
    end_time: '2024-06-25T11:00:00Z',
    status: 'scheduled',
    notes: 'Initial session',
    location_type: 'in_home',
    session_type: 'individual',
    duration_minutes: 60,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    // Related data
    therapists: mockTherapists[0],
    clients: mockClients[0]
  },
  {
    id: '2',
    client_id: '2',
    therapist_id: '2',
    start_time: '2024-06-25T14:00:00Z',
    end_time: '2024-06-25T15:00:00Z',
    status: 'completed',
    notes: 'Follow-up session',
    location_type: 'in_clinic',
    session_type: 'individual',
    duration_minutes: 60,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    // Related data
    therapists: mockTherapists[1],
    clients: mockClients[1]
  }
];

const mockBillingRecords = [
  {
    id: '1',
    session_id: '1',
    amount: 150.00,
    status: 'pending',
    claim_number: 'CLM001',
    created_at: '2024-01-01T00:00:00Z'
  }
];

// Mock Supabase API responses
export const handlers = [
  // Clients endpoints
  http.get('*/rest/v1/clients*', () => {
    return HttpResponse.json(mockClients);
  }),

  http.post('*/rest/v1/clients*', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const newClient = {
      id: '999',
      ...body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    return HttpResponse.json([newClient]);
  }),

  http.patch('*/rest/v1/clients*', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const updatedClient = {
      ...mockClients[0],
      ...body,
      updated_at: new Date().toISOString()
    };
    return HttpResponse.json([updatedClient]);
  }),

  http.delete('*/rest/v1/clients*', () => {
    return HttpResponse.json({});
  }),

  // Therapists endpoints
  http.get('*/rest/v1/therapists*', () => {
    return HttpResponse.json(mockTherapists);
  }),

  http.post('*/rest/v1/therapists*', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const newTherapist = {
      id: '999',
      ...body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    return HttpResponse.json([newTherapist]);
  }),

  http.patch('*/rest/v1/therapists*', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const updatedTherapist = {
      ...mockTherapists[0],
      ...body,
      updated_at: new Date().toISOString()
    };
    return HttpResponse.json([updatedTherapist]);
  }),

  http.delete('*/rest/v1/therapists*', () => {
    return HttpResponse.json({});
  }),

  // Sessions endpoints
  http.get('*/rest/v1/sessions*', ({ request }) => {
    const url = new URL(request.url);
    const select = url.searchParams.get('select');
    
    // If we're selecting with joins, return sessions with nested data
    if (select && (select.includes('therapists') || select.includes('clients'))) {
      return HttpResponse.json(mockSessions);
    }
    
    // Otherwise return basic sessions
    return HttpResponse.json(mockSessions.map(s => ({
      id: s.id,
      client_id: s.client_id,
      therapist_id: s.therapist_id,
      start_time: s.start_time,
      end_time: s.end_time,
      status: s.status,
      notes: s.notes,
      location_type: s.location_type,
      session_type: s.session_type,
      duration_minutes: s.duration_minutes,
      created_at: s.created_at,
      updated_at: s.updated_at
    })));
  }),

  http.post('*/rest/v1/sessions*', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const newSession = {
      id: '999',
      ...body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    return HttpResponse.json([newSession]);
  }),

  http.patch('*/rest/v1/sessions*', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    const updatedSession = {
      ...mockSessions[0],
      ...body,
      updated_at: new Date().toISOString()
    };
    return HttpResponse.json([updatedSession]);
  }),

  http.delete('*/rest/v1/sessions*', () => {
    return HttpResponse.json({});
  }),

  // Billing records endpoints
  http.get('*/rest/v1/billing_records*', () => {
    return HttpResponse.json(mockBillingRecords);
  }),

  // Auth endpoints
  http.get('*/auth/v1/user*', () => {
    return HttpResponse.json({
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        aud: 'authenticated',
        role: 'authenticated'
      },
      session: {
        access_token: 'test-token'
      }
    });
  }),

  http.post('*/auth/v1/token*', () => {
    return HttpResponse.json({
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        aud: 'authenticated',
        role: 'authenticated'
      },
      session: {
        access_token: 'test-token'
      }
    });
  }),

  // RPC endpoints
  http.post('*/rest/v1/rpc/get_dashboard_data*', () => {
    return HttpResponse.json({
      total_sessions: mockSessions.length,
      total_clients: mockClients.length,
      total_therapists: mockTherapists.length,
      recent_sessions: mockSessions.slice(0, 5).map(s => ({
        id: s.id,
        start_time: s.start_time,
        therapist_name: s.therapists.full_name,
        client_name: s.clients.full_name,
        status: s.status
      }))
    });
  }),

  http.post('*/rest/v1/rpc/get_user_roles*', () => {
    return HttpResponse.json([{ roles: ['user'] }]);
  }),

  // Generic RPC fallback
  http.post('*/rest/v1/rpc/*', () => {
    return HttpResponse.json({});
  }),

  // Catch-all for other Supabase endpoints
  http.get('*/rest/v1/*', () => {
    return HttpResponse.json([]);
  }),

  http.post('*/rest/v1/*', () => {
    return HttpResponse.json({});
  }),

  http.patch('*/rest/v1/*', () => {
    return HttpResponse.json({});
  }),

  http.delete('*/rest/v1/*', () => {
    return HttpResponse.json({});
  })
];
