import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkSchedulingConflicts, suggestAlternativeTimes } from '../conflicts';
import { parseISO, addHours } from 'date-fns';
import { supabase } from '../supabase';

// Mock supabase
vi.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn()
    }
  }
}));

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
      created_at: '2025-05-19T00:00:00Z'
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
      'session-1' // Exclude this session
    );

    expect(conflicts).toHaveLength(0);
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
      created_at: '2025-05-19T00:00:00Z'
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
        excludeSessionId: undefined
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