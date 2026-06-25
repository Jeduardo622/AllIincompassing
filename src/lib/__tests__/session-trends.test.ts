import { describe, expect, it } from 'vitest';
import type { Goal, SessionNote } from '../../types';
import { buildSessionTrendModel } from '../session-trends';

const goal: Goal = {
  id: 'goal-1',
  organization_id: 'org-1',
  client_id: 'client-1',
  program_id: 'program-1',
  title: 'Emergency scenarios',
  description: 'Responds to emergency scenarios',
  original_text: 'Emergency scenarios',
  measurement_type: 'percent accuracy',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const note = (
  id: string,
  date: string,
  targetTrials: Array<{ target: string; metric_value: number; incorrect_trials?: number | null; opportunities?: number | null }>,
): SessionNote => ({
  id,
  date,
  start_time: '09:00:00',
  end_time: '10:00:00',
  service_code: '97153',
  therapist_name: 'Test Therapist',
  therapist_id: 'therapist-1',
  goals_addressed: [goal.title],
  goal_ids: [goal.id],
  goal_notes: null,
  goal_measurements: {
    [goal.id]: {
      version: 1,
      data: {
        measurement_type: 'percent accuracy',
        targets: ['lost in community'],
        target_trials: targetTrials,
      },
    },
  },
  session_id: id,
  narrative: 'Session note',
  is_locked: false,
  client_id: 'client-1',
  authorization_id: 'auth-1',
  organization_id: 'org-1',
});

describe('buildSessionTrendModel', () => {
  it('computes monthly medians from per-session target trial percentages', () => {
    const model = buildSessionTrendModel(
      [
        note('note-1', '2026-06-01', [{ target: 'lost in community', metric_value: 8, opportunities: 10 }]),
        note('note-2', '2026-06-10', [{ target: 'lost in community', metric_value: 6, opportunities: 10 }]),
        note('note-3', '2026-06-20', [{ target: 'lost in community', metric_value: 10, opportunities: 10 }]),
      ],
      [goal],
      {
        displayPeriod: 'month',
        dateRange: { startDate: '2026-06-01', endDate: '2026-06-30' },
      },
    );

    expect(model.goalOptions).toEqual([{ id: 'goal-1', label: 'Emergency scenarios', programName: null }]);
    expect(model.targetOptions).toEqual([
      { key: 'goal-1::lost in community', goalId: 'goal-1', label: 'lost in community' },
    ]);
    expect(model.buckets).toHaveLength(1);
    expect(model.buckets[0]).toMatchObject({
      bucketKey: '2026-06',
      label: 'Jun 2026',
      median: 80,
      sampleSize: 3,
    });
  });

  it('uses correct plus incorrect trials when opportunities are not captured', () => {
    const model = buildSessionTrendModel(
      [
        note('note-1', '2026-06-01', [{ target: 'Earthquake', metric_value: 3, incorrect_trials: 1 }]),
        note('note-2', '2026-06-08', [{ target: 'Earthquake', metric_value: 1, incorrect_trials: 1 }]),
      ],
      [goal],
      {
        displayPeriod: 'month',
        dateRange: { startDate: '2026-06-01', endDate: '2026-06-30' },
      },
    );

    expect(model.buckets[0].median).toBe(62.5);
    expect(model.buckets[0].evidence.map((point) => point.denominator)).toEqual([4, 2]);
  });

  it('excludes sessions without graphable trial data instead of treating them as zero', () => {
    const emptyNote: SessionNote = {
      ...note('note-empty', '2026-06-01', []),
      goal_measurements: null,
    };

    const model = buildSessionTrendModel(
      [
        emptyNote,
        note('note-1', '2026-06-10', [{ target: 'lost in community', metric_value: 8, opportunities: 10 }]),
      ],
      [goal],
      {
        displayPeriod: 'month',
        dateRange: { startDate: '2026-06-01', endDate: '2026-06-30' },
      },
    );

    expect(model.excludedSessionCount).toBe(1);
    expect(model.buckets[0].median).toBe(80);
    expect(model.buckets[0].sampleSize).toBe(1);
  });

  it('supports legacy flat percent measurements without target_trials', () => {
    const flatNote: SessionNote = {
      ...note('note-flat', '2026-06-01', []),
      goal_measurements: {
        [goal.id]: {
          version: 1,
          data: {
            measurement_type: 'percent accuracy',
            metric_label: 'Percent',
            metric_unit: '%',
            metric_value: 75,
            target: 'Earthquake',
          },
        },
      },
    };

    const model = buildSessionTrendModel(
      [flatNote],
      [goal],
      {
        displayPeriod: 'month',
        dateRange: { startDate: '2026-06-01', endDate: '2026-06-30' },
      },
    );

    expect(model.targetOptions).toEqual([
      { key: 'goal-1::earthquake', goalId: 'goal-1', label: 'Earthquake' },
    ]);
    expect(model.buckets[0].median).toBe(75);
    expect(model.buckets[0].evidence[0]).toMatchObject({
      source: 'flat_percent',
      numerator: null,
      denominator: null,
    });
  });
});
