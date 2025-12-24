import { describe, expect, it } from 'vitest';
import { fetchClientSessionNotes } from '../session-notes';

describe('fetchClientSessionNotes', () => {
  it('throws when organizationId is missing', async () => {
    await expect(fetchClientSessionNotes('client-1', null)).rejects.toThrow(
      /Organization context is required/
    );
  });
});
import { describe, expect, it, vi } from 'vitest';
import { createClientSessionNote } from '../session-notes';

const mockFrom = vi.fn();

vi.mock('../supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

const authRecord = {
  id: 'auth-1',
  organization_id: 'org-1',
  status: 'pending',
  start_date: '2025-01-01',
  end_date: '2025-12-31',
  services: [{ service_code: '97153', approved_units: 60 }],
};

const noteRow = {
  id: 'note-1',
  authorization_id: authRecord.id,
  client_id: 'client-1',
  therapist_id: 'therapist-1',
  organization_id: authRecord.organization_id,
  service_code: '97153',
  session_date: '2025-06-01',
  start_time: '09:00',
  end_time: '10:00',
  session_duration: 60,
  goals_addressed: [],
  narrative: 'test',
  is_locked: false,
  signed_at: null,
  created_at: '2025-06-01T00:00:00Z',
  updated_at: '2025-06-01T00:00:00Z',
};

const buildSelectSingle = <T>(data: T) => ({
  single: async () => ({ data, error: null }),
});

const setupMocks = (authStatus: string) => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'authorizations') {
      return {
        select: () => ({
          eq: () => buildSelectSingle({ ...authRecord, status: authStatus }),
        }),
      };
    }

    if (table === 'client_session_notes') {
      return {
        insert: () => ({
          select: () => buildSelectSingle({ ...noteRow }),
        }),
      };
    }

    return {};
  });
};

describe('createClientSessionNote', () => {
  it('rejects when authorization is not approved', async () => {
    setupMocks('pending');

    await expect(
      createClientSessionNote({
        authorizationId: authRecord.id,
        clientId: 'client-1',
        therapistId: 'therapist-1',
        organizationId: authRecord.organization_id,
        createdBy: 'user-1',
        serviceCode: '97153',
        sessionDate: '2025-06-01',
        startTime: '09:00',
        endTime: '10:00',
        sessionDuration: 60,
        goalsAddressed: [],
        narrative: 'test',
        isLocked: false,
      })
    ).rejects.toThrow(/must be approved/i);
  });

  it('succeeds when authorization is approved and scoped', async () => {
    setupMocks('approved');

    const result = await createClientSessionNote({
      authorizationId: authRecord.id,
      clientId: 'client-1',
      therapistId: 'therapist-1',
      organizationId: authRecord.organization_id,
      createdBy: 'user-1',
      serviceCode: '97153',
      sessionDate: '2025-06-01',
      startTime: '09:00',
      endTime: '10:00',
      sessionDuration: 60,
      goalsAddressed: [],
      narrative: 'test',
      isLocked: false,
    });

    expect(result.id).toBe(noteRow.id);
  });
});

