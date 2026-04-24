import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createClientSessionNote,
  fetchClientSessionNotes,
  updateClientSessionNote,
  upsertClientSessionNoteForSession,
} from '../session-notes';

const mockFrom = vi.fn();
const callApiMock = vi.fn();

vi.mock('../supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock('../api', () => ({
  callApi: (...args: unknown[]) => callApiMock(...args),
}));

const baseServerNote = {
  id: 'note-1',
  date: '2025-06-01',
  start_time: '09:00:00',
  end_time: '10:00:00',
  service_code: '97153',
  therapist_id: 'therapist-1',
  therapist_name: 'Test Therapist',
  goals_addressed: ['Goal A'],
  goal_ids: ['goal-1'],
  goal_notes: { 'goal-1': 'Updated note' },
  goal_measurements: { 'goal-1': { version: 1, data: { metric_value: 4 } } },
  narrative: 'Updated narrative',
  is_locked: false,
  client_id: 'client-1',
  authorization_id: 'auth-1',
  organization_id: 'org-1',
  session_duration: 60,
  signed_at: null,
  created_at: '2025-06-01T00:00:00.000Z',
  updated_at: '2025-06-01T00:00:00.000Z',
};

describe('fetchClientSessionNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when organizationId is missing', async () => {
    await expect(fetchClientSessionNotes('client-1', null)).rejects.toThrow(
      /Organization context is required/,
    );
  });

  it('normalizes legacy goal_measurements payloads returned from Supabase', async () => {
    const rows = [
      {
        id: 'note-1',
        authorization_id: 'auth-1',
        client_id: 'client-1',
        therapist_id: 'therapist-1',
        organization_id: 'org-1',
        service_code: '97153',
        session_date: '2025-06-01',
        start_time: '09:00',
        end_time: '10:00',
        session_duration: 60,
        goals_addressed: ['Goal A'],
        goal_ids: ['goal-1'],
        goal_measurements: {
          'goal-1': {
            count: 4,
            trials: 5,
            promptLevel: 'Gestural',
            comment: 'Legacy payload still loads',
          },
        },
        goal_notes: { 'goal-1': 'Captured note' },
        narrative: 'test',
        is_locked: false,
        signed_at: null,
        created_at: '2025-06-01T00:00:00Z',
        updated_at: '2025-06-01T00:00:00Z',
        therapists: { full_name: 'Test Therapist', title: 'BCBA' },
      },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table !== 'client_session_notes') {
        return {};
      }

      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(async () => ({ data: rows, error: null })),
      };

      return chain;
    });

    const result = await fetchClientSessionNotes('client-1', 'org-1');

    expect(result[0]?.goal_measurements).toEqual({
      'goal-1': {
        version: 1,
        data: {
          measurement_type: null,
          metric_label: 'Count',
          metric_unit: null,
          metric_value: 4,
          incorrect_trials: null,
          opportunities: 5,
          prompt_level: 'Gestural',
          note: 'Legacy payload still loads',
          trial_prompt_note: null,
        },
      },
    });
  });

  it('retries without goal_measurements when select fails on missing column', async () => {
    const fallbackRows = [
      {
        id: 'note-fallback',
        authorization_id: 'auth-1',
        client_id: 'client-1',
        therapist_id: 'therapist-1',
        organization_id: 'org-1',
        service_code: '97153',
        session_date: '2025-06-01',
        start_time: '09:00',
        end_time: '10:00',
        session_duration: 60,
        goals_addressed: ['Goal A'],
        goal_ids: ['goal-1'],
        goal_notes: { 'goal-1': 'Captured note without measurements column' },
        narrative: 'test',
        is_locked: false,
        signed_at: null,
        created_at: '2025-06-01T00:00:00Z',
        updated_at: '2025-06-01T00:00:00Z',
        therapists: { full_name: 'Fallback Therapist', title: 'BCBA' },
      },
    ];
    const selectCalls: string[] = [];

    mockFrom.mockImplementation((table: string) => {
      if (table !== 'client_session_notes') {
        return {};
      }
      const chain = {
        select: vi.fn((clause: string) => {
          selectCalls.push(clause);
          return chain;
        }),
        eq: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(async () => {
          if (selectCalls.length === 1) {
            return {
              data: null,
              error: {
                code: '42703',
                message: 'column client_session_notes.goal_measurements does not exist',
                details: null,
                hint: null,
              },
            };
          }
          return { data: fallbackRows, error: null };
        }),
      };
      return chain;
    });

    const result = await fetchClientSessionNotes('client-1', 'org-1');

    expect(selectCalls).toHaveLength(2);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('note-fallback');
    expect(result[0]?.goal_measurements).toBeNull();
    expect(result[0]?.goal_notes).toEqual({ 'goal-1': 'Captured note without measurements column' });
  });

  it('retries without goal_measurements when select fails with PGRST204 schema-cache error', async () => {
    const fallbackRows = [
      {
        id: 'note-pgrst204',
        authorization_id: 'auth-1',
        client_id: 'client-1',
        therapist_id: 'therapist-1',
        organization_id: 'org-1',
        service_code: '97153',
        session_date: '2025-06-01',
        start_time: '09:00',
        end_time: '10:00',
        session_duration: 60,
        goals_addressed: ['Goal A'],
        goal_ids: ['goal-1'],
        goal_notes: { 'goal-1': 'Recovered from schema cache miss' },
        narrative: 'test',
        is_locked: false,
        signed_at: null,
        created_at: '2025-06-01T00:00:00Z',
        updated_at: '2025-06-01T00:00:00Z',
        therapists: { full_name: 'Fallback Therapist', title: 'BCBA' },
      },
    ];
    let selectCount = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table !== 'client_session_notes') {
        return {};
      }
      const chain = {
        select: vi.fn(() => {
          selectCount += 1;
          return chain;
        }),
        eq: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(async () => {
          if (selectCount === 1) {
            return {
              data: null,
              error: {
                code: 'PGRST204',
                message: "Could not find the 'goal_measurements' column of 'client_session_notes' in the schema cache",
                details: null,
                hint: null,
              },
            };
          }
          return { data: fallbackRows, error: null };
        }),
      };
      return chain;
    });

    const result = await fetchClientSessionNotes('client-1', 'org-1');

    expect(selectCount).toBe(2);
    expect(result[0]?.id).toBe('note-pgrst204');
    expect(result[0]?.goal_measurements).toBeNull();
  });

  it('does not fallback for unrelated select errors', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'client_session_notes') {
        return {};
      }
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(async () => ({
          data: null,
          error: {
            code: '42703',
            message: 'column client_session_notes.some_other_column does not exist',
            details: null,
            hint: null,
          },
        })),
      };
      return chain;
    });

    await expect(fetchClientSessionNotes('client-1', 'org-1')).rejects.toMatchObject({
      code: '42703',
    });
  });
});

describe('session note write helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callApiMock.mockResolvedValue({
      ok: true,
      json: async () => baseServerNote,
    });
  });

  it('createClientSessionNote writes through /api/session-notes/upsert', async () => {
    const result = await createClientSessionNote({
      authorizationId: 'auth-1',
      clientId: 'client-1',
      therapistId: 'therapist-1',
      organizationId: 'org-1',
      createdBy: 'user-1',
      serviceCode: '97153',
      sessionDate: '2025-06-01',
      startTime: '09:00',
      endTime: '10:00',
      sessionDuration: 60,
      goalsAddressed: ['Goal A'],
      goalIds: ['goal-1'],
      goalNotes: { 'goal-1': 'Good progress' },
      goalMeasurements: { 'goal-1': { version: 1, data: { metric_value: 4 } } },
      narrative: 'Narrative',
      isLocked: false,
      sessionId: 'session-1',
    });

    expect(result.id).toBe('note-1');
    expect(callApiMock).toHaveBeenCalledWith(
      '/api/session-notes/upsert',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );

    const payload = JSON.parse(callApiMock.mock.calls[0][1].body) as Record<string, unknown>;
    expect(payload.noteId).toBeUndefined();
    expect(payload.goalMeasurements).toEqual({ 'goal-1': { version: 1, data: { metric_value: 4 } } });
  });

  it('updateClientSessionNote sends noteId and does not send updated_by', async () => {
    await updateClientSessionNote({
      noteId: 'note-existing',
      authorizationId: 'auth-1',
      clientId: 'client-1',
      therapistId: 'therapist-1',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      serviceCode: '97153',
      sessionDate: '2025-06-01',
      startTime: '09:00',
      endTime: '10:00',
      sessionDuration: 60,
      goalsAddressed: ['Goal A'],
      goalIds: ['goal-1'],
      goalMeasurements: { 'goal-1': { version: 1, data: { metric_value: 4 } } },
      goalNotes: { 'goal-1': 'Updated note' },
      narrative: 'Updated narrative',
      isLocked: false,
      sessionId: 'session-1',
    });

    const payload = JSON.parse(callApiMock.mock.calls[0][1].body) as Record<string, unknown>;
    expect(payload.noteId).toBe('note-existing');
    expect(payload).not.toHaveProperty('updated_by');
  });

  it('upsertClientSessionNoteForSession rejects invalid time ranges before API call', async () => {
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
        startTime: '10:00',
        endTime: '09:00',
        goalsAddressed: ['Goal A'],
        goalIds: ['goal-1'],
        goalMeasurements: { 'goal-1': { version: 1, data: { metric_value: 2 } } },
        goalNotes: { 'goal-1': 'Progress captured' },
        narrative: 'Narrative text',
      }),
    ).rejects.toThrow(/End time must be later than start time/i);

    expect(callApiMock).not.toHaveBeenCalled();
  });

  it('throws server error message when API request fails', async () => {
    callApiMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Session note is locked and cannot be edited.' }),
    });

    await expect(
      updateClientSessionNote({
        noteId: 'note-locked',
        authorizationId: 'auth-1',
        clientId: 'client-1',
        therapistId: 'therapist-1',
        organizationId: 'org-1',
        actorUserId: 'user-1',
        serviceCode: '97153',
        sessionDate: '2025-06-01',
        startTime: '09:00',
        endTime: '10:00',
        sessionDuration: 60,
        goalsAddressed: ['Goal A'],
        goalIds: ['goal-1'],
        goalNotes: { 'goal-1': 'Updated note' },
        narrative: 'Updated narrative',
        isLocked: false,
      }),
    ).rejects.toThrow(/locked/i);
  });
});
