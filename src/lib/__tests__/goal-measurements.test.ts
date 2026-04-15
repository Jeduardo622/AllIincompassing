import {
  buildGoalMeasurementEntry,
  getGoalMeasurementFieldMeta,
  mergeGoalMeasurementEntry,
  mergeUniqueGoalIds,
  normalizeGoalMeasurementEntry,
} from '../goal-measurements';

describe('goal-measurements helpers', () => {
  it('derives percent-oriented field metadata from measurement_type', () => {
    expect(getGoalMeasurementFieldMeta({ measurement_type: 'Percent Accuracy' } as any)).toEqual(
      expect.objectContaining({
        primaryLabel: 'Percent',
        primaryUnit: '%',
        secondaryLabel: 'Opportunities',
        step: 1,
      }),
    );
  });

  it('normalizes legacy measurement payloads into the versioned envelope', () => {
    expect(
      normalizeGoalMeasurementEntry({
        count: '4',
        trials: '5',
        promptLevel: 'Gestural',
        comment: 'Needed one reminder',
      }),
    ).toEqual({
      version: 1,
      data: {
        measurement_type: null,
        metric_label: 'Count',
        metric_unit: 'responses',
        metric_value: 4,
        incorrect_trials: null,
        opportunities: 5,
        prompt_level: 'Gestural',
        note: 'Needed one reminder',
        trial_prompt_note: null,
      },
    });
  });

  it('builds a goal-scoped measurement entry with goal defaults', () => {
    expect(
      buildGoalMeasurementEntry(
        { measurement_type: 'duration' } as any,
        { data: { metric_value: 12 } },
      ),
    ).toEqual({
      version: 1,
      data: {
        measurement_type: 'duration',
        metric_label: 'Duration',
        metric_unit: 'minutes',
        metric_value: 12,
        incorrect_trials: null,
        opportunities: null,
        prompt_level: null,
        note: null,
        trial_prompt_note: null,
      },
    });
  });

  it('merges entry updates and removes empty payloads', () => {
    expect(
      mergeGoalMeasurementEntry(
        { measurement_type: 'frequency' } as any,
        { data: { metric_value: 3, opportunities: 4, note: 'Initial' } },
        { metric_value: null, opportunities: null, note: null, prompt_level: null },
      ),
    ).toBeNull();
  });

  it('merges unique goal ids while trimming blanks', () => {
    expect(
      mergeUniqueGoalIds(['goal-1', ' goal-2 '], ['goal-2', '', undefined], null, ['goal-3'], { trimValues: true }),
    ).toEqual(['goal-1', 'goal-2', 'goal-3']);
  });
});
