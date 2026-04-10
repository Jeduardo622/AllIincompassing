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
import { createClientSessionNote, upsertClientSessionNoteForSession } from '../session-notes';

const mockFrom = vi.fn();
let lastInsertPayload: Record<string, unknown> | null = null;

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
  goal_ids: [],
  goal_measurements: null,
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
        insert: (payload: Record<string, unknown>) => {
          lastInsertPayload = payload;
          return {
          select: () => buildSelectSingle({ ...noteRow }),
          };
        },
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
        goalIds: ['goal-1'],
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
      goalIds: ['goal-1'],
      narrative: 'test',
      isLocked: false,
    });

    expect(result.id).toBe(noteRow.id);
    expect(lastInsertPayload?.goal_ids).toEqual(['goal-1']);
  });

  it('persists goal_notes when provided', async () => {
    setupMocks('approved');

    await createClientSessionNote({
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
      goalsAddressed: ['Goal A'],
      goalIds: ['goal-1'],
      goalNotes: { 'goal-1': 'Good progress on this goal.' },
      narrative: '',
      isLocked: false,
    });

    expect(lastInsertPayload?.goal_notes).toEqual({ 'goal-1': 'Good progress on this goal.' });
  });

  it('persists goal_measurements when provided', async () => {
    setupMocks('approved');

    await createClientSessionNote({
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
      goalsAddressed: ['Goal A'],
      goalIds: ['goal-1'],
      goalMeasurements: { 'goal-1': { version: 1, data: { count: 4 } } },
      narrative: '',
      isLocked: false,
    });

    expect(lastInsertPayload?.goal_measurements).toEqual({
      'goal-1': { version: 1, data: { count: 4 } },
    });
  });

  it('stores goal_notes as null when an empty object is provided', async () => {
    setupMocks('approved');

    await createClientSessionNote({
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
      goalIds: [],
      goalNotes: {},
      narrative: 'notes',
      isLocked: false,
    });

    expect(lastInsertPayload?.goal_notes).toBeNull();
  });

  it('stores goal_notes as null when goalNotes is omitted', async () => {
    setupMocks('approved');

    await createClientSessionNote({
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
      goalIds: [],
      narrative: 'notes',
      isLocked: false,
    });

    expect(lastInsertPayload?.goal_notes).toBeNull();
  });
});

describe('upsertClientSessionNoteForSession', () => {
  it('updates existing unlocked session notes', async () => {
    let lastUpdatePayload: Record<string, unknown> | null = null;
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'client_session_notes') {
        return {};
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'note-existing', is_locked: false },
                error: null,
              }),
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          lastUpdatePayload = payload;
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: {
                      ...noteRow,
                      ...payload,
                      id: 'note-existing',
                      therapists: null,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        },
      };
    });

    const result = await upsertClientSessionNoteForSession({
      sessionId: 'session-1',
      clientId: 'client-1',
      authorizationId: 'auth-1',
      therapistId: 'therapist-1',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      serviceCode: '97153',
      sessionDate: '2025-06-01',
      startTime: '09:00:00',
      endTime: '10:00:00',
      goalsAddressed: ['Goal A'],
      goalIds: ['goal-1'],
      goalMeasurements: { 'goal-1': { version: 1, data: { count: 2 } } },
      goalNotes: { 'goal-1': '  Progress captured  ' },
      narrative: '  Narrative text  ',
    });

    expect(result.id).toBe('note-existing');
    expect(lastUpdatePayload?.goal_notes).toEqual({ 'goal-1': 'Progress captured' });
    expect(lastUpdatePayload?.goal_measurements).toEqual({ 'goal-1': { version: 1, data: { count: 2 } } });
    expect(lastUpdatePayload?.narrative).toBe('Narrative text');
  });

  it('rejects updates for locked session notes', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'client_session_notes') {
        return {};
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'locked-note', is_locked: true },
                error: null,
              }),
            }),
          }),
        }),
      };
    });

    await expect(
      upsertClientSessionNoteForSession({
        sessionId: 'session-1',
        clientId: 'client-1',
        authorizationId: 'auth-1',
        therapistId: 'therapist-1',
        organizationId: 'org-1',
        actorUserId: 'user-1',
        serviceCode: '97153',
        sessionDate: '2025-06-01',
        startTime: '09:00:00',
        endTime: '10:00:00',
        goalsAddressed: ['Goal A'],
        goalIds: ['goal-1'],
        goalMeasurements: { 'goal-1': { version: 1, data: { count: 2 } } },
        goalNotes: { 'goal-1': 'Progress captured' },
        narrative: 'Narrative text',
      }),
    ).rejects.toThrow(/locked/i);
  });
});
