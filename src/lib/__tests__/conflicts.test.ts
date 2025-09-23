import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkSchedulingConflicts, suggestAlternativeTimes } from '../conflicts';
import { parseISO, addHours } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
// Mock supabase
vi.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

let supabase: { functions: { invoke: ReturnType<typeof vi.fn> } };

beforeEach(async () => {
  ({ supabase } = await import('../supabase'));
  vi.mocked(supabase.functions.invoke).mockReset();
});

describe('checkSchedulingConflicts', () => {
  const mockTherapist = {
    id: 'therapist-1',
    full_name: 'Test Therapist',
    availability_hours: {
      monday: { start: '09:00', end: '17:00' },
      tuesday: { start: '09:00', end: '17:00' },
      wednesday: { start: '09:00', end: '17:00' },
      thursday: { start: '09:00', end: '17:00' },
      friday: { start: '09:00', end: '17:00' },
      saturday: { start: null, end: null }
    },
    service_type: ['In clinic'],
    email: 'test@example.com'
  };

  const mockClient = {
    id: 'client-1',
    full_name: 'Test Client',
    availability_hours: {
      monday: { start: '10:00', end: '16:00' },
      tuesday: { start: '10:00', end: '16:00' },
      wednesday: { start: '10:00', end: '16:00' },
      thursday: { start: '10:00', end: '16:00' },
      friday: { start: '10:00', end: '16:00' },
      saturday: { start: null, end: null }
    },
    service_preference: ['In clinic'],
    email: 'client@example.com',
    date_of_birth: '2000-01-01'
  };

  const mockExistingSessions = [
    {
      id: 'session-1',
      therapist_id: 'therapist-1',
      client_id: 'client-2',
      start_time: '2025-05-20T13:00:00Z',
      end_time: '2025-05-20T14:00:00Z',
      status: 'scheduled',
      notes: '',
      created_at: '2025-05-19T00:00:00Z',
      created_by: 'tester',
      updated_at: '2025-05-19T00:00:00Z',
      updated_by: 'tester'
    }
  ];

  it('detects therapist unavailability', async () => {
    const startTime = '2025-05-20T08:00:00Z'; // 8 AM, before therapist availability
    const endTime = '2025-05-20T09:00:00Z';

    // Use a client that is available during this time so only the therapist is unavailable
    const availableClient = {
      ...mockClient,
      availability_hours: {
        ...mockClient.availability_hours,
        monday: { start: '08:00', end: '17:00' },
        tuesday: { start: '08:00', end: '17:00' },
      },
    };

    const conflicts = await checkSchedulingConflicts(
      startTime,
      endTime,
      mockTherapist.id,
      availableClient.id,
      mockExistingSessions,
      mockTherapist,
      availableClient
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe('therapist_unavailable');
  });

  it('detects client unavailability', async () => {
    const startTime = '2025-05-20T09:00:00Z'; // 9 AM, before client availability
    const endTime = '2025-05-20T10:00:00Z';

    const conflicts = await checkSchedulingConflicts(
      startTime,
      endTime,
      mockTherapist.id,
      mockClient.id,
      mockExistingSessions,
      mockTherapist,
      mockClient
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe('client_unavailable');
  });

  it('detects session overlap', async () => {
    const startTime = '2025-05-20T13:30:00Z'; // Overlaps with existing session
    const endTime = '2025-05-20T14:30:00Z';

    const conflicts = await checkSchedulingConflicts(
      startTime,
      endTime,
      mockTherapist.id,
      mockClient.id,
      mockExistingSessions,
      mockTherapist,
      mockClient
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe('session_overlap');
  });

  it('returns no conflicts when time is valid', async () => {
    const startTime = '2025-05-20T11:00:00Z'; // Valid time
    const endTime = '2025-05-20T12:00:00Z';

    const conflicts = await checkSchedulingConflicts(
      startTime,
      endTime,
      mockTherapist.id,
      mockClient.id,
      mockExistingSessions,
      mockTherapist,
      mockClient
    );

    expect(conflicts).toHaveLength(0);
  });

  it('respects minute-level availability windows with 15-minute offsets', async () => {
    const therapistWithOffsets = {
      ...mockTherapist,
      availability_hours: {
        ...mockTherapist.availability_hours,
        tuesday: { start: '09:15', end: '17:45' },
      },
    };

    const clientWithOffsets = {
      ...mockClient,
      availability_hours: {
        ...mockClient.availability_hours,
        tuesday: { start: '09:30', end: '18:30' },
      },
    };

    const earlyStart = '2025-05-20T09:00:00Z';
    const earlyEnd = addHours(parseISO(earlyStart), 1).toISOString();
    const earlyConflicts = await checkSchedulingConflicts(
      earlyStart,
      earlyEnd,
      therapistWithOffsets.id,
      clientWithOffsets.id,
      [],
      therapistWithOffsets,
      clientWithOffsets
    );

    expect(earlyConflicts).toHaveLength(1);
    expect(earlyConflicts[0]?.type).toBe('therapist_unavailable');

    const clientEarlyStart = '2025-05-20T09:15:00Z';
    const clientEarlyEnd = addHours(parseISO(clientEarlyStart), 1).toISOString();
    const clientEarlyConflicts = await checkSchedulingConflicts(
      clientEarlyStart,
      clientEarlyEnd,
      therapistWithOffsets.id,
      clientWithOffsets.id,
      [],
      therapistWithOffsets,
      clientWithOffsets
    );

    expect(clientEarlyConflicts).toHaveLength(1);
    expect(clientEarlyConflicts[0]?.type).toBe('client_unavailable');

    const validStart = '2025-05-20T09:30:00Z';
    const validEnd = addHours(parseISO(validStart), 1).toISOString();
    const validConflicts = await checkSchedulingConflicts(
      validStart,
      validEnd,
      therapistWithOffsets.id,
      clientWithOffsets.id,
      [],
      therapistWithOffsets,
      clientWithOffsets
    );

    expect(validConflicts).toHaveLength(0);

    const lateStart = '2025-05-20T17:00:00Z';
    const lateEnd = addHours(parseISO(lateStart), 1).toISOString();
    const lateConflicts = await checkSchedulingConflicts(
      lateStart,
      lateEnd,
      therapistWithOffsets.id,
      clientWithOffsets.id,
      [],
      therapistWithOffsets,
      clientWithOffsets
    );

    expect(lateConflicts).toHaveLength(1);
    expect(lateConflicts[0]?.type).toBe('therapist_unavailable');
  });

  it('ignores excluded session when checking for conflicts', async () => {
    const startTime = '2025-05-20T13:00:00Z'; // Same as existing session
    const endTime = '2025-05-20T14:00:00Z';

    const conflicts = await checkSchedulingConflicts(
      startTime,
      endTime,
      mockTherapist.id,
      mockClient.id,
      mockExistingSessions,
      mockTherapist,
      mockClient,
      { excludeSessionId: 'session-1' }
    );

    expect(conflicts).toHaveLength(0);
  });

  it('detects availability conflicts around DST spring forward for early times', async () => {
    const timeZone = 'America/New_York';
    const earlyStart = fromZonedTime('2025-03-10T07:00', timeZone).toISOString();
    const earlyEnd = fromZonedTime('2025-03-10T08:00', timeZone).toISOString();

    const conflicts = await checkSchedulingConflicts(
      earlyStart,
      earlyEnd,
      mockTherapist.id,
      mockClient.id,
      [],
      mockTherapist,
      mockClient,
      { timeZone }
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe('therapist_unavailable');
  });

  it('detects overlaps against recurring session occurrences', async () => {
    const recurrenceClient = {
      ...mockClient,
      availability_hours: {
        ...mockClient.availability_hours,
        tuesday: { start: '09:00', end: '18:00' },
      },
    };

    const recurringSessions = [
      {
        id: 'recurring-1',
        therapist_id: mockTherapist.id,
        client_id: recurrenceClient.id,
        start_time: '2025-05-20T15:00:00Z',
        end_time: '2025-05-20T16:00:00Z',
        status: 'scheduled',
        notes: '',
        created_at: '2025-05-19T00:00:00Z',
        created_by: 'tester',
        updated_at: '2025-05-19T00:00:00Z',
        updated_by: 'tester',
      },
      {
        id: 'recurring-2',
        therapist_id: mockTherapist.id,
        client_id: recurrenceClient.id,
        start_time: '2025-05-27T15:00:00Z',
        end_time: '2025-05-27T16:00:00Z',
        status: 'scheduled',
        notes: '',
        created_at: '2025-05-19T00:00:00Z',
        created_by: 'tester',
        updated_at: '2025-05-19T00:00:00Z',
        updated_by: 'tester',
      },
      {
        id: 'recurring-3',
        therapist_id: mockTherapist.id,
        client_id: recurrenceClient.id,
        start_time: '2025-06-03T15:00:00Z',
        end_time: '2025-06-03T16:00:00Z',
        status: 'scheduled',
        notes: '',
        created_at: '2025-05-19T00:00:00Z',
        created_by: 'tester',
        updated_at: '2025-05-19T00:00:00Z',
        updated_by: 'tester',
      },
    ];

    const overlappingStart = '2025-05-27T15:30:00Z';
    const overlappingEnd = addHours(parseISO(overlappingStart), 1).toISOString();
    const overlappingConflicts = await checkSchedulingConflicts(
      overlappingStart,
      overlappingEnd,
      mockTherapist.id,
      recurrenceClient.id,
      recurringSessions,
      mockTherapist,
      recurrenceClient
    );

    expect(overlappingConflicts).toHaveLength(1);
    expect(overlappingConflicts[0]?.type).toBe('session_overlap');

    const editingStart = '2025-05-27T15:00:00Z';
    const editingEnd = addHours(parseISO(editingStart), 1).toISOString();
    const editingConflicts = await checkSchedulingConflicts(
      editingStart,
      editingEnd,
      mockTherapist.id,
      recurrenceClient.id,
      recurringSessions,
      mockTherapist,
      recurrenceClient,
      { excludeSessionId: 'recurring-2' }
    );

    expect(editingConflicts).toHaveLength(0);

    const futureStart = '2025-06-10T15:00:00Z';
    const futureEnd = addHours(parseISO(futureStart), 1).toISOString();
    const futureConflicts = await checkSchedulingConflicts(
      futureStart,
      futureEnd,
      mockTherapist.id,
      recurrenceClient.id,
      recurringSessions,
      mockTherapist,
      recurrenceClient
    );

    expect(futureConflicts).toHaveLength(0);
  });

  it('detects availability conflicts around DST fall back for early times', async () => {
    const timeZone = 'America/New_York';
    const earlyStart = fromZonedTime('2025-11-03T07:00', timeZone).toISOString();
    const earlyEnd = fromZonedTime('2025-11-03T08:00', timeZone).toISOString();

    const conflicts = await checkSchedulingConflicts(
      earlyStart,
      earlyEnd,
      mockTherapist.id,
      mockClient.id,
      [],
      mockTherapist,
      mockClient,
      { timeZone }
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe('therapist_unavailable');
  });
});

describe('suggestAlternativeTimes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const mockTherapist = {
    id: 'therapist-1',
    full_name: 'Test Therapist',
    availability_hours: {
      monday: { start: '09:00', end: '17:00' },
      tuesday: { start: '09:00', end: '17:00' },
      wednesday: { start: '09:00', end: '17:00' },
      thursday: { start: '09:00', end: '17:00' },
      friday: { start: '09:00', end: '17:00' },
      saturday: { start: null, end: null }
    },
    service_type: ['In clinic'],
    email: 'test@example.com'
  };

  const mockClient = {
    id: 'client-1',
    full_name: 'Test Client',
    availability_hours: {
      monday: { start: '10:00', end: '16:00' },
      tuesday: { start: '10:00', end: '16:00' },
      wednesday: { start: '10:00', end: '16:00' },
      thursday: { start: '10:00', end: '16:00' },
      friday: { start: '10:00', end: '16:00' },
      saturday: { start: null, end: null }
    },
    service_preference: ['In clinic'],
    email: 'client@example.com',
    date_of_birth: '2000-01-01'
  };

  const mockExistingSessions = [
    {
      id: 'session-1',
      therapist_id: 'therapist-1',
      client_id: 'client-2',
      start_time: '2025-05-20T13:00:00Z',
      end_time: '2025-05-20T14:00:00Z',
      status: 'scheduled',
      notes: '',
      created_at: '2025-05-19T00:00:00Z',
      created_by: 'tester',
      updated_at: '2025-05-19T00:00:00Z',
      updated_by: 'tester'
    }
  ];

  const mockConflicts = [
    {
      type: 'therapist_unavailable' as const,
      message: 'Therapist Test Therapist is not available during this time'
    }
  ];

  const mockAlternatives = [
    {
      startTime: '2025-05-20T10:00:00Z',
      endTime: '2025-05-20T11:00:00Z',
      score: 0.9,
      reason: 'This time works well for both therapist and client'
    }
  ];

  it('calls the Supabase function with correct parameters', async () => {
    const mockInvoke = vi.mocked(supabase.functions.invoke);
    mockInvoke.mockResolvedValue({
      data: { alternatives: mockAlternatives },
      error: null
    });

    const startTime = '2025-05-20T08:00:00Z';
    const endTime = '2025-05-20T09:00:00Z';

    const result = await suggestAlternativeTimes(
      startTime,
      endTime,
      mockTherapist.id,
      mockClient.id,
      mockExistingSessions,
      mockTherapist,
      mockClient,
      mockConflicts
    );

    expect(mockInvoke).toHaveBeenCalledWith('suggest-alternative-times', {
      body: {
        startTime,
        endTime,
        therapistId: mockTherapist.id,
        clientId: mockClient.id,
        conflicts: mockConflicts,
        therapist: mockTherapist,
        client: mockClient,
        existingSessions: mockExistingSessions,
        excludeSessionId: undefined,
        timeZone: 'UTC'
      }
    });

    expect(result).toEqual(mockAlternatives);
  });

  it('returns empty array when Supabase function fails', async () => {
    const mockInvoke = vi.mocked(supabase.functions.invoke);
    mockInvoke.mockResolvedValue({
      data: null,
      error: new Error('Function failed')
    });

    const startTime = '2025-05-20T08:00:00Z';
    const endTime = '2025-05-20T09:00:00Z';

    const result = await suggestAlternativeTimes(
      startTime,
      endTime,
      mockTherapist.id,
      mockClient.id,
      mockExistingSessions,
      mockTherapist,
      mockClient,
      mockConflicts
    );

    expect(result).toEqual([]);
  });

  it('handles exceptions gracefully', async () => {
    const mockInvoke = vi.mocked(supabase.functions.invoke);
    mockInvoke.mockRejectedValue(new Error('Network error'));

    const startTime = '2025-05-20T08:00:00Z';
    const endTime = '2025-05-20T09:00:00Z';

    const result = await suggestAlternativeTimes(
      startTime,
      endTime,
      mockTherapist.id,
      mockClient.id,
      mockExistingSessions,
      mockTherapist,
      mockClient,
      mockConflicts
    );

    expect(result).toEqual([]);
  });
});