import {
  buildGoalMeasurementEntry,
  getGoalMeasurementTargets,
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
        target: '  Match peer greeting in 4/5 trials  ',
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
        targets: ['Match peer greeting in 4/5 trials'],
        target: 'Match peer greeting in 4/5 trials',
        target_trials: [
          {
            target: 'Match peer greeting in 4/5 trials',
            metric_value: 4,
            incorrect_trials: null,
            opportunities: 5,
            trial_prompt_note: null,
          },
        ],
        trial_prompt_note: null,
      },
    });
  });

  it('falls back to legacy promptLevel when canonical prompt_level is empty', () => {
    expect(
      normalizeGoalMeasurementEntry({
        metric_value: 1,
        prompt_level: '',
        promptLevel: 'Model',
      }),
    ).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          prompt_level: 'Model',
        }),
      }),
    );
  });

  it('normalizes target-scoped trial rows and derives legacy summary fields', () => {
    expect(
      normalizeGoalMeasurementEntry({
        targets: ['Tie shoes', 'Ask for help'],
        target_trials: [
          {
            metric_value: '3',
            incorrect_trials: '1',
            trialPromptNote: 'Verbal prompt',
          },
          {
            metric_value: 2,
            incorrectTrials: 0,
            opportunities: '4',
            trial_prompt_note: 'Independent',
          },
        ],
      }),
    ).toEqual({
      version: 1,
      data: {
        measurement_type: null,
        metric_label: 'Count',
        metric_unit: 'responses',
        metric_value: 5,
        incorrect_trials: 1,
        opportunities: 4,
        prompt_level: null,
        note: null,
        targets: ['Tie shoes', 'Ask for help'],
        target: 'Tie shoes',
        target_trials: [
          {
            target: 'Tie shoes',
            metric_value: 3,
            incorrect_trials: 1,
            opportunities: null,
            trial_prompt_note: 'Verbal prompt',
          },
          {
            target: 'Ask for help',
            metric_value: 2,
            incorrect_trials: 0,
            opportunities: 4,
            trial_prompt_note: 'Independent',
          },
        ],
        trial_prompt_note: 'Verbal prompt; Independent',
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
        targets: null,
        target: null,
        target_trials: [
          {
            target: null,
            metric_value: 12,
            incorrect_trials: null,
            opportunities: null,
            trial_prompt_note: null,
          },
        ],
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

  it('prefers targets arrays and falls back to legacy target strings', () => {
    expect(getGoalMeasurementTargets({ targets: [' First ', 'Second'], target: 'Legacy' } as any)).toEqual([
      'First',
      'Second',
    ]);
    expect(getGoalMeasurementTargets({ target: ' Legacy only ' } as any)).toEqual(['Legacy only']);
  });

  it('drops whitespace-only targets and empty target trial rows', () => {
    expect(
      normalizeGoalMeasurementEntry({
        targets: ['  '],
        target_trials: [{ target: ' ', metric_value: '', incorrect_trials: null, trial_prompt_note: '  ' }],
      }),
    ).toBeNull();
  });

  it('merges unique goal ids while trimming blanks', () => {
    expect(
      mergeUniqueGoalIds(['goal-1', ' goal-2 '], ['goal-2', '', undefined], null, ['goal-3'], { trimValues: true }),
    ).toEqual(['goal-1', 'goal-2', 'goal-3']);
  });
});
