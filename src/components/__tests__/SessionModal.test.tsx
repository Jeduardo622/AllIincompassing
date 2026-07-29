import { beforeEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import { act, fireEvent } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import {
  buildCloseoutDataPoints,
  SessionModal,
  decrementLegacyPromptCounts,
  dedupeProgressionNotices,
  formatProgressionNotices,
  incrementLegacyPromptCount,
  remapLegacyPromptCorrectnessAfterRemoval,
  sumLegacyPromptCounts,
  selectSessionCaptureTargets,
  setPromptOutcomeForTarget,
} from '../SessionModal';
import { supabase } from '../../lib/supabase';
import { fetchLinkedClientSessionNoteForSession } from '../../lib/session-note-linked-fetch';
import type { Goal, GoalTarget, Session, TrialEvent } from '../../types';
import { startSessionFromModal } from '../../features/scheduling/domain/sessionStart';
import {
  finalizeBtAbaSessionNote,
  getBtAbaSessionNote,
  saveBtAbaSessionNoteDraft,
} from '../../lib/session-notes';
import type { BtAbaSessionNoteResponses } from '../../lib/bt-aba-session-note';

const toastMocks = vi.hoisted(() => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock('../../lib/toast', () => toastMocks);

vi.mock('../../features/scheduling/domain/sessionStart', () => ({
  startSessionFromModal: vi.fn(),
}));

vi.mock('../../lib/session-note-linked-fetch', () => ({
  fetchLinkedClientSessionNoteForSession: vi.fn(),
}));

vi.mock('../../lib/session-notes', () => ({
  getBtAbaSessionNote: vi.fn(),
  saveBtAbaSessionNoteDraft: vi.fn(),
  finalizeBtAbaSessionNote: vi.fn(),
}));

const validBtAbaResponses: BtAbaSessionNoteResponses = {
  purpose_of_session: ['RBT/BT worked on goals as stated in the treatment plan'],
  client_status: 'Engaged',
  skill_strategies: ['Natural environment teaching'],
  behavior_strategies: ['Modeling'],
  supervisor_support: ['Supervisor did not attend this session'],
  progress_toward_goals: 'Made progress.',
  client_response_to_treatment: 'Responded well.',
  data_point_scope: 'linked',
  link_unlinked_data: false,
  bt_signature: { method: 'typed', value: 'Test BT' },
};

vi.mock('../session-notes/BtAbaSessionNoteForm', () => ({
  BtAbaSessionNoteForm: ({
    initialResponses,
    context,
    onSaveDraft,
    onFinalize,
    busy,
    readOnly,
  }: {
    initialResponses: BtAbaSessionNoteResponses;
    context: {
      placeOfService: string;
      billingCode: string;
      modifiers: string[];
      programs: Array<{ name: string; goals: string[] }>;
      linkedDataPoints: Array<{ label: string; value: string | number }>;
      allDataPoints: Array<{ label: string; value: string | number }>;
    };
    onSaveDraft: (responses: BtAbaSessionNoteResponses) => Promise<void>;
    onFinalize: (responses: BtAbaSessionNoteResponses) => Promise<void>;
    busy: boolean;
    readOnly?: boolean;
  }) => (
    <section>
      <h2>ABA Session Note</h2>
      <p>Draft client status: {initialResponses.client_status}</p>
      <p>Mode: {readOnly ? 'finalized' : 'editable'}</p>
      <p>Place: {context.placeOfService}</p>
      <p>Billing: {context.billingCode}</p>
      <p>Modifiers: {context.modifiers.join(', ') || 'Not recorded'}</p>
      <p>Goals: {context.programs.flatMap((program) => program.goals).join(', ') || 'None'}</p>
      <p>Linked count: {context.linkedDataPoints.length}</p>
      <p>All count: {context.allDataPoints.length}</p>
      {context.allDataPoints.map((dataPoint, index) => (
        <p key={`${dataPoint.label}:${index}`}>{dataPoint.label}: {dataPoint.value}</p>
      ))}
      {!readOnly && <button type="button" disabled={busy} onClick={() => void onSaveDraft(validBtAbaResponses)}>Save ABA Draft</button>}
      {!readOnly && <button type="button" disabled={busy} onClick={() => void onFinalize(validBtAbaResponses)}>Finalize ABA Session</button>}
    </section>
  ),
}));

type SupabaseQueryChain = {
  select: () => SupabaseQueryChain;
  eq: () => SupabaseQueryChain;
  neq: () => SupabaseQueryChain;
  order: () => Promise<{ data: unknown[]; error: null }>;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  limit: () => Promise<{ data: unknown[]; error: null }>;
};

describe('SessionModal', () => {
  it('selects only current active targets for new capture while retaining hydrated history', () => {
    const base = { organization_id: 'org-a', client_id: 'client-a', goal_id: 'goal-a', measurement_type: 'frequency', graph_config: {}, sort_order: 0, current_phase: 'baseline', evaluation_window_started_at: null, progression_version: 1, created_at: '', updated_at: '' } as const;
    const current = { ...base, id: 'current', name: 'Current', status: 'active', is_current: true };
    const stale = { ...base, id: 'stale', name: 'Stale', status: 'active', is_current: false };
    const archived = { ...base, id: 'archived', name: 'Archived', status: 'archived', is_current: false };
    expect(selectSessionCaptureTargets([current, stale, archived], new Set())).toEqual([current]);
    expect(selectSessionCaptureTargets([current, stale, archived], new Set(['stale']))).toEqual([current, stale]);
  });

  it('keeps prompt outcomes isolated by configured target', () => {
    const current = { 'target-1': 'incorrect', 'target-2': 'noResponse' } as const;
    expect(setPromptOutcomeForTarget(current, 'target-1', 'correct')).toEqual({
      'target-1': 'correct',
      'target-2': 'noResponse',
    });
  });

  it('increments legacy prompt counts using exact outcome buckets', () => {
    expect(incrementLegacyPromptCount([], {
      promptType: 'gesture',
      promptLevel: null,
    }, 'noResponse')).toEqual([
      {
        prompt_type: 'gesture',
        prompt_level: null,
        correct_trials: 0,
        incorrect_trials: 0,
        no_response_trials: 1,
      },
    ]);
  });

  it('keeps legacy prompt correctness aligned when an earlier target is removed', () => {
    expect(remapLegacyPromptCorrectnessAfterRemoval({
      'legacy:goal-1:0': 'correct',
      'legacy:goal-1:1': 'incorrect',
      'legacy:goal-1:2': 'noResponse',
      configured: 'incorrect',
    }, 'goal-1', 0, 3)).toEqual({
      'legacy:goal-1:0': 'incorrect',
      'legacy:goal-1:1': 'noResponse',
      configured: 'incorrect',
    });
  });

  it('removes prompted aggregates when a legacy decrement crosses the prompt floor', () => {
    expect(decrementLegacyPromptCounts([
      { prompt_type: 'verbal', prompt_level: 'full', correct_trials: 1, incorrect_trials: 0 },
      { prompt_type: 'gesture', prompt_level: null, correct_trials: 2, incorrect_trials: 1 },
    ], 'correct_trials', 2, 'correct')).toEqual([
      { prompt_type: 'verbal', prompt_level: 'full', correct_trials: 1, incorrect_trials: 0 },
      { prompt_type: 'gesture', prompt_level: null, correct_trials: 0, incorrect_trials: 1 },
    ]);
  });

  it('decrements legacy incorrect totals from the selected unsuccessful bucket first', () => {
    expect(decrementLegacyPromptCounts([
      { prompt_type: 'verbal', prompt_level: 'full', correct_trials: 0, incorrect_trials: 1, no_response_trials: 1 },
    ], 'incorrect_trials', 1, 'noResponse')).toEqual([
      { prompt_type: 'verbal', prompt_level: 'full', correct_trials: 0, incorrect_trials: 1 },
    ]);
    expect(decrementLegacyPromptCounts([
      { prompt_type: 'verbal', prompt_level: 'full', correct_trials: 0, incorrect_trials: 1, no_response_trials: 1 },
    ], 'incorrect_trials', 1, 'incorrect')).toEqual([
      { prompt_type: 'verbal', prompt_level: 'full', correct_trials: 0, incorrect_trials: 0, no_response_trials: 1 },
    ]);
  });

  it('treats no-response prompt counts as part of the legacy unsuccessful aggregate floor', () => {
    expect(sumLegacyPromptCounts([
      { prompt_type: 'verbal', prompt_level: 'full', correct_trials: 0, incorrect_trials: 1, no_response_trials: 2 },
    ], 'incorrect_trials')).toBe(3);
  });

  it('formats every progression outcome and incomplete-criteria warning', () => {
    const common = { goal_id: 'goal', target_id: 'target', previous_phase: 'baseline', next_target_id: null, goal_status: 'active', warning: null } as const;
    expect(formatProgressionNotices([
      { ...common, outcome: 'advanced', current_phase: 'teaching' },
      { ...common, outcome: 'target_mastered', current_phase: null, next_target_id: 'next' },
      { ...common, outcome: 'goal_mastered', current_phase: null, goal_status: 'mastered' },
      { ...common, outcome: 'criteria_incomplete', current_phase: 'baseline', warning: 'Configure mastery criteria' },
    ], new Map([['next', 'New target']]))).toEqual([
      'Advanced to Teaching', 'Target mastered · Next: New target', 'Goal mastered', 'Configure mastery criteria',
    ]);
    expect(dedupeProgressionNotices(['Configure mastery criteria'], ['Configure mastery criteria'])).toEqual(['Configure mastery criteria']);
  });

  it('loads billing policy from the caller-scoped database RPC', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith(
      'get_session_capture_strict_billing_gate',
      { target_organization_id: expect.any(String) },
    ));
  });
  const mockPrograms = [
    {
      id: 'program-1',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      name: 'Default Program',
      description: 'Default program for tests',
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'program-2',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      name: 'Second Program',
      description: 'Second program for tests',
      status: 'active',
      created_at: '2024-01-02T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
    },
  ];

  const mockGoals = [
    {
      id: 'goal-1',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      program_id: 'program-1',
      title: 'Default Goal',
      description: 'Default goal for tests',
      original_text: 'Default clinical wording',
      measurement_type: 'frequency',
      target_criteria: 'Match peer greeting in 4/5 trials',
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'goal-2',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      program_id: 'program-2',
      title: 'Second Goal',
      description: 'Second goal for tests',
      original_text: 'Second clinical wording',
      measurement_type: 'frequency',
      status: 'active',
      created_at: '2024-01-02T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
    },
  ];

  it('builds closeout preview rows from aggregate legacy goal measurements when raw trial events are absent', () => {
    const goalTargetsById = new Map<string, GoalTarget>();
    const goalsById = new Map<string, Goal>(mockGoals.map((goal) => [goal.id, goal]));

    expect(buildCloseoutDataPoints({
      existingTrialEvents: [],
      pendingTrialEvents: [],
      goalTargetsById,
      goalsById,
      linkedGoalIds: ['goal-1'],
      goalMeasurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_label: 'Count',
            metric_unit: 'responses',
            target_trials: [
              {
                target: 'Hosted aggregate target',
                metric_value: 2,
                prompt_counts: [
                  { prompt_type: 'gesture', prompt_level: null, correct_trials: 2, incorrect_trials: 0 },
                ],
              },
            ],
          },
        },
        'goal-2': {
          count: 4,
          trials: 5,
          promptLevel: 'Gestural',
        },
        'goal-incorrect-only': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target_trials: [
              {
                target: 'All incorrect target',
                metric_value: null,
                incorrect_trials: 2,
                opportunities: 2,
              },
            ],
          },
        },
        'goal-opportunities-only': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target: 'Opportunity-only target',
            opportunities: 4,
          },
        },
        'goal-note-only': {
          note: 'Narrative only',
        },
        'goal-empty': {},
      },
    })).toEqual([
      {
        label: 'Hosted aggregate target',
        value: 2,
        linked: true,
      },
      {
        label: 'Second Goal',
        value: 4,
        linked: false,
      },
      {
        label: 'All incorrect target',
        value: '2 incorrect',
        linked: false,
      },
      {
        label: 'Opportunity-only target',
        value: '4 opportunities',
        linked: false,
      },
    ]);
  });

  it('keeps an unlabeled later aggregate distinct from target zero', () => {
    const goalTargetsById = new Map<string, GoalTarget>([[
      'target-first-unindexed',
      {
        id: 'target-first-unindexed',
        organization_id: 'org-a',
        client_id: 'test-client-1',
        goal_id: 'goal-1',
        name: 'First target',
        measurement_type: 'frequency',
        graph_config: {},
        sort_order: 0,
        current_phase: 'baseline',
        status: 'active',
        is_current: true,
        evaluation_window_started_at: null,
        progression_version: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]]);
    const existingTrialEvents = [{
      id: 'trial-first-unindexed',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      session_id: 'session-1',
      target_id: 'target-first-unindexed',
      goal_id: 'goal-1',
      therapist_id: 'test-therapist-1',
      trial_number: 1,
      response: 'correct',
      event_timestamp: '2026-03-01T10:15:00.000Z',
      metadata: {},
      created_at: '2026-03-01T10:15:00.000Z',
      updated_at: '2026-03-01T10:15:00.000Z',
    }] satisfies TrialEvent[];

    expect(buildCloseoutDataPoints({
      existingTrialEvents,
      pendingTrialEvents: [],
      goalTargetsById,
      goalsById: new Map(mockGoals.map((goal) => [goal.id, goal])),
      linkedGoalIds: ['goal-1'],
      goalMeasurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            targets: ['First target'],
            target_trials: [
              { target: 'First target', metric_value: 1 },
              { target: null, metric_value: 7 },
            ],
          },
        },
      },
    })).toEqual([
      {
        label: 'First target',
        value: 'correct',
        linked: true,
      },
      {
        label: 'Default Goal',
        value: 7,
        linked: true,
      },
    ]);
  });

  it('retains units and avoids count wording for non-count aggregates', () => {
    const goalsById = new Map<string, Goal>([
      ['goal-duration', { ...mockGoals[0], id: 'goal-duration', title: 'Duration Goal', measurement_type: 'duration' }],
      ['goal-percent', { ...mockGoals[0], id: 'goal-percent', title: 'Percent Goal', measurement_type: 'percentage' }],
      ['goal-rate', { ...mockGoals[0], id: 'goal-rate', title: 'Rate Goal', measurement_type: 'rate' }],
    ]);

    expect(buildCloseoutDataPoints({
      existingTrialEvents: [],
      pendingTrialEvents: [],
      goalTargetsById: new Map(),
      goalsById,
      linkedGoalIds: ['goal-duration', 'goal-percent', 'goal-rate'],
      goalMeasurements: {
        'goal-duration': {
          version: 1,
          data: {
            measurement_type: 'duration',
            metric_label: 'Duration',
            metric_unit: 'minutes',
            target_trials: [{ target: 'Engagement duration', metric_value: 15, incorrect_trials: 2 }],
          },
        },
        'goal-percent': {
          version: 1,
          data: {
            measurement_type: 'percentage',
            metric_label: 'Percent',
            metric_unit: '%',
            target_trials: [
              { target: 'Accuracy', metric_value: 80 },
              { target: 'Zero accuracy', metric_value: 0, incorrect_trials: 2 },
            ],
          },
        },
        'goal-rate': {
          version: 1,
          data: {
            measurement_type: 'rate',
            metric_label: 'Rate',
            metric_unit: 'per hour',
            target_trials: [{ target: 'Requests', metric_value: 3 }],
          },
        },
      },
    })).toEqual([
      {
        label: 'Engagement duration',
        value: '15 minutes / 2 incorrect',
        linked: true,
      },
      {
        label: 'Accuracy',
        value: '80%',
        linked: true,
      },
      {
        label: 'Zero accuracy',
        value: '0% / 2 incorrect',
        linked: true,
      },
      {
        label: 'Requests',
        value: '3 per hour',
        linked: true,
      },
    ]);
  });

  it('preserves persisted measurement metadata when the current goal type has changed', () => {
    const currentGoal = {
      ...mockGoals[0],
      title: 'Goal now measured by percent',
      measurement_type: 'percentage',
    };

    expect(buildCloseoutDataPoints({
      existingTrialEvents: [],
      pendingTrialEvents: [],
      goalTargetsById: new Map(),
      goalsById: new Map([[currentGoal.id, currentGoal]]),
      linkedGoalIds: ['goal-1'],
      goalMeasurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_label: 'Count',
            metric_unit: 'responses',
            target_trials: [{ target: 'Historical count target', metric_value: 2 }],
          },
        },
      },
    })).toEqual([{
      label: 'Historical count target',
      value: 2,
      linked: true,
    }]);
  });

  it('keeps raw closeout trial events one-for-one and skips duplicate aggregate rows for the same goal target', () => {
    const goalTargetsById = new Map<string, GoalTarget>([[
      'target-1',
      {
        id: 'target-1',
        organization_id: 'org-a',
        client_id: 'test-client-1',
        goal_id: 'goal-1',
        name: 'Hosted aggregate target',
        measurement_type: 'frequency',
        graph_config: {},
        sort_order: 0,
        current_phase: 'baseline',
        status: 'active',
        is_current: true,
        evaluation_window_started_at: null,
        progression_version: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]]);
    const goalsById = new Map<string, Goal>(mockGoals.map((goal) => [goal.id, goal]));
    const existingTrialEvents = [{
      id: 'trial-1',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      session_id: 'session-1',
      target_id: 'target-1',
      goal_id: 'goal-1',
      therapist_id: 'test-therapist-1',
      trial_number: 1,
      response: 'correct',
      event_timestamp: '2026-03-01T10:15:00.000Z',
      metadata: {},
      created_at: '2026-03-01T10:15:00.000Z',
      updated_at: '2026-03-01T10:15:00.000Z',
    }] satisfies TrialEvent[];

    expect(buildCloseoutDataPoints({
      existingTrialEvents,
      pendingTrialEvents: [],
      goalTargetsById,
      goalsById,
      linkedGoalIds: ['goal-1'],
      goalMeasurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_label: 'Count',
            metric_unit: 'responses',
            target_trials: [
              {
                target: 'Hosted aggregate target',
                metric_value: 2,
                prompt_counts: [
                  { prompt_type: 'gesture', prompt_level: null, correct_trials: 2, incorrect_trials: 0 },
                ],
              },
            ],
          },
        },
      },
    })).toEqual([
      {
        label: 'Hosted aggregate target',
        value: 'correct',
        linked: true,
      },
    ]);
  });

  it('shows incorrect prompt outcomes when a legacy aggregate has zero correct trials', () => {
    expect(buildCloseoutDataPoints({
      existingTrialEvents: [],
      pendingTrialEvents: [],
      goalTargetsById: new Map(),
      goalsById: new Map(),
      linkedGoalIds: ['goal-prompt-incorrect'],
      goalMeasurements: {
        'goal-prompt-incorrect': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target_trials: [{
              target: 'Prompt outcome target',
              prompt_counts: [{
                prompt_type: 'verbal',
                prompt_level: 'full',
                correct_trials: 0,
                incorrect_trials: 2,
              }],
            }],
          },
        },
      },
    })).toEqual([{
      label: 'Prompt outcome target',
      value: '2 incorrect',
      linked: true,
    }]);
  });

  it('shows both correct and incorrect outcomes for a mixed legacy aggregate', () => {
    expect(buildCloseoutDataPoints({
      existingTrialEvents: [],
      pendingTrialEvents: [],
      goalTargetsById: new Map(),
      goalsById: new Map(),
      linkedGoalIds: ['goal-prompt-mixed'],
      goalMeasurements: {
        'goal-prompt-mixed': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target_trials: [{
              target: 'Mixed prompt outcome target',
              metric_value: 2,
              incorrect_trials: 3,
            }],
          },
        },
      },
    })).toEqual([{
      label: 'Mixed prompt outcome target',
      value: '2 correct / 3 incorrect',
      linked: true,
    }]);
  });

  it('falls back to a top-level aggregate when target rows contain metadata only', () => {
    expect(buildCloseoutDataPoints({
      existingTrialEvents: [],
      pendingTrialEvents: [],
      goalTargetsById: new Map(),
      goalsById: new Map(),
      linkedGoalIds: ['goal-metadata-target'],
      goalMeasurements: {
        'goal-metadata-target': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target: 'Metadata-only target',
            metric_value: 5,
            target_trials: [{
              target: 'Metadata-only target',
              trial_prompt_note: 'Observed with a model prompt',
            }],
          },
        },
      },
    })).toEqual([{
      label: 'Metadata-only target',
      value: 5,
      linked: true,
    }]);
  });

  it('does not duplicate a top-level fallback when an indexed raw trial matches its metadata-only target', () => {
    const existingTrialEvents = [{
      id: 'trial-metadata-target',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      session_id: 'session-1',
      target_id: 'target-metadata',
      goal_id: 'goal-metadata-target',
      therapist_id: 'test-therapist-1',
      trial_number: 1,
      response: 'correct',
      event_timestamp: '2026-03-01T10:15:00.000Z',
      metadata: { target_index: 0 },
      created_at: '2026-03-01T10:15:00.000Z',
      updated_at: '2026-03-01T10:15:00.000Z',
    }] satisfies TrialEvent[];

    expect(buildCloseoutDataPoints({
      existingTrialEvents,
      pendingTrialEvents: [],
      goalTargetsById: new Map(),
      goalsById: new Map(),
      linkedGoalIds: ['goal-metadata-target'],
      goalMeasurements: {
        'goal-metadata-target': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target: 'Metadata-only target',
            metric_value: 5,
            target_trials: [{
              target: 'Metadata-only target',
              trial_prompt_note: 'Observed with a model prompt',
            }],
          },
        },
      },
    })).toEqual([{
      label: 'Metadata-only target',
      value: 'correct',
      linked: true,
    }]);
  });

  it('uses aggregate target metadata to label and deduplicate archived raw targets', () => {
    const existingTrialEvents = [{
      id: 'trial-archived-target',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      session_id: 'session-1',
      target_id: 'target-archived',
      goal_id: 'goal-archived',
      therapist_id: 'test-therapist-1',
      trial_number: 1,
      response: 'correct',
      event_timestamp: '2026-03-01T10:15:00.000Z',
      metadata: { target_index: 0 },
      created_at: '2026-03-01T10:15:00.000Z',
      updated_at: '2026-03-01T10:15:00.000Z',
    }] satisfies TrialEvent[];

    expect(buildCloseoutDataPoints({
      existingTrialEvents,
      pendingTrialEvents: [],
      goalTargetsById: new Map(),
      goalsById: new Map(),
      linkedGoalIds: ['goal-archived'],
      goalMeasurements: {
        'goal-archived': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target_trials: [{
              target: 'Archived target snapshot',
              metric_value: 1,
              opportunities: 1,
            }],
          },
        },
      },
    })).toEqual([{
      label: 'Archived target snapshot',
      value: 'correct',
      linked: true,
    }]);
  });

  it('uses the persisted target index to deduplicate and label a renamed target', () => {
    const goalTargetsById = new Map<string, GoalTarget>([[
      'target-renamed',
      {
        id: 'target-renamed',
        organization_id: 'org-a',
        client_id: 'test-client-1',
        goal_id: 'goal-renamed',
        name: 'Current renamed target',
        measurement_type: 'frequency',
        graph_config: {},
        sort_order: 0,
        current_phase: 'baseline',
        status: 'active',
        is_current: true,
        evaluation_window_started_at: null,
        progression_version: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]]);
    const existingTrialEvents = [{
      id: 'trial-renamed-target',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      session_id: 'session-1',
      target_id: 'target-renamed',
      goal_id: 'goal-renamed',
      therapist_id: 'test-therapist-1',
      trial_number: 1,
      response: 'correct',
      event_timestamp: '2026-03-01T10:15:00.000Z',
      metadata: { target_index: 0 },
      created_at: '2026-03-01T10:15:00.000Z',
      updated_at: '2026-03-01T10:15:00.000Z',
    }] satisfies TrialEvent[];

    expect(buildCloseoutDataPoints({
      existingTrialEvents,
      pendingTrialEvents: [],
      goalTargetsById,
      goalsById: new Map(),
      linkedGoalIds: ['goal-renamed'],
      goalMeasurements: {
        'goal-renamed': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target_trials: [{
              target: 'Finalized target snapshot',
              metric_value: 1,
            }],
          },
        },
      },
    })).toEqual([{
      label: 'Finalized target snapshot',
      value: 'correct',
      linked: true,
    }]);
  });

  it('uses a sole snapshot label for an older unindexed raw target that can no longer be identified', () => {
    const existingTrialEvents = [{
      id: 'trial-renamed-target-no-index',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      session_id: 'session-1',
      target_id: 'target-renamed-no-index',
      goal_id: 'goal-renamed-no-index',
      therapist_id: 'test-therapist-1',
      trial_number: 1,
      response: 'correct',
      event_timestamp: '2026-03-01T10:15:00.000Z',
      metadata: {},
      created_at: '2026-03-01T10:15:00.000Z',
      updated_at: '2026-03-01T10:15:00.000Z',
    }] satisfies TrialEvent[];

    expect(buildCloseoutDataPoints({
      existingTrialEvents,
      pendingTrialEvents: [],
      goalTargetsById: new Map(),
      goalsById: new Map(),
      linkedGoalIds: ['goal-renamed-no-index'],
      goalMeasurements: {
        'goal-renamed-no-index': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target_trials: [{
              target: 'Finalized target snapshot',
              metric_value: 1,
            }],
          },
        },
      },
    })).toEqual([{
      label: 'Finalized target snapshot',
      value: 'correct',
      linked: true,
    }]);
  });

  it('preserves a distinct aggregate when an older unindexed raw target is still identifiable', () => {
    const goalTargetsById = new Map<string, GoalTarget>([[
      'target-known-no-index',
      {
        id: 'target-known-no-index',
        organization_id: 'org-a',
        client_id: 'test-client-1',
        goal_id: 'goal-known-no-index',
        name: 'Known raw target',
        measurement_type: 'frequency',
        graph_config: {},
        sort_order: 0,
        current_phase: 'baseline',
        status: 'active',
        is_current: true,
        evaluation_window_started_at: null,
        progression_version: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]]);
    const existingTrialEvents = [{
      id: 'trial-known-target-no-index',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      session_id: 'session-1',
      target_id: 'target-known-no-index',
      goal_id: 'goal-known-no-index',
      therapist_id: 'test-therapist-1',
      trial_number: 1,
      response: 'correct',
      event_timestamp: '2026-03-01T10:15:00.000Z',
      metadata: {},
      created_at: '2026-03-01T10:15:00.000Z',
      updated_at: '2026-03-01T10:15:00.000Z',
    }] satisfies TrialEvent[];

    expect(buildCloseoutDataPoints({
      existingTrialEvents,
      pendingTrialEvents: [],
      goalTargetsById,
      goalsById: new Map(),
      linkedGoalIds: ['goal-known-no-index'],
      goalMeasurements: {
        'goal-known-no-index': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target_trials: [{
              target: 'Distinct aggregate target',
              metric_value: 2,
            }],
          },
        },
      },
    })).toEqual([
      {
        label: 'Known raw target',
        value: 'correct',
        linked: true,
      },
      {
        label: 'Distinct aggregate target',
        value: 2,
        linked: true,
      },
    ]);
  });

  it('does not suppress a different indexed target that shares the same label', () => {
    const existingTrialEvents = [{
      id: 'trial-duplicate-label-target',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      session_id: 'session-1',
      target_id: 'target-first',
      goal_id: 'goal-duplicate-label',
      therapist_id: 'test-therapist-1',
      trial_number: 1,
      response: 'correct',
      event_timestamp: '2026-03-01T10:15:00.000Z',
      metadata: { target_index: 0 },
      created_at: '2026-03-01T10:15:00.000Z',
      updated_at: '2026-03-01T10:15:00.000Z',
    }] satisfies TrialEvent[];

    expect(buildCloseoutDataPoints({
      existingTrialEvents,
      pendingTrialEvents: [],
      goalTargetsById: new Map(),
      goalsById: new Map(),
      linkedGoalIds: ['goal-duplicate-label'],
      goalMeasurements: {
        'goal-duplicate-label': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target_trials: [
              { target: 'Shared target label', metric_value: 1 },
              { target: 'Shared target label', metric_value: 2 },
            ],
          },
        },
      },
    })).toEqual([
      {
        label: 'Shared target label',
        value: 'correct',
        linked: true,
      },
      {
        label: 'Shared target label',
        value: 2,
        linked: true,
      },
    ]);
  });

  it('preserves sparse aggregate target indexes when labeling archived raw targets', () => {
    const existingTrialEvents = [{
      id: 'trial-archived-unlabeled-target',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      session_id: 'session-1',
      target_id: 'target-archived-unlabeled',
      goal_id: 'goal-archived-sparse',
      therapist_id: 'test-therapist-1',
      trial_number: 1,
      response: 'correct',
      event_timestamp: '2026-03-01T10:15:00.000Z',
      metadata: { target_index: 0 },
      created_at: '2026-03-01T10:15:00.000Z',
      updated_at: '2026-03-01T10:15:00.000Z',
    }] satisfies TrialEvent[];

    expect(buildCloseoutDataPoints({
      existingTrialEvents,
      pendingTrialEvents: [],
      goalTargetsById: new Map(),
      goalsById: new Map(),
      linkedGoalIds: ['goal-archived-sparse'],
      goalMeasurements: {
        'goal-archived-sparse': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target_trials: [
              { trial_prompt_note: 'Unlabeled historical target' },
              {
                target: 'Later labeled target',
                metric_value: 2,
                opportunities: 2,
              },
            ],
          },
        },
      },
    })).toEqual([
      {
        label: 'target-archived-unlabeled',
        value: 'correct',
        linked: true,
      },
      {
        label: 'Later labeled target',
        value: 2,
        linked: true,
      },
    ]);
  });

  it('keeps an unlabeled aggregate row when a raw event only proves a different target for the same goal', () => {
    const goalTargetsById = new Map<string, GoalTarget>([[
      'target-1',
      {
        id: 'target-1',
        organization_id: 'org-a',
        client_id: 'test-client-1',
        goal_id: 'goal-unlabeled',
        name: 'Raw target',
        measurement_type: 'frequency',
        graph_config: {},
        sort_order: 0,
        current_phase: 'baseline',
        status: 'active',
        is_current: true,
        evaluation_window_started_at: null,
        progression_version: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]]);
    const existingTrialEvents = [{
      id: 'trial-unlabeled-goal',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      session_id: 'session-1',
      target_id: 'target-1',
      goal_id: 'goal-unlabeled',
      therapist_id: 'test-therapist-1',
      trial_number: 1,
      response: 'correct',
      event_timestamp: '2026-03-01T10:15:00.000Z',
      metadata: {},
      created_at: '2026-03-01T10:15:00.000Z',
      updated_at: '2026-03-01T10:15:00.000Z',
    }] satisfies TrialEvent[];

    expect(buildCloseoutDataPoints({
      existingTrialEvents,
      pendingTrialEvents: [],
      goalTargetsById,
      goalsById: new Map(),
      linkedGoalIds: ['goal-unlabeled'],
      goalMeasurements: {
        'goal-unlabeled': {
          count: 3,
        },
      },
    })).toEqual([
      {
        label: 'Raw target',
        value: 'correct',
        linked: true,
      },
      {
        label: 'goal-unlabeled',
        value: 3,
        linked: true,
      },
    ]);
  });

  beforeEach(() => {
    vi.mocked(startSessionFromModal).mockReset();
    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue(null);
    toastMocks.showError.mockClear();
    toastMocks.showSuccess.mockClear();
    defaultProps.onClose.mockClear();
    defaultProps.onSubmit.mockClear();
    vi.mocked(getBtAbaSessionNote).mockReset();
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-bt-1',
      templateId: 'template-bt-1',
      responses: null,
      status: 'draft',
    });
    vi.mocked(saveBtAbaSessionNoteDraft).mockReset();
    vi.mocked(saveBtAbaSessionNoteDraft).mockResolvedValue({ status: 'draft', noteId: 'note-bt-1' });
    vi.mocked(finalizeBtAbaSessionNote).mockReset();
    vi.mocked(finalizeBtAbaSessionNote).mockResolvedValue({
      status: 'completed',
      noteId: 'note-bt-1',
      progressionResults: [],
    });
    vi.mocked(supabase.rpc).mockReset();
    vi.mocked(supabase.rpc).mockImplementation(async (fn: string) => {
      if (fn === 'get_session_capture_strict_billing_gate') {
      return { data: false, error: null };
      }
      if (fn === 'resolve_assigned_bt_session_capture_billing') {
        return {
          data: [{ authorization_id: 'auth-1', service_code: '97153', strict_billing: false }],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    const defaultChain = buildChain([]);

    vi.mocked(supabase.from).mockClear();
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      return defaultChain;
    });
  });

  const mockTherapists = [
    {
      id: 'test-therapist-1',
      organization_id: 'org-a',
      email: 'therapist1@example.com',
      full_name: 'Test Therapist 1',
      status: 'active',
      specialties: ['ABA Therapy'],
      service_type: ['In clinic'],
      availability_hours: {
        monday: { start: '09:00', end: '17:00' },
        tuesday: { start: '09:00', end: '17:00' },
      },
    },
  ];

  const mockClients = [
    {
      id: 'test-client-1',
      email: 'client1@example.com',
      full_name: 'Test Client 1',
      date_of_birth: '2020-01-01',
      service_preference: ['In clinic'],
      authorized_hours: 10,
      availability_hours: {
        monday: { start: '09:00', end: '17:00' },
        tuesday: { start: '09:00', end: '17:00' },
      },
    },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    therapists: mockTherapists,
    clients: mockClients,
    existingSessions: [],
    timeZone: "America/New_York",
  };

  const setReducedMotionPreference = (matches: boolean) => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  };

  const expectVisiblePlanSelectorsRemoved = () => {
    expect(screen.queryByRole('combobox', { name: /^Program$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Primary Goal$/i })).not.toBeInTheDocument();
  };

  const getGoalCheckbox = (name: RegExp) =>
    screen.getAllByRole('checkbox', { name })[0] as HTMLInputElement;

  const selectGoalFromLowerControls = async (name: RegExp) => {
    const checkbox = getGoalCheckbox(name);
    if (!checkbox.checked) {
      await userEvent.click(checkbox);
    }
  };
  const expandPlanGoals = async () => {
    const disclosure = await screen.findByRole('button', { name: /plan & goals/i });
    if (disclosure.getAttribute('aria-expanded') === 'false') {
      await userEvent.click(disclosure);
      await waitFor(() => expect(disclosure).toHaveAttribute('aria-expanded', 'true'));
    }
  };
  const expandClinicalDetails = async () => {
    const disclosure = screen.queryByRole('button', { name: /clinical capture and secondary details/i });
    if (disclosure && disclosure.getAttribute('aria-expanded') === 'false') {
      await userEvent.click(disclosure);
      await waitFor(() => expect(disclosure).toHaveAttribute('aria-expanded', 'true'));
    }
  };

  const btInProgressSession = {
    id: 'session-bt-review', therapist_id: 'test-therapist-1', client_id: 'test-client-1',
    program_id: 'program-1', goal_id: 'goal-1', goal_ids: ['goal-1'],
    start_time: '2026-03-01T10:00:00.000Z', end_time: '2026-03-01T11:00:00.000Z',
    status: 'in_progress', notes: '', created_at: '2026-03-01T09:00:00.000Z', created_by: null,
    updated_at: '2026-03-01T09:00:00.000Z', updated_by: null, started_at: '2026-03-01T10:00:00.000Z',
  } satisfies Session;
  const validScheduledSession = {
    ...btInProgressSession,
    id: 'session-plan-summary',
    status: 'scheduled',
    started_at: null,
  } satisfies Session;
  const cancelledScheduledSession = {
    ...validScheduledSession,
    id: 'session-cancelled-reactivation',
    status: 'cancelled',
  } satisfies Session;

  it('renders the modal when open', () => {
    renderWithProviders(<SessionModal {...defaultProps} />);
    expect(screen.getByText(/New Session/)).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-session-modal-mode', 'create');
    expect(dialog).toHaveAttribute('aria-labelledby', 'session-modal-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'session-modal-description');
    expect(screen.queryByRole('region', { name: /Session not saved/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Scheduling Conflicts/i })).not.toBeInTheDocument();
  });

  it('shows validation errors for required fields', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);
    
    const form = document.getElementById('session-form');
    expect(form).toBeInstanceOf(HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByText(/Therapist is required/)).toBeInTheDocument();
      expect(screen.getByText(/Client is required/)).toBeInTheDocument();
      expect(screen.queryByText(/Program is required/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Primary goal is required/)).not.toBeInTheDocument();
    });
  });

  it('creates scheduled sessions without selecting program or goal links', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);

    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: '2025-03-18T10:00' } });
    fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: '2025-03-18T11:00' } });

    await userEvent.click(screen.getByRole('button', { name: /Create Session/i }));

    await waitFor(() => {
      expect(defaultProps.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        therapist_id: 'test-therapist-1',
        client_id: 'test-client-1',
        start_time: '2025-03-18T14:00:00.000Z',
        end_time: '2025-03-18T15:00:00.000Z',
        status: 'scheduled',
      }));
    });
    expect(defaultProps.onSubmit.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      program_id: '',
      goal_id: '',
    }));
  }, 15000);

  it('removes redundant plan comboboxes while keeping lower plan controls', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);

    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await screen.findByRole('button', { name: /Default Program/i });

    expectVisiblePlanSelectorsRemoved();
    expect(screen.getByRole('button', { name: /Default Program/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Default Program/i }));

    await waitFor(() => {
      expect(getGoalCheckbox(/Default Goal/i)).toBeInTheDocument();
    });
  });

  it('preserves primary ids from lower plan controls on submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<SessionModal {...defaultProps} onSubmit={onSubmit} />);

    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await screen.findByRole('button', { name: /Default Program/i });
    await userEvent.click(screen.getByRole('button', { name: /Default Program/i }));
    await selectGoalFromLowerControls(/Default Goal/i);

    fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: '2025-03-18T10:00' } });
    fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: '2025-03-18T11:00' } });

    await userEvent.click(screen.getByRole('button', { name: /Create Session/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        program_id: 'program-1',
        goal_id: 'goal-1',
        goal_ids: expect.arrayContaining(['goal-1']),
      }));
    });
  }, 15000);

  it('lets the lower goal controls replace the automatically selected primary goal', async () => {
    const alternateGoal = {
      ...mockGoals[0],
      id: 'goal-alternate',
      title: 'Alternate Goal',
      created_at: '2024-01-03T00:00:00Z',
      updated_at: '2024-01-03T00:00:00Z',
    };
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') return buildChain(mockPrograms);
      if (table === 'goals') return buildChain([...mockGoals, alternateGoal]);
      return buildChain([]);
    });
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(<SessionModal {...defaultProps} onSubmit={onSubmit} />);

    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await screen.findByRole('button', { name: /Default Program/i });
    await userEvent.click(screen.getByRole('button', { name: /Default Program/i }));
    await selectGoalFromLowerControls(/Alternate Goal/i);
    await userEvent.click(
      screen.getAllByRole('button', { name: /Set Alternate Goal as primary goal/i })[0],
    );

    fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: '2025-03-18T10:00' } });
    fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: '2025-03-18T11:00' } });
    await userEvent.click(screen.getByRole('button', { name: /Create Session/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        program_id: 'program-1',
        goal_id: 'goal-alternate',
        goal_ids: expect.arrayContaining(['goal-1', 'goal-alternate']),
      }));
    });
  }, 15000);

  it('calls onSubmit with form data when valid', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);

    // Fill out the form
    await userEvent.selectOptions(
      screen.getByLabelText(/Therapist/i),
      'test-therapist-1'
    );
    await userEvent.selectOptions(
      screen.getByLabelText(/Client/i),
      'test-client-1'
    );
    await screen.findByRole('button', { name: /Default Program/i });
    await userEvent.click(screen.getByRole('button', { name: /Default Program/i }));
    await selectGoalFromLowerControls(/Default Goal/i);

    // Set start and end times
    const startTime = screen.getByLabelText(/Start Time/i);
    const endTime = screen.getByLabelText(/End Time/i);
    fireEvent.change(startTime, { target: { value: '2025-03-18T10:00' } });
    fireEvent.change(endTime, { target: { value: '2025-03-18T11:00' } });

    // Submit the form (no conflicts path)
    const submitButton = screen.getByRole('button', { name: /Create Session/i });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(defaultProps.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        therapist_id: 'test-therapist-1',
        client_id: 'test-client-1',
        program_id: 'program-1',
        goal_id: 'goal-1',
        start_time: '2025-03-18T14:00:00.000Z',
        end_time: '2025-03-18T15:00:00.000Z',
        status: 'scheduled',
      }));
    });
  }, 15000);

  it('reuses the client-wide goals query when switching programs', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);

    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await screen.findByRole('button', { name: /Default Program/i });
    const goalFetchCountBeforeSwitch = vi.mocked(supabase.from).mock.calls.filter(([table]) => table === 'goals').length;

    await userEvent.click(screen.getByRole('button', { name: /Second Program/i }));
    await waitFor(() => {
      expect(getGoalCheckbox(/Second Goal/i)).toBeInTheDocument();
    });

    const goalFetchCountAfterSwitch = vi.mocked(supabase.from).mock.calls.filter(([table]) => table === 'goals').length;
    expect(goalFetchCountAfterSwitch).toBe(goalFetchCountBeforeSwitch);
  });

  it('keeps previously selected goal names intact when another program is added', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);

    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await screen.findByRole('button', { name: /Default Program/i });
    await userEvent.click(screen.getByRole('button', { name: /Default Program/i }));
    await selectGoalFromLowerControls(/Default Goal/i);

    await userEvent.click(screen.getByRole('button', { name: /Second Program/i }));
    await selectGoalFromLowerControls(/Second Goal/i);

    expect(screen.getAllByText(/Selected goals: Default Goal, Second Goal/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Tracking: Default Program, Second Program/i).length).toBeGreaterThan(0);
  });

  it('shows conflict banner and proceeds after user confirmation', async () => {
    // Existing overlapping session to trigger conflict
    const existingSessions = [{
      id: 'conflict-1',
      therapist_id: 'test-therapist-1',
      client_id: 'test-client-1',
      program_id: 'program-1',
      goal_id: 'goal-1',
      start_time: '2025-03-18T14:15:00.000Z',
      end_time: '2025-03-18T14:45:00.000Z',
      status: 'scheduled',
      notes: 'Existing conflicting session',
      created_at: '2025-03-18T14:00:00.000Z',
      created_by: 'test-user',
      updated_at: '2025-03-18T14:00:00.000Z',
      updated_by: 'test-user',
    }] satisfies Session[];

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        existingSessions={existingSessions}
        retryHint="Pick a different time or refresh the schedule."
      />
    );

    // Fill out the form
    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await screen.findByRole('button', { name: /Default Program/i });
    await userEvent.click(screen.getByRole('button', { name: /Default Program/i }));
    await selectGoalFromLowerControls(/Default Goal/i);
    // Use change events for datetime-local inputs to ensure value is set reliably
    const startInput = screen.getByLabelText(/Start Time/i);
    const endInput = screen.getByLabelText(/End Time/i);
    fireEvent.change(startInput, { target: { value: '2025-03-18T10:00' } });
    fireEvent.change(endInput, { target: { value: '2025-03-18T11:00' } });

    // Conflict banner should render
    await waitFor(() => {
      expect(screen.getByText(/Scheduling Conflicts/i)).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('session-modal-description');
    expect(describedBy).toContain('session-modal-retry-description');
    expect(describedBy).toContain('session-modal-conflicts-description');
    expect(screen.getByRole('region', { name: /Session not saved/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Scheduling Conflicts/i })).toBeInTheDocument();

    // User chooses to proceed
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /Create Session/i }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(defaultProps.onSubmit).toHaveBeenCalled();
    });
  });

  it('wires conflict-only callout into dialog description when retry hint is absent', async () => {
    const existingSessions = [{
      id: 'conflict-only',
      therapist_id: 'test-therapist-1',
      client_id: 'test-client-1',
      program_id: 'program-1',
      goal_id: 'goal-1',
      start_time: '2025-03-18T14:15:00.000Z',
      end_time: '2025-03-18T14:45:00.000Z',
      status: 'scheduled',
      notes: 'Existing conflicting session',
      created_at: '2025-03-18T14:00:00.000Z',
      created_by: 'test-user',
      updated_at: '2025-03-18T14:00:00.000Z',
      updated_by: 'test-user',
    }] satisfies Session[];

    renderWithProviders(<SessionModal {...defaultProps} existingSessions={existingSessions} />);

    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await screen.findByRole('button', { name: /Default Program/i });
    await userEvent.click(screen.getByRole('button', { name: /Default Program/i }));
    await selectGoalFromLowerControls(/Default Goal/i);
    fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: '2025-03-18T10:00' } });
    fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: '2025-03-18T11:00' } });

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /Scheduling Conflicts/i })).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('session-modal-description');
    expect(describedBy).toContain('session-modal-conflicts-description');
    expect(describedBy).not.toContain('session-modal-retry-description');
  });

  it('includes retry hint content in dialog description when retry guidance is shown', () => {
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        retryHint="Pick a different time or refresh the schedule."
      />
    );

    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('session-modal-description');
    expect(describedBy).toContain('session-modal-retry-description');
    expect(screen.getByText(/Session not saved/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Session not saved/i })).toBeInTheDocument();
  });

  it('closes modal when cancel button is clicked', async () => {
    setReducedMotionPreference(true);
    renderWithProviders(<SessionModal {...defaultProps} />);
    
    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    await userEvent.click(cancelButton);

    expect(defaultProps.onClose).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('makes the modal inert during a 160 ms exit and defers onClose until the scheduled callback runs', async () => {
    setReducedMotionPreference(false);
    const onClose = vi.fn();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((
      _handler: TimerHandler,
      _timeout?: number,
      ..._args: unknown[]
    ) => 1) as typeof window.setTimeout);

    renderWithProviders(<SessionModal {...defaultProps} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /close session modal/i }));
    });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-transition-state', 'closing');
    expect(dialog.closest('[role="presentation"]')).toHaveAttribute('inert');
    const closeTimerCalls = setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 160);
    expect(closeTimerCalls).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('closes immediately when reduced motion is preferred', async () => {
    setReducedMotionPreference(true);
    const onClose = vi.fn();

    renderWithProviders(<SessionModal {...defaultProps} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /close session modal/i }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('schedules the close callback exactly once during the exit transition even after duplicate close input', async () => {
    setReducedMotionPreference(false);
    const onClose = vi.fn();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((
      _handler: TimerHandler,
      _timeout?: number,
      ..._args: unknown[]
    ) => 1) as typeof window.setTimeout);

    renderWithProviders(<SessionModal {...defaultProps} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /close session modal/i }));
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.keyDown(document, { key: 'Tab' });
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    });

    expect(screen.getByRole('dialog')).toHaveAttribute('data-transition-state', 'closing');
    const closeTimerCalls = setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 160);
    expect(closeTimerCalls).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('keeps focus stable during the inert close window, ignores duplicate close input, and restores the opener only after unmount', async () => {
    setReducedMotionPreference(false);
    const opener = document.createElement('button');
    opener.textContent = 'Outside opener';
    document.body.appendChild(opener);
    opener.focus();

    const onClose = vi.fn();
    const handleClose = () => {
      onClose();
      rendered.rerender(
        <SessionModal
          {...defaultProps}
          isOpen={false}
          onClose={handleClose}
        />
      );
    };

    const rendered = renderWithProviders(
      <SessionModal
        {...defaultProps}
        onClose={handleClose}
      />
    );

    const closeButton = screen.getByRole('button', { name: /close session modal/i }) as HTMLButtonElement;
    expect(closeButton).toHaveFocus();

    const openerFocusSpy = vi.spyOn(opener, 'focus');
    const closeButtonFocusSpy = vi.spyOn(closeButton, 'focus');
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((
      _handler: TimerHandler,
      _timeout?: number,
      ..._args: unknown[]
    ) => 1) as typeof window.setTimeout);
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout').mockImplementation(((_id?: number) => {}) as typeof window.clearTimeout);
    await act(async () => {
      fireEvent.click(closeButton);
    });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-transition-state', 'closing');
    expect(dialog.closest('[role="presentation"]')).toHaveAttribute('inert');
    const closeTimerCalls = setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 160);
    expect(closeTimerCalls).toHaveLength(1);
    expect(openerFocusSpy).not.toHaveBeenCalled();
    expect(closeButtonFocusSpy).not.toHaveBeenCalled();
    expect(opener).not.toHaveFocus();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.keyDown(document, { key: 'Tab' });
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(openerFocusSpy).not.toHaveBeenCalled();
    expect(closeButtonFocusSpy).not.toHaveBeenCalled();
    expect(opener).not.toHaveFocus();

    await act(async () => {
      const closeCallback = closeTimerCalls[0]?.[0];
      expect(closeCallback).toBeTypeOf('function');
      (closeCallback as () => void)();
    });

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });
    expect(openerFocusSpy).toHaveBeenCalledTimes(1);
    expect(closeButtonFocusSpy).not.toHaveBeenCalled();

    openerFocusSpy.mockRestore();
    closeButtonFocusSpy.mockRestore();
    opener.remove();
    vi.unstubAllGlobals();
  });

  it('shows unsaved state and asks before closing dirty changes', async () => {
    setReducedMotionPreference(true);
    const onClose = vi.fn();
    renderWithProviders(<SessionModal {...defaultProps} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/Schedule Notes/i), {
      target: { value: 'Therapist working note' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('session-modal-save-state')).toHaveTextContent('Unsaved changes.');
    });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const closeCountBeforeCancel = onClose.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalledTimes(closeCountBeforeCancel);

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await waitFor(() => expect(onClose.mock.calls.length).toBeGreaterThan(closeCountBeforeCancel));
    confirmSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('uses an accessible close button label and closes on Escape', async () => {
    setReducedMotionPreference(true);
    renderWithProviders(<SessionModal {...defaultProps} />);

    const closeButton = screen.getByRole('button', { name: /close session modal/i });
    expect(closeButton).toBeInTheDocument();
    expect(closeButton).toHaveAttribute('title', 'Close session modal');
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('traps focus within the modal when tabbing', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);

    const closeButton = screen.getByRole('button', { name: /close session modal/i });
    const createButton = screen.getByRole('button', { name: /create session/i });

    closeButton.focus();
    expect(closeButton).toHaveFocus();

    createButton.focus();
    expect(createButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
  });

  it('restores prior focus when modal closes', async () => {
    const outsideButton = document.createElement('button');
    outsideButton.textContent = 'Outside button';
    document.body.appendChild(outsideButton);
    outsideButton.focus();

    const { rerender } = renderWithProviders(
      <SessionModal {...defaultProps} isOpen />
    );

    rerender(<SessionModal {...defaultProps} isOpen={false} />);

    await waitFor(() => {
      expect(outsideButton).toHaveFocus();
    });

    outsideButton.remove();
  });

  it('hides start session when authoritative details already show started_at', async () => {
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'sessions') {
        return buildChain([], {
          program_id: 'program-1',
          goal_id: 'goal-1',
          started_at: '2026-01-01T10:00:00.000Z',
        });
      }
      if (table === 'session_goals') {
        return buildChain([{ goal_id: 'goal-1' }]);
      }
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        session={{
          id: 'session-started',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-01-01T10:00:00.000Z',
          end_time: '2026-01-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-01-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-01-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Start Session/i })).not.toBeInTheDocument();
    });
    expect(screen.getByText('Live session')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('data-session-modal-mode', 'live');
    expect(screen.getByTestId('session-modal-in-progress-guidance')).toBeInTheDocument();
    expect(screen.getByTestId('session-modal-notes-guidance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save progress/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Close Session$/i })).toBeInTheDocument();
    expect(screen.getByTestId('session-modal-capture-save-row')).toBeInTheDocument();
    expect(screen.getByTestId('session-modal-save-capture-skills')).toBeInTheDocument();
    expect(screen.getByTestId('session-modal-save-capture-behaviors')).toBeInTheDocument();
  });

  it('keeps update-session submit copy when edit session has not started', () => {
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        session={{
          id: 'session-edit-copy',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    expect(screen.getByRole('button', { name: /Update Session/i })).toBeInTheDocument();
    expect(screen.queryByTestId('session-modal-in-progress-guidance')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Close Session$/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-modal-capture-save-row')).not.toBeInTheDocument();
  });

  it('does not show in-progress guidance for completed sessions with started_at', async () => {
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'sessions') {
        return buildChain([], {
          program_id: 'program-1',
          goal_id: 'goal-1',
          started_at: '2026-01-01T10:00:00.000Z',
        });
      }
      if (table === 'session_goals') {
        return buildChain([{ goal_id: 'goal-1' }]);
      }
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        session={{
          id: 'session-completed',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-01-01T10:00:00.000Z',
          end_time: '2026-01-01T11:00:00.000Z',
          status: 'completed',
          notes: '',
          created_at: '2026-01-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-01-01T09:00:00.000Z',
          updated_by: null,
          started_at: '2026-01-01T10:00:00.000Z',
        } satisfies Session}
      />
    );

    await waitFor(() => {
      expect(screen.queryByTestId('session-modal-in-progress-guidance')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Update Session/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Close Session$/i })).not.toBeInTheDocument();
  });

  it('falls back to the primary session goal for live capture when session_goals are missing', async () => {
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'sessions') {
        return buildChain([], {
          program_id: 'program-1',
          goal_id: 'goal-1',
          started_at: '2026-03-01T10:00:00.000Z',
        });
      }
      if (table === 'session_goals') {
        return buildChain([]);
      }
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        session={{
          id: 'session-missing-session-goals',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    expect(await screen.findByLabelText(/^Per-goal note$/i)).toBeInTheDocument();
  });

  it('submits completed status when Close Session is clicked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        existingSessions={[]}
        session={{
          id: 'session-close-action',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: '2026-03-01T10:00:00.000Z',
        } satisfies Session}
      />
    );

    const closeSessionButton = screen.getByRole('button', { name: /^Close Session$/i });
    await waitFor(() => expect(closeSessionButton).not.toBeDisabled());
    await userEvent.click(closeSessionButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        status: 'completed',
      }));
    });
    confirmSpy.mockRestore();
  });

  it('saves BT capture before opening closeout without submitting completed status', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        dataCollectionOnly
        session={{
          id: 'session-bt-close',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          goal_ids: ['goal-1'],
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: '2026-03-01T10:00:00.000Z',
        } satisfies Session}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: /^Close Session$/i }));

    expect(await screen.findByRole('heading', { name: 'ABA Session Note' })).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'in_progress' }));
    expect(onSubmit).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  it('restores a persisted BT draft and finalizes atomically before reporting completion', async () => {
    const persistedGoalMeasurements = {
      'goal-1': {
        version: 1,
        data: {
          measurement_type: 'frequency',
          metric_label: 'Count',
          metric_unit: 'responses',
          targets: ['Match peer greeting in 4/5 trials', 'Retired target'],
          target_trials: [
            {
              target: 'Match peer greeting in 4/5 trials',
              metric_value: 2,
            },
            {
              target: 'Retired target',
              metric_value: 9,
            },
          ],
        },
      },
    };
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-restored',
      templateId: 'template-restored',
      responses: validBtAbaResponses as unknown as Record<string, unknown>,
      status: 'draft',
    });
    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'note-restored',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: ['Default Goal'],
      goal_ids: ['goal-1'],
      goal_measurements: persistedGoalMeasurements,
      goal_notes: {},
      session_id: 'session-bt-restored',
      narrative: '',
      is_locked: false,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: null,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T10:30:00.000Z',
    });
    vi.mocked(finalizeBtAbaSessionNote)
      .mockRejectedValueOnce(new Error('Atomic finalization failed'))
      .mockResolvedValue({ status: 'completed', noteId: 'note-restored', progressionResults: [] });
    vi.mocked(saveBtAbaSessionNoteDraft).mockResolvedValue({ status: 'draft', noteId: 'note-restored' });
    const onBtAbaSessionFinalized = vi.fn().mockResolvedValue(undefined);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        onBtAbaSessionFinalized={onBtAbaSessionFinalized}
        dataCollectionOnly
        session={{
          id: 'session-bt-restored', therapist_id: 'test-therapist-1', client_id: 'test-client-1',
          program_id: 'program-1', goal_id: 'goal-1', goal_ids: ['goal-1'],
          start_time: '2026-03-01T10:00:00.000Z', end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress', notes: '', created_at: '2026-03-01T09:00:00.000Z', created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z', updated_by: null, started_at: '2026-03-01T10:00:00.000Z',
        } satisfies Session}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'ABA Session Note' })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText('Draft client status: Engaged')).toBeInTheDocument();
    expect(await screen.findByText('Linked count: 1')).toBeInTheDocument();
    expect(screen.getByText('All count: 1')).toBeInTheDocument();
    expect(screen.getByText('Match peer greeting in 4/5 trials: 2')).toBeInTheDocument();
    expect(screen.queryByText(/Retired target/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save ABA Draft' }));
    await waitFor(() => expect(saveBtAbaSessionNoteDraft).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-bt-restored',
      templateId: 'template-restored',
      notePayload: expect.objectContaining({ goal_measurements: persistedGoalMeasurements }),
      responses: validBtAbaResponses,
    })));

    await userEvent.click(screen.getByRole('button', { name: 'Finalize ABA Session' }));
    await waitFor(() => expect(finalizeBtAbaSessionNote).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-bt-restored',
      noteId: 'note-restored',
      notePayload: expect.objectContaining({ goal_measurements: persistedGoalMeasurements }),
      responses: validBtAbaResponses,
      trialEvents: expect.any(Array), expectedTargetVersions: expect.any(Array),
    })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Atomic finalization failed');
    expect(screen.getByRole('heading', { name: 'ABA Session Note' })).toBeInTheDocument();
    expect(onBtAbaSessionFinalized).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Finalize ABA Session' }));
    await waitFor(() => expect(onBtAbaSessionFinalized).toHaveBeenCalledTimes(1));
    expect(onBtAbaSessionFinalized).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-bt-restored', noteId: 'note-restored', status: 'completed',
    }));
  });

  it('persists a BT draft before direct finalize when the read state has a generic note id and fallback template', async () => {
    // The read RPC supplies the active template fallback even when the generic row has no persisted template binding.
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: '36d9-generic-note',
      templateId: 'template-direct-finalize',
      responses: null,
      status: null,
    });
    vi.mocked(saveBtAbaSessionNoteDraft).mockResolvedValue({
      status: 'draft',
      noteId: 'note-direct-finalize',
    });
    vi.mocked(finalizeBtAbaSessionNote).mockResolvedValue({
      status: 'completed',
      noteId: 'note-direct-finalize',
      progressionResults: [],
    });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onBtAbaSessionFinalized = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        onBtAbaSessionFinalized={onBtAbaSessionFinalized}
        session={btInProgressSession}
        dataCollectionOnly
      />,
    );

    const closeSessionButton = await screen.findByRole('button', { name: /^Close Session$/i });
    await waitFor(() => expect(closeSessionButton).not.toBeDisabled());
    await userEvent.click(closeSessionButton);

    expect(await screen.findByRole('heading', { name: 'ABA Session Note' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Finalize ABA Session' }));

    await waitFor(() => expect(saveBtAbaSessionNoteDraft).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: btInProgressSession.id,
      templateId: 'template-direct-finalize',
      responses: validBtAbaResponses,
    })));
    await waitFor(() => expect(finalizeBtAbaSessionNote).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: btInProgressSession.id,
      noteId: 'note-direct-finalize',
      responses: validBtAbaResponses,
    })));
    expect(finalizeBtAbaSessionNote).not.toHaveBeenCalledWith(expect.objectContaining({
      noteId: '36d9-generic-note',
    }));
    expect(saveBtAbaSessionNoteDraft.mock.invocationCallOrder[0]).toBeLessThan(
      finalizeBtAbaSessionNote.mock.invocationCallOrder[0],
    );
    await waitFor(() => expect(onBtAbaSessionFinalized).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: btInProgressSession.id,
      noteId: 'note-direct-finalize',
      status: 'completed',
    })));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'in_progress' }));
    expect(toastMocks.showSuccess).not.toHaveBeenCalledWith('ABA session note draft saved');
  });

  it('surfaces BT draft preparation failure and skips direct finalize', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: null,
      templateId: 'template-direct-finalize',
      responses: null,
      status: null,
    });
    vi.mocked(saveBtAbaSessionNoteDraft).mockRejectedValue(new Error('Draft preparation failed'));

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        session={btInProgressSession}
        dataCollectionOnly
      />,
    );

    const closeSessionButton = await screen.findByRole('button', { name: /^Close Session$/i });
    await waitFor(() => expect(closeSessionButton).not.toBeDisabled());
    await userEvent.click(closeSessionButton);

    expect(await screen.findByRole('heading', { name: 'ABA Session Note' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Finalize ABA Session' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Draft preparation failed');
    expect(saveBtAbaSessionNoteDraft).toHaveBeenCalledTimes(1);
    expect(finalizeBtAbaSessionNote).not.toHaveBeenCalled();
    expect(toastMocks.showError).toHaveBeenCalledWith('Draft preparation failed');
  });

  it('updates the completed ABA-note cache after successful finalization', async () => {
    const setQueryData = vi.spyOn(QueryClient.prototype, 'setQueryData');
    const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-cache-refresh',
      templateId: 'template-bt-1',
      responses: validBtAbaResponses as unknown as Record<string, unknown>,
      status: 'draft',
    });
    vi.mocked(finalizeBtAbaSessionNote).mockResolvedValue({
      status: 'completed',
      noteId: 'note-cache-refresh',
      progressionResults: [],
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        dataCollectionOnly
        session={btInProgressSession}
        onBtAbaSessionFinalized={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Finalize ABA Session' }));
    await waitFor(() => expect(setQueryData).toHaveBeenCalledWith(
      ['bt-aba-session-note', btInProgressSession.id],
      expect.objectContaining({
        noteId: 'note-cache-refresh',
        templateId: 'template-bt-1',
        responses: validBtAbaResponses,
        status: 'completed',
      }),
    ));
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['bt-aba-session-note', btInProgressSession.id],
    });
    setQueryData.mockRestore();
    invalidateQueries.mockRestore();
  });

  it('renders a persisted completed BT ABA note as finalized instead of the generic session form', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-completed-readonly',
      templateId: 'template-bt-1',
      responses: validBtAbaResponses as unknown as Record<string, unknown>,
      status: 'completed',
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        dataCollectionOnly
        session={{ ...btInProgressSession, id: 'session-bt-completed', status: 'completed' }}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'ABA Session Note' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Completed ABA Session Note' })).toBeInTheDocument();
    expect(screen.getByText('Review the finalized session documentation.')).toBeInTheDocument();
    expect(screen.getByText('Draft client status: Engaged')).toBeInTheDocument();
    expect(screen.getByText('Mode: finalized')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save ABA Draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finalize ABA Session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to capture' })).not.toBeInTheDocument();
    expect(getBtAbaSessionNote).toHaveBeenCalledWith('session-bt-completed');
  });

  it('fails closed instead of showing the generic editor when completed ABA note data is unavailable', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-incomplete-state',
      templateId: 'template-bt-1',
      responses: validBtAbaResponses as unknown as Record<string, unknown>,
      status: 'draft',
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        dataCollectionOnly
        session={{ ...btInProgressSession, id: 'session-bt-completed-inconsistent', status: 'completed' }}
      />,
    );

    expect(await screen.findByText('Finalized ABA session note is unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ABA Session Note' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update Session' })).not.toBeInTheDocument();
  });

  it('fails closed when completed ABA responses do not satisfy the finalized schema', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-invalid-completed-responses',
      templateId: 'template-bt-1',
      responses: {},
      status: 'completed',
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        dataCollectionOnly
        session={{ ...btInProgressSession, id: 'session-bt-completed-invalid', status: 'completed' }}
      />,
    );

    expect(await screen.findByText('Finalized ABA session note is unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ABA Session Note' })).not.toBeInTheDocument();
  });

  it('renders completed goal labels from the finalized note snapshot', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-completed-snapshot-goals',
      templateId: 'template-bt-1',
      responses: validBtAbaResponses as unknown as Record<string, unknown>,
      status: 'completed',
    });
    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'note-completed-snapshot-goals',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: [' Finalized Archived Goal ', '   '],
      goal_ids: ['goal-1'],
      goal_measurements: {},
      goal_notes: {},
      session_id: 'session-bt-completed-snapshot',
      narrative: 'Finalized note snapshot',
      is_locked: true,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: '2026-03-01T11:00:00.000Z',
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T11:00:00.000Z',
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        dataCollectionOnly
        session={{ ...btInProgressSession, id: 'session-bt-completed-snapshot', status: 'completed' }}
      />,
    );

    expect(await screen.findByText('Goals: Finalized Archived Goal')).toBeInTheDocument();
    expect(screen.queryByText('Goals: Default Goal')).not.toBeInTheDocument();
  });

  it('renders aggregate-only measurements when a completed BT session is reopened', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-completed-aggregate',
      templateId: 'template-bt-1',
      responses: validBtAbaResponses as unknown as Record<string, unknown>,
      status: 'completed',
    });
    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'note-completed-aggregate',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: ['Default Goal'],
      goal_ids: ['goal-1'],
      goal_measurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target: 'Finalized retired target',
            targets: ['Finalized retired target'],
            metric_value: 2,
            opportunities: 2,
          },
        },
      },
      goal_notes: {},
      session_id: 'session-bt-completed-aggregate',
      narrative: 'Completed aggregate note',
      is_locked: true,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: '2026-03-01T11:00:00.000Z',
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T11:00:00.000Z',
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        dataCollectionOnly
        session={{ ...btInProgressSession, id: 'session-bt-completed-aggregate', status: 'completed' }}
      />,
    );

    expect(await screen.findByText('Mode: finalized')).toBeInTheDocument();
    expect(await screen.findByText('Linked count: 1')).toBeInTheDocument();
    expect(screen.getByText('All count: 1')).toBeInTheDocument();
    expect(screen.getByText('Finalized retired target: 2')).toBeInTheDocument();
  });

  it('links completed legacy measurements by goal key when the finalized goal_ids column is null', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-completed-aggregate-null-goal-ids',
      templateId: 'template-bt-1',
      responses: validBtAbaResponses as unknown as Record<string, unknown>,
      status: 'completed',
    });
    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'note-completed-aggregate-null-goal-ids',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: null,
      goal_ids: null,
      goal_measurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            target: 'Legacy linked target',
            targets: ['Legacy linked target'],
            metric_value: 2,
            opportunities: 2,
          },
        },
      },
      goal_notes: {},
      session_id: 'session-bt-completed-aggregate-null-goal-ids',
      narrative: 'Completed legacy aggregate note',
      is_locked: true,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: '2026-03-01T11:00:00.000Z',
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T11:00:00.000Z',
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        dataCollectionOnly
        session={{
          ...btInProgressSession,
          id: 'session-bt-completed-aggregate-null-goal-ids',
          status: 'completed',
        }}
      />,
    );

    expect(await screen.findByText('Mode: finalized')).toBeInTheDocument();
    expect(await screen.findByText('Linked count: 1')).toBeInTheDocument();
    expect(screen.getByText('All count: 1')).toBeInTheDocument();
    expect(screen.getByText('Legacy linked target: 2')).toBeInTheDocument();
  });

  it('recovers a sole finalized label when a completed legacy note has no goal_ids', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-completed-aggregate-inferred-label',
      templateId: 'template-bt-1',
      responses: validBtAbaResponses as unknown as Record<string, unknown>,
      status: 'completed',
    });
    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'note-completed-aggregate-inferred-label',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: ['Archived Snapshot Goal'],
      goal_ids: null,
      goal_measurements: {
        'goal-archived-inferred': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_value: 3,
            opportunities: 3,
          },
        },
      },
      goal_notes: {},
      session_id: 'session-bt-completed-aggregate-inferred-label',
      narrative: 'Completed legacy aggregate note',
      is_locked: true,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: '2026-03-01T11:00:00.000Z',
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T11:00:00.000Z',
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        dataCollectionOnly
        session={{
          ...btInProgressSession,
          id: 'session-bt-completed-aggregate-inferred-label',
          status: 'completed',
        }}
      />,
    );

    expect(await screen.findByText('Mode: finalized')).toBeInTheDocument();
    expect(await screen.findByText('Linked count: 1')).toBeInTheDocument();
    expect(screen.getByText('Archived Snapshot Goal: 3')).toBeInTheDocument();
    expect(screen.queryByText('goal-archived-inferred: 3')).not.toBeInTheDocument();
  });

  it('does not guess finalized label mappings when legacy measurement keys are ambiguous', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-completed-aggregate-ambiguous-label',
      templateId: 'template-bt-1',
      responses: validBtAbaResponses as unknown as Record<string, unknown>,
      status: 'completed',
    });
    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'note-completed-aggregate-ambiguous-label',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: ['Ambiguous Snapshot Goal'],
      goal_ids: null,
      goal_measurements: {
        'goal-ambiguous-a': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_value: 1,
          },
        },
        'goal-ambiguous-b': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_value: 2,
          },
        },
      },
      goal_notes: {},
      session_id: 'session-bt-completed-aggregate-ambiguous-label',
      narrative: 'Completed ambiguous legacy aggregate note',
      is_locked: true,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: '2026-03-01T11:00:00.000Z',
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T11:00:00.000Z',
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        dataCollectionOnly
        session={{
          ...btInProgressSession,
          id: 'session-bt-completed-aggregate-ambiguous-label',
          status: 'completed',
        }}
      />,
    );

    expect(await screen.findByText('Mode: finalized')).toBeInTheDocument();
    expect(await screen.findByText('Linked count: 2')).toBeInTheDocument();
    expect(screen.getByText('goal-ambiguous-a: 1')).toBeInTheDocument();
    expect(screen.getByText('goal-ambiguous-b: 2')).toBeInTheDocument();
  });

  it('uses finalized snapshot labels for targetless measurements from archived goals', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-completed-archived-aggregate',
      templateId: 'template-bt-1',
      responses: validBtAbaResponses as unknown as Record<string, unknown>,
      status: 'completed',
    });
    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'note-completed-archived-aggregate',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: ['Archived Snapshot Goal'],
      goal_ids: ['goal-archived'],
      goal_measurements: {
        'goal-archived': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_value: 3,
            opportunities: 3,
          },
        },
      },
      goal_notes: {},
      session_id: 'session-bt-completed-archived-aggregate',
      narrative: 'Completed archived aggregate note',
      is_locked: true,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: '2026-03-01T11:00:00.000Z',
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T11:00:00.000Z',
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        dataCollectionOnly
        session={{
          ...btInProgressSession,
          id: 'session-bt-completed-archived-aggregate',
          status: 'completed',
        }}
      />,
    );

    expect(await screen.findByText('Mode: finalized')).toBeInTheDocument();
    expect(await screen.findByText('Linked count: 1')).toBeInTheDocument();
    expect(screen.getByText('Archived Snapshot Goal: 3')).toBeInTheDocument();
    expect(screen.queryByText('goal-archived: 3')).not.toBeInTheDocument();
  });

  it('surfaces persisted BT draft loading failure before closeout can advance', async () => {
    vi.mocked(getBtAbaSessionNote).mockRejectedValue(new Error('Draft lookup failed'));
    renderWithProviders(<SessionModal {...defaultProps} session={btInProgressSession} dataCollectionOnly />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Draft lookup failed');
    expect(screen.queryByRole('heading', { name: 'ABA Session Note' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Close Session$/i })).toBeDisabled();
  });

  it('keeps capture open when the closeout note refetch is forbidden', async () => {
    vi.mocked(getBtAbaSessionNote)
      .mockResolvedValueOnce({
        noteId: null,
        templateId: 'template-bt-1',
        responses: null,
        status: null,
      })
      .mockRejectedValueOnce(new Error('Forbidden'));
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={btInProgressSession}
        dataCollectionOnly
      />,
    );

    const closeSessionButton = await screen.findByRole('button', { name: /^Close Session$/i });
    await waitFor(() => expect(closeSessionButton).not.toBeDisabled());
    await userEvent.click(closeSessionButton);

    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(screen.queryByRole('heading', { name: 'ABA Session Note' })).not.toBeInTheDocument();
    expect(toastMocks.showError).toHaveBeenCalledWith('Forbidden');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'in_progress' }));
  });

  it('keeps capture open when the closeout note refetch has no template', async () => {
    vi.mocked(getBtAbaSessionNote)
      .mockResolvedValueOnce({
        noteId: null,
        templateId: 'template-bt-1',
        responses: null,
        status: null,
      })
      .mockResolvedValueOnce({
        noteId: null,
        templateId: null,
        responses: null,
        status: null,
      });
    renderWithProviders(
      <SessionModal {...defaultProps} session={btInProgressSession} dataCollectionOnly />,
    );

    const closeSessionButton = await screen.findByRole('button', { name: /^Close Session$/i });
    await waitFor(() => expect(closeSessionButton).not.toBeDisabled());
    await userEvent.click(closeSessionButton);

    expect(screen.queryByRole('heading', { name: 'ABA Session Note' })).not.toBeInTheDocument();
    expect(toastMocks.showError).toHaveBeenCalledWith('Unable to load the saved ABA session note draft.');
  });

  it('does not restore a persisted BT draft without its template', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-without-template',
      templateId: null,
      responses: validBtAbaResponses as unknown as Record<string, unknown>,
      status: 'draft',
    });
    renderWithProviders(
      <SessionModal {...defaultProps} session={btInProgressSession} dataCollectionOnly />,
    );

    await waitFor(() => expect(getBtAbaSessionNote).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'ABA Session Note' })).not.toBeInTheDocument();
  });

  it('does not reinterpret completed RPC success as finalization failure when refresh callback rejects', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-completed', templateId: 'template-bt-1', responses: validBtAbaResponses as unknown as Record<string, unknown>, status: 'draft',
    });
    vi.mocked(finalizeBtAbaSessionNote).mockResolvedValue({ status: 'completed', noteId: 'note-completed', progressionResults: [] });
    const onClose = vi.fn();
    const onBtAbaSessionFinalized = vi.fn().mockRejectedValue(new Error('Refresh failed'));
    renderWithProviders(
      <SessionModal {...defaultProps} onClose={onClose} session={btInProgressSession} dataCollectionOnly onBtAbaSessionFinalized={onBtAbaSessionFinalized} />,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Finalize ABA Session' }));
    await waitFor(() => expect(finalizeBtAbaSessionNote).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastMocks.showError).toHaveBeenCalledWith(expect.stringMatching(/completed.*refresh/i));
    expect(toastMocks.showError).not.toHaveBeenCalledWith('Refresh failed');
  });

  it('guards rapid duplicate finalization with one RPC and one completion callback', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-once', templateId: 'template-bt-1', responses: validBtAbaResponses as unknown as Record<string, unknown>, status: 'draft',
    });
    let resolveDraft!: (value: Awaited<ReturnType<typeof saveBtAbaSessionNoteDraft>>) => void;
    vi.mocked(saveBtAbaSessionNoteDraft).mockImplementation(() => new Promise((resolve) => { resolveDraft = resolve; }));
    let resolveFinalize!: (value: Awaited<ReturnType<typeof finalizeBtAbaSessionNote>>) => void;
    vi.mocked(finalizeBtAbaSessionNote).mockImplementation(() => new Promise((resolve) => { resolveFinalize = resolve; }));
    const onBtAbaSessionFinalized = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SessionModal {...defaultProps} session={btInProgressSession} dataCollectionOnly onBtAbaSessionFinalized={onBtAbaSessionFinalized} />,
    );

    const finalizeButton = await screen.findByRole('button', { name: 'Finalize ABA Session' });
    fireEvent.click(finalizeButton);
    fireEvent.click(finalizeButton);
    expect(saveBtAbaSessionNoteDraft).toHaveBeenCalledTimes(1);
    expect(finalizeBtAbaSessionNote).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close session modal' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onClose).not.toHaveBeenCalled();

    resolveDraft({ status: 'draft', noteId: 'note-once' });
    await waitFor(() => expect(finalizeBtAbaSessionNote).toHaveBeenCalledTimes(1));
    resolveFinalize({ status: 'completed', noteId: 'note-once', progressionResults: [] });
    await waitFor(() => expect(onBtAbaSessionFinalized).toHaveBeenCalledTimes(1));
  });

  it('uses canonical billing context and distinguishes linked from all trial events', async () => {
    vi.mocked(getBtAbaSessionNote).mockResolvedValue({
      noteId: 'note-context', templateId: 'template-bt-1', responses: validBtAbaResponses as unknown as Record<string, unknown>, status: 'draft',
    });
    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'note-context', date: '2026-03-01', start_time: '10:00:00', end_time: '11:00:00',
      service_code: '97153', therapist_name: 'Test Therapist', goals_addressed: ['Default Goal'], goal_ids: ['goal-1'],
      narrative: '', is_locked: false, client_id: 'test-client-1', authorization_id: 'auth-1',
    });
    const trialRows = [
      { id: 'trial-linked', organization_id: 'org-a', client_id: 'test-client-1', session_id: btInProgressSession.id, target_id: 'target-1', goal_id: 'goal-1', therapist_id: 'test-therapist-1', trial_number: 1, response: 'correct', event_timestamp: '', metadata: {}, created_at: '', updated_at: '' },
      { id: 'trial-unlinked', organization_id: 'org-a', client_id: 'test-client-1', session_id: btInProgressSession.id, target_id: 'target-2', goal_id: 'goal-other', therapist_id: 'test-therapist-1', trial_number: 2, response: 'incorrect', event_timestamp: '', metadata: {}, created_at: '', updated_at: '' },
    ];
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain), eq: vi.fn(() => chain), neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })), maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: rows, error: null })),
      };
      return chain;
    };
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') return buildChain(mockPrograms);
      if (table === 'goals') return buildChain(mockGoals);
      if (table === 'trial_events') return buildChain(trialRows);
      if (table === 'sessions') return buildChain([], { program_id: 'program-1', goal_id: 'goal-1', started_at: btInProgressSession.started_at, location_type: null });
      return buildChain([]);
    });

    renderWithProviders(<SessionModal {...defaultProps} session={btInProgressSession} dataCollectionOnly />);
    expect(await screen.findByText('Place: Not recorded')).toBeInTheDocument();
    expect(screen.getByText('Billing: 97153')).toBeInTheDocument();
    expect(screen.getByText('Modifiers: Not recorded')).toBeInTheDocument();
    expect(screen.getByText('Linked count: 1')).toBeInTheDocument();
    expect(screen.getByText('All count: 2')).toBeInTheDocument();
  });

  it('uses the assigned-session billing resolver for BT capture without requiring direct authorization reads', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockClear();
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'sessions') {
        return buildChain([], {
          program_id: 'program-1',
          goal_id: 'goal-1',
          started_at: null,
        });
      }
      if (table === 'session_goals') {
        return buildChain([{ goal_id: 'goal-1' }]);
      }
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'client_session_notes') {
        return buildChain([]);
      }
      if (table === 'authorizations') {
        return buildChain([]);
      }
      return buildChain([]);
    });

    await vi.mocked(supabase.rpc).withImplementation(
      async (fn: string, args?: Record<string, unknown>) => {
        if (fn === 'get_session_capture_strict_billing_gate') {
          return { data: true, error: null };
        }
        if (fn === 'resolve_assigned_bt_session_capture_billing') {
          expect(args).toEqual({ p_session_id: 'session-bt-resolver-capture' });
          return {
            data: [
              {
                authorization_id: 'auth-resolver',
                service_code: '97155',
                strict_billing: true,
              },
            ],
            error: null,
          };
        }
        return { data: null, error: null };
      },
      async () => {
        renderWithProviders(
          <SessionModal
            {...defaultProps}
            dataCollectionOnly
            onSubmit={onSubmit}
            session={{
              id: 'session-bt-resolver-capture',
              therapist_id: 'test-therapist-1',
              client_id: 'test-client-1',
              program_id: 'program-1',
              goal_id: 'goal-1',
              start_time: '2026-03-01T10:00:00.000Z',
              end_time: '2026-03-01T11:00:00.000Z',
              status: 'in_progress',
              notes: '',
              created_at: '2026-03-01T09:00:00.000Z',
              created_by: null,
              updated_at: '2026-03-01T09:00:00.000Z',
              updated_by: null,
              started_at: null,
            } satisfies Session}
          />,
        );

        fireEvent.change(await screen.findByLabelText(/^Per-goal note$/i), {
          target: { value: 'Progress details from resolver path' },
        });
        await userEvent.click(screen.getByRole('button', { name: /Save clinical capture/i }));

        await waitFor(() => {
          expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
            session_note_authorization_id: 'auth-resolver',
            session_note_service_code: '97155',
          }));
        });
      },
    );
    expect(supabase.rpc).toHaveBeenCalledWith('resolve_assigned_bt_session_capture_billing', {
      p_session_id: 'session-bt-resolver-capture',
    });
    expect(vi.mocked(supabase.from).mock.calls.filter(([table]) => table === 'authorizations')).toHaveLength(0);
  });

  it('closes an in-progress historical session even when stored program and goal are no longer active', async () => {
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain([
          {
            ...mockPrograms[0],
            id: 'inactive-program-1',
            name: 'Inactive Published Program',
            status: 'inactive',
          },
        ]);
      }
      if (table === 'goals') {
        return buildChain([
          {
            ...mockGoals[0],
            id: 'paused-goal-1',
            program_id: 'inactive-program-1',
            title: 'Paused Published Goal',
            status: 'paused',
          },
        ]);
      }
      return buildChain([]);
    });
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-close-inactive-history',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'inactive-program-1',
          goal_id: 'paused-goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: '2026-03-01T10:00:00.000Z',
        } satisfies Session}
      />
    );

    await userEvent.click(await screen.findByRole('button', { name: /^Close Session$/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        status: 'completed',
      }));
    });
  });

  it('blocks Close Session when session capture needs billing defaults but none exist', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'sessions') {
        return buildChain([], {
          program_id: 'program-1',
          goal_id: 'goal-1',
          started_at: '2026-03-01T10:00:00.000Z',
        });
      }
      if (table === 'session_goals') {
        return buildChain([{ goal_id: 'goal-1' }]);
      }
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([]);
      }
      if (table === 'client_session_notes') {
        return buildChain([]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-close-clinical-validation',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: '2026-03-01T10:00:00.000Z',
        } satisfies Session}
      />
    );

    fireEvent.change(await screen.findByLabelText(/^Per-goal note$/i), {
      target: { value: 'Progress details' },
    });
    await userEvent.click(screen.getByRole('button', { name: /^Close Session$/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

    it('calls onSessionStarted after a successful Start Session', async () => {
    vi.mocked(startSessionFromModal).mockResolvedValue(undefined);
    const onSessionStarted = vi.fn();

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSessionStarted={onSessionStarted}
        session={{
          id: 'session-to-start',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    const startButton = await screen.findByRole('button', { name: /Start Session/i });
    await waitFor(() => expect(startButton).not.toBeDisabled());
    await userEvent.click(startButton);

    await waitFor(() => {
      expect(vi.mocked(startSessionFromModal)).toHaveBeenCalledOnce();
      expect(onSessionStarted).toHaveBeenCalledOnce();
      expect(defaultProps.onClose).toHaveBeenCalled();
      expect(toastMocks.showSuccess).toHaveBeenCalledWith('Session started');
    });
  });

  it('preserves non-data edit behavior when starting with another valid program and goal', async () => {
      vi.mocked(startSessionFromModal).mockResolvedValue(undefined);

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={{
            id: 'session-edit',
            therapist_id: 'test-therapist-1',
            client_id: 'test-client-1',
            program_id: 'program-1',
            goal_id: 'goal-1',
            start_time: '2026-03-01T10:00:00.000Z',
            end_time: '2026-03-01T11:00:00.000Z',
            status: 'scheduled',
            notes: '',
            created_at: '2026-03-01T09:00:00.000Z',
            created_by: null,
            updated_at: '2026-03-01T09:00:00.000Z',
            updated_by: null,
            started_at: null,
          } satisfies Session}
        />
      );

      await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
      await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
      await expandPlanGoals();
      await screen.findByRole('button', { name: /Default Program/i });
      await userEvent.click(screen.getByRole('button', { name: /Default Program/i }));
      await userEvent.click(screen.getByRole('button', { name: /Second Program/i }));
      await userEvent.click(screen.getByRole('button', { name: /Default Program/i }));
      await userEvent.click(screen.getByRole('button', { name: /Default Program/i }));
      await selectGoalFromLowerControls(/Default Goal/i);
      const startButton = screen.getByRole('button', { name: /Start Session/i });
      await waitFor(() => expect(startButton).not.toBeDisabled());
      await userEvent.click(startButton);

      await waitFor(() => {
        expect(vi.mocked(startSessionFromModal)).toHaveBeenCalledWith({
          sessionId: 'session-edit',
          programId: 'program-2',
          goalId: 'goal-2',
          goalIds: expect.arrayContaining(['goal-1', 'goal-2']),
        });
      });
  });

  it('does not start a scheduled session with unavailable live program and goal selections', async () => {
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain([
          {
            ...mockPrograms[0],
            id: 'inactive-program-1',
            name: 'Inactive Published Program',
            status: 'inactive',
          },
        ]);
      }
      if (table === 'goals') {
        return buildChain([
          {
            ...mockGoals[0],
            id: 'paused-goal-1',
            program_id: 'inactive-program-1',
            title: 'Paused Published Goal',
            status: 'paused',
          },
        ]);
      }
      return buildChain([]);
    });
    const onSessionStarted = vi.fn();

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSessionStarted={onSessionStarted}
        dataCollectionOnly
        allowStartSession
        session={{
          id: 'session-unavailable-start',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'inactive-program-1',
          goal_id: 'paused-goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    const startButton = await screen.findByRole('button', { name: /Start Session/i });
    await waitFor(() => expect(startButton).toBeDisabled());
    await userEvent.click(startButton);

    expect(vi.mocked(startSessionFromModal)).not.toHaveBeenCalled();
    expect(onSessionStarted).not.toHaveBeenCalled();
  });

  it('does not save an unstarted scheduled session with unavailable live program and goal selections', async () => {
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain([
          {
            ...mockPrograms[0],
            id: 'inactive-program-1',
            name: 'Inactive Published Program',
            status: 'inactive',
          },
        ]);
      }
      if (table === 'goals') {
        return buildChain([
          {
            ...mockGoals[0],
            id: 'paused-goal-1',
            program_id: 'inactive-program-1',
            title: 'Paused Published Goal',
            status: 'paused',
          },
        ]);
      }
      return buildChain([]);
    });
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-unavailable-save',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'inactive-program-1',
          goal_id: 'paused-goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    expect(await screen.findByText(/No active programs found for this client/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Default Program/i })).not.toBeInTheDocument();
    const unavailableUpdateButton = screen.getByRole('button', { name: /Update Session/i });
    await waitFor(() => expect(unavailableUpdateButton).not.toBeDisabled());
    await userEvent.click(unavailableUpdateButton);

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText(/Select an active program before saving this scheduled session\./i)).toBeInTheDocument();
    });
  });

  it('does not save an unstarted scheduled session when the program is active but the primary goal is unavailable', async () => {
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain([
          {
            ...mockGoals[0],
            id: 'paused-goal-1',
            program_id: 'program-1',
            title: 'Paused Published Goal',
            status: 'paused',
          },
        ]);
      }
      return buildChain([]);
    });
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-unavailable-goal-save',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'paused-goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    expect(await screen.findByText(/No active goals found for this client/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Default Program$/i })).not.toBeInTheDocument();
    const unavailableGoalUpdateButton = screen.getByRole('button', { name: /Update Session/i });
    await waitFor(() => expect(unavailableGoalUpdateButton).not.toBeDisabled());
    await userEvent.click(unavailableGoalUpdateButton);

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText(/Select an active primary goal before saving this scheduled session\./i)).toBeInTheDocument();
    });
  });

  it('saves a legacy scheduled session with no stored program or primary goal', async () => {
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs' || table === 'goals') {
        return buildChain([]);
      }
      return buildChain([]);
    });
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-legacy-no-plan-save',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: null,
          goal_id: null,
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    const legacyNoPlanUpdateButton = await screen.findByRole('button', { name: /Update Session/i });
    await waitFor(() => expect(legacyNoPlanUpdateButton).not.toBeDisabled());
    await userEvent.click(legacyNoPlanUpdateButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        program_id: '',
        goal_id: '',
        status: 'scheduled',
      }));
    });
    expect(screen.queryByText(/Select an active program before saving this scheduled session/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Select an active primary goal before saving this scheduled session/i)).not.toBeInTheDocument();
  });

  it('saves a legacy scheduled session with an active program and no stored primary goal', async () => {
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain([]);
      }
      return buildChain([]);
    });
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-legacy-no-primary-goal-save',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: null,
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    expect(await screen.findByText(/No active goals found for this client/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Default Program$/i })).not.toBeInTheDocument();
    const legacyNoGoalUpdateButton = screen.getByRole('button', { name: /Update Session/i });
    await waitFor(() => expect(legacyNoGoalUpdateButton).not.toBeDisabled());
    await userEvent.click(legacyNoGoalUpdateButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        program_id: 'program-1',
        goal_id: '',
        status: 'scheduled',
      }));
    });
    expect(screen.queryByText(/Select an active primary goal before saving this scheduled session/i)).not.toBeInTheDocument();
  });

  describe('status select — create mode (no session prop)', () => {
    it('disables in_progress option in create mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} />);
      const option = screen.getByRole('option', { name: /In Progress/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(true);
    });

    it('disables completed option in create mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} />);
      const option = screen.getByRole('option', { name: /^Completed$/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(true);
    });

    it('disables no-show option in create mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} />);
      const option = screen.getByRole('option', { name: /No Show/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(true);
    });

    it('keeps scheduled enabled in create mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} />);
      const option = screen.getByRole('option', { name: /^Scheduled$/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(false);
    });

    it('shows direct cancellation choices for creators in create mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} />);
      expect(screen.getByRole('option', { name: 'Staff cancellation' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Client cancellation' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /^Cancelled$/ })).not.toBeInTheDocument();
    });
  });

  describe('status select — edit mode (session prop present)', () => {
    const editSession: Session = {
      id: 'session-edit',
      therapist_id: 'test-therapist-1',
      client_id: 'test-client-1',
      program_id: 'program-1',
      goal_id: 'goal-1',
      start_time: '2026-03-31T10:00:00.000Z',
      end_time: '2026-03-31T11:00:00.000Z',
      status: 'scheduled',
      notes: '',
      created_at: '2026-03-31T09:00:00.000Z',
      created_by: null,
      updated_at: '2026-03-31T09:00:00.000Z',
      updated_by: null,
      started_at: null,
    };

    it('enables completed option in edit mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} session={editSession} />);
      const option = screen.getByRole('option', { name: /^Completed$/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(false);
    });

    it('enables no-show option in edit mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} session={editSession} />);
      const option = screen.getByRole('option', { name: /No Show/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(false);
    });

    it('keeps in_progress disabled in edit mode (display-only state)', () => {
      renderWithProviders(<SessionModal {...defaultProps} session={editSession} />);
      const option = screen.getByRole('option', { name: /In Progress/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(true);
    });

    it('disables the generic scheduled option for persisted cancelled sessions', () => {
      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={{ ...editSession, status: 'cancelled' }}
          onReactivate={vi.fn()}
        />,
      );

      const option = screen.getByRole('option', { name: /^Scheduled$/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(true);
    });

    it('shows in_progress as current value when session status is in_progress', () => {
      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={{ ...editSession, status: 'in_progress' }}
        />
      );
      const select = screen.getByRole('combobox', { name: /Status/i }) as HTMLSelectElement;
      expect(select.value).toBe('in_progress');
    });

    it('hides selectable cancellation options for non-creators', () => {
      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={editSession}
          canCreateSchedules={false}
        />
      );

      expect(screen.queryByRole('option', { name: 'Staff cancellation' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Client cancellation' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /^Cancelled$/ })).not.toBeInTheDocument();
    });

    it('shows a disabled cancelled option only for persisted cancelled sessions without creator access', () => {
      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={{ ...editSession, status: 'cancelled' }}
          canCreateSchedules={false}
        />
      );

      const option = screen.getByRole('option', { name: /^Cancelled$/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(true);
    });

    it('shows a reactivate action only for cancelled persisted sessions with scheduling access', () => {
      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={cancelledScheduledSession}
          onReactivate={vi.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: /Reactivate appointment/i })).toBeInTheDocument();
    });

    it('hides the reactivate action for create mode, non-cancelled sessions, and non-creators', () => {
      const { rerender } = renderWithProviders(
        <SessionModal
          {...defaultProps}
          onReactivate={vi.fn()}
        />,
      );

      expect(screen.queryByRole('button', { name: /Reactivate appointment/i })).not.toBeInTheDocument();

      rerender(
        <SessionModal
          {...defaultProps}
          session={validScheduledSession}
          onReactivate={vi.fn()}
        />,
      );
      expect(screen.queryByRole('button', { name: /Reactivate appointment/i })).not.toBeInTheDocument();

      rerender(
        <SessionModal
          {...defaultProps}
          session={cancelledScheduledSession}
          canCreateSchedules={false}
          onReactivate={vi.fn()}
        />,
      );
      expect(screen.queryByRole('button', { name: /Reactivate appointment/i })).not.toBeInTheDocument();
    });

    it('confirms before reactivating and calls the handler exactly once', async () => {
      const onReactivate = vi.fn().mockResolvedValue(undefined);
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={cancelledScheduledSession}
          onReactivate={onReactivate}
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: /Reactivate appointment/i }));

      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(onReactivate).toHaveBeenCalledTimes(1);
      expect(onReactivate).toHaveBeenCalledWith(expect.objectContaining({
        session: expect.objectContaining({ id: cancelledScheduledSession.id }),
        start_time: cancelledScheduledSession.start_time,
        end_time: cancelledScheduledSession.end_time,
      }));

      confirmSpy.mockRestore();
    });

    it('forwards edited modal times to the reactivation handler as UTC timestamps', async () => {
      const onReactivate = vi.fn().mockResolvedValue(undefined);
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={cancelledScheduledSession}
          onReactivate={onReactivate}
        />,
      );

      fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: '2025-03-18T10:15' } });
      fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: '2025-03-18T11:15' } });
      await userEvent.click(screen.getByRole('button', { name: /Reactivate appointment/i }));

      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('10:15'));
      expect(onReactivate).toHaveBeenCalledWith(expect.objectContaining({
        session: expect.objectContaining({ id: cancelledScheduledSession.id }),
        start_time: '2025-03-18T14:15:00.000Z',
        end_time: '2025-03-18T15:15:00.000Z',
      }));

      confirmSpy.mockRestore();
    });

    it('does not reactivate when confirmation is cancelled', async () => {
      const onReactivate = vi.fn().mockResolvedValue(undefined);
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={cancelledScheduledSession}
          onReactivate={onReactivate}
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: /Reactivate appointment/i }));

      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(onReactivate).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });

    it('disables the reactivate action and shows pending copy while reactivation is in flight', () => {
      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={cancelledScheduledSession}
          onReactivate={vi.fn()}
          isReactivating
        />,
      );

      expect(screen.getByRole('button', { name: /Reactivating\.\.\./i })).toBeDisabled();
    });

    it('hydrates a persisted client cancellation before displaying its attribution', async () => {
      const buildChain = (rows: unknown[], singleRow: unknown = null) => {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: rows, error: null })),
          maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      };
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'sessions') {
          return buildChain([], {
            program_id: 'program-1',
            goal_id: 'goal-1',
            started_at: null,
            location_type: null,
            cancellation_attribution: 'client',
          });
        }
        if (table === 'programs') return buildChain(mockPrograms);
        if (table === 'goals') return buildChain(mockGoals);
        return buildChain([]);
      });

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={{ ...editSession, status: 'cancelled', cancellation_attribution: undefined }}
        />,
      );

      const statusSelect = screen.getByRole('combobox', { name: /Status/i }) as HTMLSelectElement;
      await waitFor(() => expect(statusSelect.value).toBe('cancelled:client'));
      expect(statusSelect.selectedOptions[0]?.textContent).toBe('Client cancellation');
    });

    it('preserves an unknown persisted cancellation attribution instead of defaulting it to staff', async () => {
      const buildChain = (rows: unknown[], singleRow: unknown = null) => {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: rows, error: null })),
          maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      };
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'sessions') {
          return buildChain([], {
            program_id: 'program-1',
            goal_id: 'goal-1',
            started_at: null,
            location_type: null,
            cancellation_attribution: null,
          });
        }
        if (table === 'programs') return buildChain(mockPrograms);
        if (table === 'goals') return buildChain(mockGoals);
        return buildChain([]);
      });

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={{ ...editSession, status: 'cancelled', cancellation_attribution: undefined }}
        />,
      );

      const statusSelect = screen.getByRole('combobox', { name: /Status/i }) as HTMLSelectElement;
      await waitFor(() => expect(statusSelect.value).toBe('cancelled:unknown'));
      expect(statusSelect.selectedOptions[0]?.textContent).toBe('Cancelled — attribution unavailable');
    });

    it('does not reapply persisted cancellation attribution after the user changes it', async () => {
      const buildChain = (rows: unknown[], singleRow: unknown = null) => {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: rows, error: null })),
          maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      };
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'sessions') {
          return buildChain([], {
            program_id: 'program-1',
            goal_id: 'goal-1',
            started_at: null,
            location_type: null,
            cancellation_attribution: null,
          });
        }
        if (table === 'programs') return buildChain(mockPrograms);
        if (table === 'goals') return buildChain(mockGoals);
        return buildChain([]);
      });
      const onSubmit = vi.fn().mockResolvedValue(undefined);

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          onSubmit={onSubmit}
          session={{ ...editSession, status: 'cancelled', cancellation_attribution: undefined }}
        />,
      );

      const statusSelect = screen.getByRole('combobox', { name: /Status/i }) as HTMLSelectElement;
      await waitFor(() => expect(statusSelect.value).toBe('cancelled:unknown'));
      await userEvent.selectOptions(statusSelect, 'Client cancellation');
      await waitFor(() => expect(statusSelect.value).toBe('cancelled:client'));
      await userEvent.click(screen.getByRole('button', { name: /Update Session/i }));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
          status: 'cancelled',
          cancellation_attribution: 'client',
        }));
      });
    });

    it('does not overwrite a new cancellation choice when stale session details arrive later', async () => {
      type SessionDetailsResponse = {
        data: {
          program_id: string;
          goal_id: string;
          started_at: null;
          location_type: null;
          cancellation_attribution: null;
        };
        error: null;
      };
      let resolveSessionDetails: ((value: SessionDetailsResponse) => void) | undefined;
      const sessionDetailsPromise = new Promise<SessionDetailsResponse>((resolve) => {
        resolveSessionDetails = resolve;
      });
      const buildChain = (rows: unknown[]) => {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: rows, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      };
      const sessionChain = buildChain([]);
      sessionChain.maybeSingle = vi.fn(() => sessionDetailsPromise);
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'sessions') return sessionChain;
        if (table === 'programs') return buildChain(mockPrograms);
        if (table === 'goals') return buildChain(mockGoals);
        return buildChain([]);
      });
      const onSubmit = vi.fn().mockResolvedValue(undefined);

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          onSubmit={onSubmit}
          session={editSession}
        />,
      );

      const statusSelect = screen.getByRole('combobox', { name: /Status/i }) as HTMLSelectElement;
      await waitFor(() => expect(sessionChain.maybeSingle).toHaveBeenCalled());
      await userEvent.selectOptions(statusSelect, 'Client cancellation');
      expect(statusSelect.value).toBe('cancelled:client');

      await act(async () => {
        resolveSessionDetails?.({
          data: {
            program_id: 'program-1',
            goal_id: 'goal-1',
            started_at: null,
            location_type: null,
            cancellation_attribution: null,
          },
          error: null,
        });
        await sessionDetailsPromise;
      });

      await waitFor(() => expect(statusSelect.value).toBe('cancelled:client'));
      await userEvent.click(screen.getByRole('button', { name: /Update Session/i }));
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
          status: 'cancelled',
          cancellation_attribution: 'client',
        }));
      });
    });

    it.each([
      ['Staff cancellation', 'staff'],
      ['Client cancellation', 'client'],
    ] as const)('submits %s with literal cancellation attribution', async (optionLabel, expectedAttribution) => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          onSubmit={onSubmit}
          session={editSession}
        />
      );

      await userEvent.selectOptions(screen.getByRole('combobox', { name: /Status/i }), optionLabel);
      await userEvent.click(screen.getByRole('button', { name: /Update Session/i }));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
          status: 'cancelled',
          cancellation_attribution: expectedAttribution,
        }));
      });
    });

    it('locks scheduled-session metadata while allowing BT clinical capture to be edited and saved', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const buildChain = (rows: unknown[]) => {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: rows, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      };
      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'programs') return buildChain(mockPrograms);
        if (table === 'goals') return buildChain(mockGoals);
        if (table === 'authorizations') {
          return buildChain([{
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          }]);
        }
        return buildChain([]);
      });
      const lockedSession: Session = {
        ...editSession,
        notes: 'Original schedule note',
      };

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          onSubmit={onSubmit}
          session={lockedSession}
          dataCollectionOnly
        />
      );

      expect(screen.getByRole('combobox', { name: /Therapist/i })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: /Client/i })).toBeDisabled();
      expectVisiblePlanSelectorsRemoved();
      expect(screen.getByRole('combobox', { name: /Status/i })).toBeDisabled();
      expect(screen.getByLabelText(/Start Time/i)).toBeDisabled();
      expect(screen.getByLabelText(/End Time/i)).toBeDisabled();
      expect(screen.getByLabelText(/Schedule Notes/i)).toBeDisabled();

      fireEvent.change(await screen.findByLabelText(/^Per-goal note$/i), {
        target: { value: 'BT clinical capture update' },
      });
      await userEvent.click(screen.getByRole('button', { name: /Save clinical capture/i }));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
          id: 'session-edit',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-31T10:00:00.000Z',
          end_time: '2026-03-31T11:00:00.000Z',
          status: 'scheduled',
          notes: 'Original schedule note',
          session_note_persist_requested: true,
          session_note_goal_notes: expect.objectContaining({
            'goal-1': 'BT clinical capture update',
          }),
        }));
      });
    });

    it('denies starting a scheduled data-only session when allowStartSession is omitted', async () => {
      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={editSession}
          dataCollectionOnly
        />
      );

      expect(screen.queryByRole('button', { name: /Start Session/i })).not.toBeInTheDocument();
    });

    it('keeps Start Session disabled when a stored supplemental goal is inactive', async () => {
      const inactiveSupplementalGoal = {
        ...mockGoals[0],
        id: 'goal-inactive-supplemental',
        title: 'Inactive Supplemental Goal',
        status: 'paused',
      };
      const buildThenableChain = (rows: unknown[], singleRow: unknown = null) => {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: rows, error: null })),
          maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
          then: (
            resolve: (value: { data: unknown[]; error: null }) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
        };
        return chain;
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'sessions') {
          return buildThenableChain([], {
            program_id: 'program-1',
            goal_id: 'goal-1',
            started_at: null,
          }) as never;
        }
        if (table === 'session_goals') {
          return buildThenableChain([
            { goal_id: 'goal-1' },
            { goal_id: inactiveSupplementalGoal.id },
          ]) as never;
        }
        if (table === 'programs') {
          return buildThenableChain(mockPrograms) as never;
        }
        if (table === 'goals') {
          return buildThenableChain([...mockGoals, inactiveSupplementalGoal]) as never;
        }
        return buildThenableChain([]) as never;
      });

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={editSession}
          dataCollectionOnly
          allowStartSession
        />
      );

      const startButton = await screen.findByRole('button', { name: /Start Session/i });
      await waitFor(() => expect(startButton).toBeDisabled());
      await userEvent.click(startButton);
      expect(vi.mocked(startSessionFromModal)).not.toHaveBeenCalled();

    });

    it('allows Start Session for an active canonical multi-program goal set', async () => {
      vi.mocked(startSessionFromModal).mockResolvedValue(undefined);
      const buildThenableChain = (rows: unknown[], singleRow: unknown = null) => {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: rows, error: null })),
          maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
          then: (
            resolve: (value: { data: unknown[]; error: null }) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
        };
        return chain;
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'sessions') {
          return buildThenableChain([], {
            program_id: 'program-1',
            goal_id: 'goal-1',
            started_at: null,
          }) as never;
        }
        if (table === 'session_goals') {
          return buildThenableChain([{ goal_id: 'goal-1' }, { goal_id: 'goal-2' }]) as never;
        }
        if (table === 'programs') {
          return buildThenableChain(mockPrograms) as never;
        }
        if (table === 'goals') {
          return buildThenableChain(mockGoals) as never;
        }
        return buildThenableChain([]) as never;
      });

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={editSession}
          dataCollectionOnly
          allowStartSession
        />
      );

      const startButton = await screen.findByRole('button', { name: /Start Session/i });
      await waitFor(() => expect(startButton).not.toBeDisabled());
      await userEvent.click(startButton);

      await waitFor(() => {
        expect(vi.mocked(startSessionFromModal)).toHaveBeenCalledWith({
          sessionId: 'session-edit',
          programId: 'program-1',
          goalId: 'goal-1',
          goalIds: ['goal-1', 'goal-2'],
        });
      });
    });

    it('keeps Start Session disabled when canonical session goals cannot be loaded', async () => {
      const buildChain = (rows: unknown[], singleRow: unknown = null, queryError: unknown = null) => {
        const result = { data: queryError ? null : rows, error: queryError };
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => result),
          maybeSingle: vi.fn(async () => ({ data: queryError ? null : singleRow, error: queryError })),
          limit: vi.fn(async () => ({ data: [], error: null })),
          then: (
            resolve: (value: typeof result) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(result).then(resolve, reject),
        };
        return chain;
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'sessions') {
          return buildChain([], {
            program_id: 'program-1',
            goal_id: 'goal-1',
            started_at: null,
          }) as never;
        }
        if (table === 'session_goals') {
          return buildChain([], null, { message: 'session goals unavailable' }) as never;
        }
        if (table === 'programs') {
          return buildChain(mockPrograms) as never;
        }
        if (table === 'goals') {
          return buildChain(mockGoals) as never;
        }
        return buildChain([]) as never;
      });

      const { rerender } = renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={editSession}
          dataCollectionOnly
          allowStartSession
        />
      );

      const startButton = await screen.findByRole('button', { name: /Start Session/i });
      await waitFor(() => expect(startButton).toBeDisabled());
      await userEvent.click(startButton);
      expect(vi.mocked(startSessionFromModal)).not.toHaveBeenCalled();

      rerender(
        <SessionModal
          {...defaultProps}
          session={{
            ...editSession,
            status: 'in_progress',
            started_at: '2026-03-31T10:05:00.000Z',
          }}
          dataCollectionOnly
        />
      );
      expect(await screen.findByRole('button', { name: /^Close Session$/i })).not.toBeDisabled();
    });

    it('hides start session for an in-progress data-only session even when allowStartSession is true', async () => {
      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={{
            ...editSession,
            status: 'in_progress',
            started_at: '2026-03-31T10:05:00.000Z',
          }}
          dataCollectionOnly
          allowStartSession
        />
      );

      expect(screen.queryByRole('button', { name: /Start Session/i })).not.toBeInTheDocument();
      expect(vi.mocked(startSessionFromModal)).not.toHaveBeenCalled();
    });

    it('allows a scheduled BT data-only session to start without unlocking schedule metadata', async () => {
      vi.mocked(startSessionFromModal).mockResolvedValue(undefined);
      const onSessionStarted = vi.fn();

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={editSession}
          dataCollectionOnly
          allowStartSession
          onSessionStarted={onSessionStarted}
        />
      );

      expect(screen.getByRole('combobox', { name: /Therapist/i })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: /Client/i })).toBeDisabled();
      expectVisiblePlanSelectorsRemoved();
      expect(screen.getByRole('combobox', { name: /Status/i })).toBeDisabled();
      expect(screen.getByLabelText(/Start Time/i)).toBeDisabled();
      expect(screen.getByLabelText(/End Time/i)).toBeDisabled();
      expect(screen.getByLabelText(/Schedule Notes/i)).toBeDisabled();
      await expandPlanGoals();
      expect(await screen.findByRole('button', { name: /Default Program/i })).toBeDisabled();
      expect(screen.queryByRole('button', { name: /Second Program/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: /Default Goal/i })).not.toBeInTheDocument();

      const startButton = await screen.findByRole('button', { name: /Start Session/i });
      await waitFor(() => expect(startButton).not.toBeDisabled());
      await userEvent.click(startButton);

      await waitFor(() => {
        expect(vi.mocked(startSessionFromModal)).toHaveBeenCalledWith({
          sessionId: 'session-edit',
          programId: 'program-1',
          goalId: 'goal-1',
          goalIds: ['goal-1'],
        });
        expect(vi.mocked(startSessionFromModal)).toHaveBeenCalledOnce();
        expect(onSessionStarted).toHaveBeenCalledOnce();
        expect(defaultProps.onClose).toHaveBeenCalledOnce();
      });
    });

    it('labels in-progress BT saves as clinical capture without changing the BCBA save label', () => {
      const inProgressSession: Session = {
        ...editSession,
        status: 'in_progress',
        started_at: '2026-03-31T10:05:00.000Z',
      };

      const { rerender } = renderWithProviders(
        <SessionModal {...defaultProps} session={inProgressSession} dataCollectionOnly />,
      );

      expect(screen.getByRole('button', { name: /Save clinical capture/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Save progress/i })).not.toBeInTheDocument();

      rerender(<SessionModal {...defaultProps} session={inProgressSession} />);

      expect(screen.getByRole('button', { name: /Save progress/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Save clinical capture/i })).not.toBeInTheDocument();
    });

    it('advances BT data-only edit mode to closeout without unlocking schedule metadata', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const lockedSession: Session = {
        ...editSession,
        status: 'in_progress',
        notes: 'Original schedule note',
        started_at: '2026-03-31T10:05:00.000Z',
      };

      renderWithProviders(
        <SessionModal
          {...defaultProps}
          onSubmit={onSubmit}
          session={lockedSession}
          dataCollectionOnly
        />
      );

      const closeSessionButton = screen.getByRole('button', { name: /^Close Session$/i });
      await waitFor(() => expect(closeSessionButton).not.toBeDisabled());
      await userEvent.click(closeSessionButton);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
          id: 'session-edit',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-31T10:00:00.000Z',
          end_time: '2026-03-31T11:00:00.000Z',
          status: 'in_progress',
          notes: 'Original schedule note',
          session_note_begin_closeout: true,
        }));
      });
      expect(await screen.findByRole('heading', { name: 'ABA Session Note' })).toBeInTheDocument();
    });
  });

  it('does not preselect inactive published programs or paused goals for a new session', async () => {
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain([
          {
            ...mockPrograms[0],
            id: 'inactive-program-1',
            name: 'Inactive Published Program',
            status: 'inactive',
          },
        ]);
      }
      if (table === 'goals') {
        return buildChain([
          {
            ...mockGoals[0],
            id: 'paused-goal-1',
            program_id: 'inactive-program-1',
            title: 'Paused Published Goal',
            status: 'paused',
          },
        ]);
      }
      return buildChain([]);
    });

    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<SessionModal {...defaultProps} onSubmit={onSubmit} />);

    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');

    await waitFor(() => {
      expectVisiblePlanSelectorsRemoved();
      expect(screen.queryByRole('button', { name: /Default Program/i })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/No active programs found for this client/i)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Inactive Published Program' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Paused Published Goal' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: '2025-03-18T10:00' } });
    fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: '2025-03-18T11:00' } });
    await userEvent.click(screen.getByRole('button', { name: /Create Session/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        program_id: '',
        goal_id: '',
      }));
    });
    expect(screen.queryByText(/Program is required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Primary goal is required/i)).not.toBeInTheDocument();
  });

  it('keeps plan query failures distinct from empty data and offers focused retries', async () => {
    const programOrder = vi.fn(async () => ({ data: null, error: new Error('program fetch failed') }));
    const goalOrder = vi.fn(async () => ({ data: null, error: new Error('goal fetch failed') }));
    const buildErrorChain = (order: SupabaseQueryChain['order']) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order,
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildErrorChain(programOrder);
      }
      if (table === 'goals') {
        return buildErrorChain(goalOrder);
      }
      return buildErrorChain(vi.fn(async () => ({ data: [], error: null })));
    });

    renderWithProviders(<SessionModal {...defaultProps} />);
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');

    expect(await screen.findByText('Could not load programs.')).toBeInTheDocument();
    expect(await screen.findByText('Could not load goals.')).toBeInTheDocument();
    expect(screen.queryByText(/No active programs found for this client/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry programs' }));
    await waitFor(() => expect(programOrder).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Retry goals' }));
    await waitFor(() => expect(goalOrder).toHaveBeenCalledTimes(2));
  });

  it('shows saved state after successful update for edit sessions', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-save-success',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    const saveSuccessButton = screen.getByRole('button', { name: /Update Session/i });
    await waitFor(() => expect(saveSuccessButton).not.toBeDisabled());
    await userEvent.click(saveSuccessButton);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    const saveState = screen.getByTestId('session-modal-save-state');
    expect(saveState).toHaveTextContent('Session details saved.');
    expect(saveState).toHaveAttribute('role', 'status');
    expect(saveState).toHaveAttribute('aria-live', 'polite');
  });

  it('preserves entered values and shows current context after a stale 409', async () => {
    const conflict = Object.assign(new Error('The selected target is no longer current.'), {
      status: 409,
      conflict: { stale_target_id: 'stale-target', current_target_name: 'Replacement Target', current_phase: 'Baseline' },
    });
    const onSubmit = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({ progression_results: [], progression_warnings: [] });
    const session = {
      id: 'session-stale', therapist_id: 'test-therapist-1', client_id: 'test-client-1', program_id: 'program-1', goal_id: 'goal-1',
      start_time: '2026-03-01T10:00:00.000Z', end_time: '2026-03-01T11:00:00.000Z', status: 'scheduled', notes: '',
      created_at: '2026-03-01T09:00:00.000Z', created_by: null, updated_at: '2026-03-01T09:00:00.000Z', updated_by: null, started_at: null,
    } satisfies Session;
    renderWithProviders(<SessionModal {...defaultProps} onSubmit={onSubmit} session={session} />);
    const notes = screen.getByLabelText(/^Schedule Notes$/i) as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: 'Do not discard this entry' } });
    await userEvent.click(screen.getByRole('button', { name: /Update Session/i }));
    expect(notes).toHaveValue('Do not discard this entry');
    await expandClinicalDetails();
    expect(await screen.findByRole('alert')).toHaveTextContent('Replacement Target');
    expect(screen.getByRole('alert')).toHaveTextContent('Baseline');
    expect(screen.getByRole('alert')).toHaveTextContent('completed session is preserved');
    await userEvent.click(screen.getByRole('button', { name: /Discard stale trials and retry/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(notes).toHaveValue('Do not discard this entry');
  });

  it('resets saved status after close and reopen', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const props = {
      ...defaultProps,
      onSubmit,
      session: {
        id: 'session-save-reset',
        therapist_id: 'test-therapist-1',
        client_id: 'test-client-1',
        program_id: 'program-1',
        goal_id: 'goal-1',
        start_time: '2026-03-01T10:00:00.000Z',
        end_time: '2026-03-01T11:00:00.000Z',
        status: 'scheduled',
        notes: '',
        created_at: '2026-03-01T09:00:00.000Z',
        created_by: null,
        updated_at: '2026-03-01T09:00:00.000Z',
        updated_by: null,
        started_at: null,
      } satisfies Session,
    };
    const { rerender } = renderWithProviders(<SessionModal {...props} />);

    const saveResetButton = screen.getByRole('button', { name: /Update Session/i });
    await waitFor(() => expect(saveResetButton).not.toBeDisabled());
    await userEvent.click(saveResetButton);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(screen.getByTestId('session-modal-save-state')).toHaveTextContent('Session details saved.');

    rerender(<SessionModal {...props} isOpen={false} />);
    rerender(<SessionModal {...props} isOpen />);

    expect(screen.queryByTestId('session-modal-save-state')).not.toBeInTheDocument();
  });

  it('shows save error state when update fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Save failed'));
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-save-failure',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    const saveFailureButton = screen.getByRole('button', { name: /Update Session/i });
    await waitFor(() => expect(saveFailureButton).not.toBeDisabled());
    await userEvent.click(saveFailureButton);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    await screen.findByText('Unable to save session details. Try again.');
  });

  it('does not treat the edited session itself as a scheduling conflict fallback match', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const existingSession = {
      id: 'session-self-overlap',
      therapist_id: 'test-therapist-1',
      client_id: 'test-client-1',
      program_id: 'program-1',
      goal_id: 'goal-1',
      start_time: '2026-03-02T15:00:00.000Z',
      end_time: '2026-03-02T16:00:00.000Z',
      status: 'scheduled',
      notes: '',
      created_at: '2026-03-01T09:00:00.000Z',
      created_by: null,
      updated_at: '2026-03-01T09:00:00.000Z',
      updated_by: null,
      started_at: null,
    } satisfies Session;

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={existingSession}
        existingSessions={[existingSession]}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await expandPlanGoals();
    await screen.findByRole('button', { name: /Default Program/i });
    await userEvent.click(screen.getByRole('button', { name: /Default Program/i }));
    await selectGoalFromLowerControls(/Default Goal/i);
    fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: '2026-03-02T10:00' } });
    fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: '2026-03-02T11:00' } });

    const noConflictUpdateButton = screen.getByRole('button', { name: /Update Session/i });
    await waitFor(() => expect(noConflictUpdateButton).not.toBeDisabled());
    await userEvent.click(noConflictUpdateButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('marks unchanged linked session note content as non-persisting on scheduled updates', async () => {
    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'linked-note-1',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: ['Default Goal'],
      goal_ids: ['goal-1'],
      goal_measurements: null,
      goal_notes: { 'goal-1': 'Previously saved note' },
      session_id: 'session-note-prefill',
      narrative: '',
      is_locked: false,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: null,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T09:00:00.000Z',
    });

    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-note-prefill',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T15:00:00.000Z',
          end_time: '2026-03-01T16:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await expandClinicalDetails();
    const linkedPerGoalNote = await screen.findByLabelText(/^Per-goal note$/i);
    await waitFor(() => expect(linkedPerGoalNote).toHaveValue('Previously saved note'));

    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await expandPlanGoals();
    await screen.findByRole('button', { name: /Default Program/i });
    await userEvent.click(screen.getByRole('button', { name: /Default Program/i }));
    await selectGoalFromLowerControls(/Default Goal/i);
    fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: '2026-03-01T10:00' } });
    fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: '2026-03-01T11:00' } });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const linkedNoteUpdateButton = screen.getByRole('button', { name: /Update Session/i });
    await waitFor(() => expect(linkedNoteUpdateButton).not.toBeDisabled());
    await userEvent.click(linkedNoteUpdateButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      session_note_goal_notes: { 'goal-1': 'Previously saved note' },
      session_note_persist_requested: false,
    }));
    confirmSpy.mockRestore();
  });

  it('renders session capture section for existing sessions', () => {
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        session={{
          id: 'session-clinical-ui',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    expect(screen.getByTestId('session-modal-capture-section')).toBeInTheDocument();
    expect(screen.getByText('Live session')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('data-session-modal-mode', 'live');
    expect(screen.queryByRole('button', { name: /Start Session/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Skill$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^BX$/i })).toBeInTheDocument();
  });

  it('keeps plan and goals expanded in create mode until valid selections exist', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);

    const disclosure = screen.getByRole('button', { name: /plan & goals/i });

    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Programs in this session')).toBeVisible();
  });

  it('defaults a valid edited plan to a compact summary and preserves values across expansion', async () => {
    renderWithProviders(<SessionModal {...defaultProps} session={validScheduledSession} />);

    const disclosure = await screen.findByRole('button', { name: /plan & goals/i });

    await waitFor(() => expect(disclosure).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.getByText(/Default Program.*Default Goal/i)).toBeVisible();

    await userEvent.click(disclosure);
    expect(screen.getByText('Programs in this session')).toBeVisible();

    await userEvent.click(disclosure);
    await userEvent.click(disclosure);

    expect(screen.getAllByRole('button', { name: /Default Goal is primary goal/i })[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps an unavailable stored plan expanded so paused selections stay visible', async () => {
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain([
          {
            ...mockPrograms[0],
            id: 'inactive-program-1',
            name: 'Inactive Published Program',
            status: 'inactive',
          },
        ]);
      }
      if (table === 'goals') {
        return buildChain([
          {
            ...mockGoals[0],
            id: 'paused-goal-1',
            program_id: 'inactive-program-1',
            title: 'Paused Published Goal',
            status: 'paused',
          },
        ]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        session={{
          ...validScheduledSession,
          id: 'session-unavailable-plan-summary',
          program_id: 'inactive-program-1',
          goal_id: 'paused-goal-1',
        }}
      />,
    );

    const disclosure = await screen.findByRole('button', { name: /plan & goals/i });
    await waitFor(() => expect(disclosure).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByText(/No active programs found for this client/i)).toBeVisible();
    expect(screen.getByText('Programs in this session')).toBeVisible();
  });

  it('preserves create-mode plan selections across collapse and re-expansion after a valid plan exists', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);

    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');

    const defaultProgramButton = await screen.findByRole('button', { name: /Default Program/i });
    await userEvent.click(defaultProgramButton);
    await userEvent.click(screen.getByRole('button', { name: /Second Program/i }));
    const setPrimaryButton = screen.queryAllByRole('button', { name: /Set Default Goal as primary goal/i })[0];
    if (setPrimaryButton) {
      await userEvent.click(setPrimaryButton);
    }
    await selectGoalFromLowerControls(/Second Goal/);

    const disclosure = screen.getByRole('button', { name: /plan & goals/i });
    await userEvent.click(disclosure);
    expect(screen.queryByText('Programs in this session')).not.toBeVisible();

    await userEvent.click(disclosure);

    expect(screen.getByRole('button', { name: /Default Program/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', { name: /Default Goal is primary goal/i })[0]).toHaveAttribute('aria-pressed', 'true');
    expect(getGoalCheckbox(/Second Goal/)).toBeChecked();
  });

  it('keeps BT clinical capture expanded when it is the primary task', () => {
    renderWithProviders(
      <SessionModal {...defaultProps} session={btInProgressSession} dataCollectionOnly />,
    );

    expect(screen.getByTestId('session-modal-capture-section')).toBeVisible();
  });

  it('defaults secondary clinical details collapsed for a scheduled editable session', async () => {
    renderWithProviders(<SessionModal {...defaultProps} session={validScheduledSession} />);

    const disclosure = await screen.findByRole('button', { name: /clinical capture and secondary details/i });

    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('session-modal-capture-section')).not.toBeVisible();

    await userEvent.click(disclosure);

    expect(screen.getByTestId('session-modal-capture-section')).toBeVisible();
  });

  it('preserves user-expanded secondary clinical details after deferred plan hydration resolves', async () => {
    let resolvePrograms: ((value: { data: unknown[]; error: null }) => void) | null = null;
    let resolveGoals: ((value: { data: unknown[]; error: null }) => void) | null = null;
    const programsPromise = new Promise<{ data: unknown[]; error: null }>((resolve) => {
      resolvePrograms = resolve;
    });
    const goalsPromise = new Promise<{ data: unknown[]; error: null }>((resolve) => {
      resolveGoals = resolve;
    });
    const buildDeferredChain = (orderPromise: Promise<{ data: unknown[]; error: null }>) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(() => orderPromise),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildDeferredChain(programsPromise);
      }
      if (table === 'goals') {
        return buildDeferredChain(goalsPromise);
      }
      return buildChain([]);
    });

    renderWithProviders(<SessionModal {...defaultProps} session={validScheduledSession} />);

    const disclosure = await screen.findByRole('button', { name: /clinical capture and secondary details/i });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    await expandClinicalDetails();
    expect(screen.getByTestId('session-modal-capture-section')).toBeVisible();

    await act(async () => {
      resolvePrograms?.({ data: mockPrograms, error: null });
      resolveGoals?.({ data: mockGoals, error: null });
      await Promise.all([programsPromise, goalsPromise]);
    });

    await waitFor(() => expect(screen.getByRole('button', { name: /plan & goals/i })).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.getByRole('button', { name: /clinical capture and secondary details/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('session-modal-capture-section')).toBeVisible();
  });

  it('hides goal planning and session capture fields when schedule goal capture is suppressed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        hideGoalCaptureFields
        session={{
          id: 'session-admin-schedule-edit',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: 'Schedule only note',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    expect(screen.getByText('Edit Session')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Program/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Primary Goal/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Programs in this session/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Goals in this session/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-modal-capture-section')).not.toBeInTheDocument();

    const updateButton = screen.getByRole('button', { name: /Update Session/i });
    await waitFor(() => expect(updateButton).not.toBeDisabled());
    await userEvent.click(updateButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        id: 'session-admin-schedule-edit',
        program_id: 'program-1',
        goal_id: 'goal-1',
        therapist_id: 'test-therapist-1',
        client_id: 'test-client-1',
      }));
    });
  });

  it('keeps scheduler-only client reassignment from silently repopulating clinical plan fields', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        hideGoalCaptureFields
        clients={[
          ...mockClients,
          {
            ...mockClients[0],
            id: 'test-client-2',
            full_name: 'Test Client 2',
            email: 'client2@example.com',
          },
        ]}
        session={{
          id: 'session-admin-client-reassign',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          goal_ids: ['goal-1'],
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-2');
    const updateButton = screen.getByRole('button', { name: /Update Session/i });
    await waitFor(() => expect(updateButton).not.toBeDisabled());
    await userEvent.click(updateButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        id: 'session-admin-client-reassign',
        client_id: 'test-client-2',
        program_id: '',
        goal_id: '',
        goal_ids: [],
      }));
    });
  });

  it('submits normalized per-target trials with session capture', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-clinical-measurements',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    const planTargetButton = await screen.findByRole('button', { name: /Use plan target/i });
    expect(screen.queryByRole('button', { name: /add target/i })).not.toBeInTheDocument();
    await userEvent.click(planTargetButton);
    await screen.findByRole('button', { name: /Increase correct trials for target 1/i });
    fireEvent.change(screen.getByLabelText(/^Per-goal note$/i), {
      target: { value: 'Observed steady progress' },
    });
    for (let i = 0; i < 4; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: /Increase correct trials for target 1/i }));
    }
    await userEvent.click(screen.getByRole('button', { name: /Increase incorrect or no-response trials for target 1/i }));
    fireEvent.change(screen.getByLabelText(/Prompts & reactions for target 1/i), {
      target: { value: 'Needed one reminder at the start' },
    });

    await userEvent.click(screen.getByRole('button', { name: /Save skills/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        session_note_authorization_id: 'auth-1',
        session_note_service_code: '97153',
        session_note_goal_measurements: {
          'goal-1': {
            version: 1,
            data: expect.objectContaining({
              measurement_type: 'frequency',
              metric_label: 'Count',
              metric_unit: 'responses',
              metric_value: 4,
              incorrect_trials: 1,
              targets: ['Match peer greeting in 4/5 trials'],
              target: 'Match peer greeting in 4/5 trials',
              target_trials: [
                {
                  target: 'Match peer greeting in 4/5 trials',
                  metric_value: 4,
                  incorrect_trials: 1,
                  opportunities: null,
                  trial_prompt_note: 'Needed one reminder at the start',
                },
              ],
              trial_prompt_note: 'Needed one reminder at the start',
            }),
          },
        },
      }));
    });
  }, 15000);

  it('submits configured plan target trials as raw trial events', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const targetId = '88888888-8888-4888-8888-888888888888';
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      if (table === 'goal_targets') {
        return buildChain([
          {
            id: targetId,
            organization_id: 'org-a',
            client_id: 'test-client-1',
            goal_id: 'goal-1',
            name: 'Match peer greeting in 4/5 trials',
            measurement_type: 'correctIncorrect',
            graph_config: {},
            status: 'active',
            sort_order: 0,
            is_current: true,
            current_phase: 'baseline',
            evaluation_window_started_at: '2024-01-01T00:00:00Z',
            progression_version: 7,
            created_by: null,
            updated_by: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ]);
      }
      if (table === 'trial_events') {
        return buildChain([
          {
            id: 'trial-existing',
            organization_id: 'org-a',
            client_id: 'test-client-1',
            session_id: 'session-raw-trials',
            target_id: targetId,
            goal_id: 'goal-1',
            therapist_id: 'test-therapist-1',
            trial_number: 2,
            response: 'correct',
            prompt_type: null,
            prompt_level: null,
            value: null,
            event_timestamp: '2026-03-01T10:05:00.000Z',
            metadata: {},
            created_by: null,
            updated_by: null,
            created_at: '2026-03-01T10:05:00.000Z',
            updated_at: '2026-03-01T10:05:00.000Z',
          },
        ]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        existingSessions={[]}
        session={{
          id: 'session-raw-trials',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: /Use plan target/i }));
    await userEvent.click(screen.getByRole('button', { name: /Increase correct trials for target 1/i }));
    expect(screen.getByTestId('session-modal-save-state')).toHaveTextContent('Unsaved changes.');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();

    fireEvent.change(screen.getByLabelText(/^Per-goal note$/i), {
      target: { value: 'Observed steady progress' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Increase incorrect or no-response trials for target 1/i }));
    await userEvent.click(screen.getByRole('button', { name: /Save skills/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        session_note_trial_events: [
          expect.objectContaining({
            target_id: targetId,
            trial_number: 3,
            response: 'correct',
            expected_progression_version: 7,
            metadata: expect.objectContaining({ source: 'schedule_capture', goal_id: 'goal-1' }),
          }),
          expect.objectContaining({
            target_id: targetId,
            trial_number: 4,
            response: 'incorrect',
            expected_progression_version: 7,
          }),
        ],
      }));
    });
    const submitted = onSubmit.mock.calls[0]?.[0] as {
      session_note_goal_measurements?: Record<string, SessionGoalMeasurementEntry>;
    };
    expect(submitted.session_note_goal_measurements?.['goal-1']?.data.target_trials).toBeNull();
    expect(submitted.session_note_goal_measurements?.['goal-1']?.data.metric_value).toBeNull();
    expect(submitted.session_note_goal_measurements?.['goal-1']?.data.incorrect_trials).toBeNull();
  }, 15000);

  it('renders the configured plan target once before and after selection while keeping active capture controls', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const targetId = '88888888-8888-4888-8888-888888888889';
    const planTarget = 'Match peer greeting in 4/5 trials';
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      if (table === 'goal_targets') {
        return buildChain([
          {
            id: targetId,
            organization_id: 'org-a',
            client_id: 'test-client-1',
            goal_id: 'goal-1',
            name: planTarget,
            measurement_type: 'frequency',
            graph_config: {},
            status: 'active',
            sort_order: 0,
            is_current: true,
            created_by: null,
            updated_by: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ]);
      }
      if (table === 'trial_events') {
        return buildChain([]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        existingSessions={[]}
        session={{
          id: 'session-plan-target-dedup',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />,
    );

    const planTargetButton = await screen.findByRole('button', { name: /Use plan target/i });
    expect(planTargetButton).toHaveTextContent(planTarget);
    expect(screen.getAllByText(planTarget)).toHaveLength(1);
    expect(screen.queryByText('No target selected')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plan target selected/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Increase correct trials for target 1/i })).not.toBeInTheDocument();

    await userEvent.click(planTargetButton);

    expect(screen.queryByRole('button', { name: /Use plan target/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plan target selected/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(planTarget)).toHaveLength(1);
    expect(screen.getByLabelText(/Frequency value for target 1 \(count\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add frequency trial for target 1/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Prompts & reactions for target 1/i)).toBeInTheDocument();
  }, 15000);

  it('submits configured duration target values as raw trial values with units', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const targetId = '88888888-8888-4888-8888-888888888881';
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals.map((goal) =>
          goal.id === 'goal-1' ? { ...goal, measurement_type: 'duration' } : goal,
        ));
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      if (table === 'goal_targets') {
        return buildChain([
          {
            id: targetId,
            organization_id: 'org-a',
            client_id: 'test-client-1',
            goal_id: 'goal-1',
            name: 'Match peer greeting in 4/5 trials',
            measurement_type: 'duration',
            graph_config: {},
            status: 'active',
            sort_order: 0,
            is_current: true,
            created_by: null,
            updated_by: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ]);
      }
      if (table === 'trial_events') {
        return buildChain([]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        existingSessions={[]}
        session={{
          id: 'session-duration-trials',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: /Use plan target/i }));
    expect(screen.queryByRole('checkbox', {
      name: /Prompted response was correct for target 1/i,
    })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: /Record full verbal prompt for target 1/i,
    })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Per-goal note$/i), {
      target: { value: 'Duration observed' },
    });
    fireEvent.change(screen.getByLabelText(/Duration value for target 1 \(minutes\)/i), {
      target: { value: '12.5' },
    });
    fireEvent.change(screen.getByLabelText(/Prompts & reactions for target 1/i), {
      target: { value: 'Timer started after verbal prompt' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Add duration trial for target 1/i }));
    await userEvent.click(screen.getByRole('button', { name: /Save skills/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        session_note_trial_events: [
          expect.objectContaining({
            target_id: targetId,
            trial_number: 1,
            value: 12.5,
          }),
        ],
      }));
    });
    const submitted = onSubmit.mock.calls[0]?.[0] as {
      session_note_goal_measurements?: Record<string, SessionGoalMeasurementEntry>;
    };
    expect(submitted.session_note_goal_measurements?.['goal-1']?.data.measurement_type).toBe('duration');
    expect(submitted.session_note_goal_measurements?.['goal-1']?.data.target_trials).toBeNull();
    expect(submitted.session_note_goal_measurements?.['goal-1']?.data.trial_prompt_note)
      .toBe('Timer started after verbal prompt');
  }, 15000);

  it('warns before closing when a numeric raw-trial value is typed but not added', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const targetId = '88888888-8888-4888-8888-888888888883';
    const targetName = 'Match peer greeting in 4/5 trials';
    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'linked-note-duration-draft',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: ['Default Goal'],
      goal_ids: ['goal-1'],
      goal_measurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'duration',
            metric_label: 'Duration',
            metric_unit: 'minutes',
            targets: [targetName],
            target: targetName,
            target_trials: [{
              target: targetName,
              metric_value: null,
              incorrect_trials: null,
              opportunities: null,
              trial_prompt_note: null,
            }],
          },
        },
      },
      goal_notes: { 'goal-1': '' },
      session_id: 'session-duration-draft',
      narrative: '',
      is_locked: false,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: null,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T09:00:00.000Z',
    });
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals.map((goal) =>
          goal.id === 'goal-1' ? { ...goal, measurement_type: 'duration' } : goal,
        ));
      }
      if (table === 'authorizations') {
        return buildChain([{ id: 'auth-1', authorization_number: 'AUTH-001', services: [{ service_code: '97153' }] }]);
      }
      if (table === 'goal_targets') {
        return buildChain([
          {
            id: targetId,
            organization_id: 'org-a',
            client_id: 'test-client-1',
            goal_id: 'goal-1',
            name: targetName,
            measurement_type: 'duration',
            graph_config: {},
            status: 'active',
            sort_order: 0,
            is_current: true,
            created_by: null,
            updated_by: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ]);
      }
      if (table === 'trial_events') {
        return buildChain([]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        existingSessions={[]}
        session={{
          id: 'session-duration-draft',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />,
    );

    fireEvent.change(await screen.findByLabelText(/Duration value for target 1 \(minutes\)/i), {
      target: { value: '12.5' },
    });
    expect(screen.getByTestId('session-modal-save-state')).toHaveTextContent('Unsaved changes.');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  }, 15000);

  it('does not record blank numeric raw trials but accepts explicit zero values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const targetId = '88888888-8888-4888-8888-888888888884';
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals.map((goal) =>
          goal.id === 'goal-1' ? { ...goal, measurement_type: 'duration' } : goal,
        ));
      }
      if (table === 'authorizations') {
        return buildChain([{ id: 'auth-1', authorization_number: 'AUTH-001', services: [{ service_code: '97153' }] }]);
      }
      if (table === 'goal_targets') {
        return buildChain([
          {
            id: targetId,
            organization_id: 'org-a',
            client_id: 'test-client-1',
            goal_id: 'goal-1',
            name: 'Match peer greeting in 4/5 trials',
            measurement_type: 'duration',
            graph_config: {},
            status: 'active',
            sort_order: 0,
            is_current: true,
            created_by: null,
            updated_by: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ]);
      }
      if (table === 'trial_events') {
        return buildChain([]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        existingSessions={[]}
        session={{
          id: 'session-duration-blank-trial',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: /Use plan target/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add duration trial for target 1/i }));
    expect(screen.getByText('0 trials · total 0')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Duration value for target 1 \(minutes\)/i), {
      target: { value: '0' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Add duration trial for target 1/i }));
    expect(screen.getByText('1 trials · total 0')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  }, 15000);

  it('records prompt-specific trials as raw trial events', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const targetId = '88888888-8888-4888-8888-888888888882';
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals.map((goal) =>
          goal.id === 'goal-1' ? { ...goal, measurement_type: 'taskAnalysis' } : goal,
        ));
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      if (table === 'goal_targets') {
        return buildChain([
          {
            id: targetId,
            organization_id: 'org-a',
            client_id: 'test-client-1',
            goal_id: 'goal-1',
            name: 'Match peer greeting in 4/5 trials',
            measurement_type: 'taskAnalysis',
            graph_config: {},
            status: 'active',
            sort_order: 0,
            is_current: true,
            current_phase: 'baseline',
            evaluation_window_started_at: '2024-01-01T00:00:00Z',
            progression_version: 7,
            created_by: null,
            updated_by: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ]);
      }
      if (table === 'trial_events') {
        return buildChain([
          {
            id: 'trial-existing-prompt',
            organization_id: 'org-a',
            client_id: 'test-client-1',
            session_id: 'session-task-analysis-trials',
            target_id: targetId,
            goal_id: 'goal-1',
            therapist_id: 'test-therapist-1',
            trial_number: 4,
            response: 'correct',
            prompt_type: null,
            prompt_level: null,
            value: null,
            event_timestamp: '2026-03-01T10:05:00.000Z',
            metadata: {},
            created_by: null,
            updated_by: null,
            created_at: '2026-03-01T10:05:00.000Z',
            updated_at: '2026-03-01T10:05:00.000Z',
          },
        ]);
      }
      return buildChain([]);
    });

    const session = {
      id: 'session-task-analysis-trials',
      therapist_id: 'test-therapist-1',
      client_id: 'test-client-1',
      program_id: 'program-1',
      goal_id: 'goal-1',
      start_time: '2026-03-01T10:00:00.000Z',
      end_time: '2026-03-01T11:00:00.000Z',
      status: 'in_progress',
      notes: '',
      created_at: '2026-03-01T09:00:00.000Z',
      created_by: null,
      updated_at: '2026-03-01T09:00:00.000Z',
      updated_by: null,
      started_at: null,
    } satisfies Session;
    const { rerender } = renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        existingSessions={[]}
        session={session}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: /Use plan target/i }));
    fireEvent.change(screen.getByLabelText(/^Per-goal note$/i), {
      target: { value: 'Task analysis observed' },
    });
    const promptLabels = [
      'Full verbal',
      'Partial verbal',
      'Gesture',
      'Model',
      'Visual',
      'Full physical',
      'Partial physical',
    ];
    for (const label of promptLabels) {
      expect(screen.getByRole('button', {
        name: new RegExp(`Record ${label.toLowerCase()} prompt for target 1`, 'i'),
      })).toBeInTheDocument();
    }

    const noResponseOutcome = screen.getByRole('radio', {
      name: /^No response for target 1:/i,
    });
    const correctOutcome = screen.getByRole('radio', {
      name: /^Correct for target 1:/i,
    });
    expect(correctOutcome).toBeChecked();
    expect(correctOutcome.closest('label')).toHaveClass('bg-emerald-600');
    expect(screen.getByText('Prompt outcome')).toBeInTheDocument();

    await userEvent.click(noResponseOutcome);
    expect(noResponseOutcome).toBeChecked();
    expect(noResponseOutcome.closest('label')).toHaveClass('bg-amber-500');
    rerender(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        existingSessions={[]}
        session={{ ...session, id: 'session-task-analysis-trials-next' }}
      />,
    );
    await waitFor(() => expect(screen.getByRole('radio', {
      name: /^Correct for target 1:/i,
    })).toBeChecked());

    await userEvent.click(screen.getByRole('button', { name: /Record independent response for target 1/i }));
    await userEvent.click(screen.getByRole('button', { name: /Record prompted response for target 1/i }));
    for (const label of promptLabels.slice(0, -1)) {
      await userEvent.click(screen.getByRole('button', {
        name: new RegExp(`Record ${label.toLowerCase()} prompt for target 1`, 'i'),
      }));
    }
    await userEvent.click(noResponseOutcome);
    await userEvent.click(screen.getByRole('button', {
      name: /Record partial physical prompt for target 1/i,
    }));
    expect(screen.getByText('+9 · −1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Save skills/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        session_note_trial_events: expect.any(Array),
      }));
    });
    const submitted = onSubmit.mock.calls[0]?.[0] as {
      session_note_trial_events?: Array<Record<string, unknown>>;
      session_note_goal_measurements?: Record<string, SessionGoalMeasurementEntry>;
    };
    expect(submitted.session_note_trial_events).toEqual([
      expect.objectContaining({ target_id: targetId, trial_number: 5, response: 'independent', expected_progression_version: 7 }),
      expect.objectContaining({ target_id: targetId, trial_number: 6, response: 'prompted', expected_progression_version: 7 }),
      expect.objectContaining({ target_id: targetId, trial_number: 7, response: 'correct', prompt_type: 'verbal', prompt_level: 'full', expected_progression_version: 7 }),
      expect.objectContaining({ target_id: targetId, trial_number: 8, response: 'correct', prompt_type: 'verbal', prompt_level: 'partial', expected_progression_version: 7 }),
      expect.objectContaining({ target_id: targetId, trial_number: 9, response: 'correct', prompt_type: 'gesture', prompt_level: null, expected_progression_version: 7 }),
      expect.objectContaining({ target_id: targetId, trial_number: 10, response: 'correct', prompt_type: 'model', prompt_level: null, expected_progression_version: 7 }),
      expect.objectContaining({ target_id: targetId, trial_number: 11, response: 'correct', prompt_type: 'visual', prompt_level: null, expected_progression_version: 7 }),
      expect.objectContaining({ target_id: targetId, trial_number: 12, response: 'correct', prompt_type: 'physical', prompt_level: 'full', expected_progression_version: 7 }),
      expect.objectContaining({ target_id: targetId, trial_number: 13, response: 'noResponse', prompt_type: 'physical', prompt_level: 'partial', expected_progression_version: 7 }),
    ]);
    expect(submitted.session_note_trial_events?.[0]).not.toHaveProperty('prompt_type');
    expect(submitted.session_note_trial_events?.[0]).not.toHaveProperty('prompt_level');
    expect(submitted.session_note_trial_events?.[1]).not.toHaveProperty('prompt_type');
    expect(submitted.session_note_trial_events?.[1]).not.toHaveProperty('prompt_level');
    expect(submitted.session_note_goal_measurements?.['goal-1']?.data.measurement_type).toBe('taskAnalysis');
  }, 15000);

  it.each(['scheduled', 'in_progress'] as const)(
    'shows prompt outcome controls during %s BT data-collection capture',
    async (status) => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const targetId = '88888888-8888-4888-8888-8888888888bt';
      const buildChain = (rows: unknown[], singleRow: unknown = null) => {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: rows, error: null })),
          maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'programs') {
          return buildChain(mockPrograms);
        }
        if (table === 'goals') {
          return buildChain(mockGoals.map((goal) =>
            goal.id === 'goal-1' ? { ...goal, measurement_type: 'taskAnalysis' } : goal,
          ));
        }
        if (table === 'authorizations') {
          return buildChain([
            {
              id: 'auth-1',
              authorization_number: 'AUTH-001',
              services: [{ service_code: '97153' }],
            },
          ]);
        }
        if (table === 'goal_targets') {
          return buildChain([
            {
              id: targetId,
              organization_id: 'org-a',
              client_id: 'test-client-1',
              goal_id: 'goal-1',
              name: 'Match peer greeting in 4/5 trials',
              measurement_type: 'taskAnalysis',
              graph_config: {},
              status: 'active',
              sort_order: 0,
              is_current: true,
              current_phase: 'baseline',
              evaluation_window_started_at: '2024-01-01T00:00:00Z',
              progression_version: 7,
              created_by: null,
              updated_by: null,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ]);
        }
        if (table === 'trial_events') {
          return buildChain([]);
        }
        return buildChain([]);
      });

      const session = {
        id: `session-task-analysis-bt-capture-${status}`,
        therapist_id: 'test-therapist-1',
        client_id: 'test-client-1',
        program_id: 'program-1',
        goal_id: 'goal-1',
        start_time: '2026-03-01T10:00:00.000Z',
        end_time: '2026-03-01T11:00:00.000Z',
        status,
        notes: '',
        created_at: '2026-03-01T09:00:00.000Z',
        created_by: null,
        updated_at: '2026-03-01T09:00:00.000Z',
        updated_by: null,
        started_at: status === 'in_progress' ? '2026-03-01T10:00:00.000Z' : null,
      } satisfies Session;
      const { rerender } = renderWithProviders(
        <SessionModal
          {...defaultProps}
          onSubmit={onSubmit}
          existingSessions={[]}
          dataCollectionOnly
          session={session}
        />,
      );

      await expandClinicalDetails();
      await userEvent.click(await screen.findByRole('button', { name: /Use plan target/i }));

      const correctOutcome = screen.getByRole('radio', {
        name: /^Correct for target 1:/i,
      });
      expect(correctOutcome).toBeChecked();
      expect(screen.getByText('Prompt outcome')).toBeInTheDocument();
      const promptLabels = [
        'full verbal',
        'partial verbal',
        'gesture',
        'model',
        'visual',
        'full physical',
        'partial physical',
      ];
      for (const label of promptLabels) {
        expect(screen.getByRole('button', {
          name: new RegExp(`Record ${label} prompt for target 1`, 'i'),
        })).toBeInTheDocument();
      }
      await userEvent.click(screen.getByRole('button', {
        name: /Record full verbal prompt for target 1/i,
      }));
      expect(screen.getByText('+1 · −0')).toBeInTheDocument();

      rerender(
        <SessionModal
          {...defaultProps}
          onSubmit={onSubmit}
          existingSessions={[]}
          dataCollectionOnly
          session={session}
        />,
      );
      await expandClinicalDetails();
      expect(await screen.findByRole('radio', {
        name: /^Correct for target 1:/i,
      })).toBeChecked();
    },
    15000,
  );

  it('keeps aggregate counts nulled when reopening a raw-trial-backed target without new trial clicks', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const targetId = '88888888-8888-4888-8888-888888888889';
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      if (table === 'goal_targets') {
        return buildChain([
          {
            id: targetId,
            organization_id: 'org-a',
            client_id: 'test-client-1',
            goal_id: 'goal-1',
            name: 'Match peer greeting in 4/5 trials',
            measurement_type: 'correctIncorrect',
            graph_config: {},
            status: 'active',
            sort_order: 0,
            is_current: true,
            created_by: null,
            updated_by: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        ]);
      }
      if (table === 'trial_events') {
        return buildChain([
          {
            id: 'trial-existing-correct',
            organization_id: 'org-a',
            client_id: 'test-client-1',
            session_id: 'session-raw-trials-reopen',
            target_id: targetId,
            goal_id: 'goal-1',
            therapist_id: 'test-therapist-1',
            trial_number: 1,
            response: 'correct',
            prompt_type: null,
            prompt_level: null,
            value: null,
            event_timestamp: '2026-03-01T10:05:00.000Z',
            metadata: {},
            created_by: null,
            updated_by: null,
            created_at: '2026-03-01T10:05:00.000Z',
            updated_at: '2026-03-01T10:05:00.000Z',
          },
          {
            id: 'trial-existing-incorrect',
            organization_id: 'org-a',
            client_id: 'test-client-1',
            session_id: 'session-raw-trials-reopen',
            target_id: targetId,
            goal_id: 'goal-1',
            therapist_id: 'test-therapist-1',
            trial_number: 2,
            response: 'incorrect',
            prompt_type: null,
            prompt_level: null,
            value: null,
            event_timestamp: '2026-03-01T10:06:00.000Z',
            metadata: {},
            created_by: null,
            updated_by: null,
            created_at: '2026-03-01T10:06:00.000Z',
            updated_at: '2026-03-01T10:06:00.000Z',
          },
        ]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        existingSessions={[]}
        session={{
          id: 'session-raw-trials-reopen',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: /Use plan target/i }));
    fireEvent.change(screen.getByLabelText(/^Per-goal note$/i), {
      target: { value: 'Reopened note update' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Save skills/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0]?.[0] as {
      session_note_goal_measurements?: Record<string, SessionGoalMeasurementEntry>;
      session_note_trial_events?: unknown[];
    };
    expect(submitted.session_note_trial_events).toBeUndefined();
    expect(submitted.session_note_goal_measurements?.['goal-1']?.data.target_trials).toBeNull();
    expect(submitted.session_note_goal_measurements?.['goal-1']?.data.metric_value).toBeNull();
    expect(submitted.session_note_goal_measurements?.['goal-1']?.data.incorrect_trials).toBeNull();
  }, 15000);

  it('shows trial controls for live plan goals without a configured target', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-no-plan-target-trials',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-2',
          goal_id: 'goal-2',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await screen.findByText(/No plan target is set for this goal/i);
    expect(screen.getByText('No target selected')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Per-goal note$/i), {
      target: { value: 'Tracked without configured target' },
    });
    const increaseButton = await screen.findByRole('button', {
      name: /Increase correct trials for target 1/i,
    });

    await userEvent.click(increaseButton);

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Increase incorrect or no-response trials for target 1/i }))
      .toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Save skills/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        session_note_goal_notes: {
          'goal-2': 'Tracked without configured target',
        },
        session_note_goal_measurements: {
          'goal-2': {
            version: 1,
            data: expect.objectContaining({
              metric_value: 1,
              targets: null,
              target: null,
              target_trials: [
                {
                  target: null,
                  metric_value: 1,
                  incorrect_trials: null,
                  opportunities: null,
                  trial_prompt_note: null,
                },
              ],
            }),
          },
        },
      }));
    });
  });

  it('preserves saved no-target plan goal labels and trials when resaving', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const savedTarget = 'Existing therapist focus';
    const linkedSessionNote = {
      id: 'linked-note-no-plan-target',
      authorization_id: 'auth-1',
      service_code: '97153',
      narrative: '',
      goal_notes: {
        'goal-2': 'Observed saved no-target trials',
      },
      goal_measurements: {
        'goal-2': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_label: 'Count',
            metric_unit: 'responses',
            targets: [savedTarget],
            target: savedTarget,
            target_trials: [
              {
                target: savedTarget,
                metric_value: 3,
                incorrect_trials: 1,
                opportunities: 4,
                trial_prompt_note: 'Saved no-target prompt note',
              },
            ],
          },
        },
      },
      goal_ids: ['goal-2'],
      goals_addressed: ['Second Goal'],
    };
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'linked-note-no-plan-target',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: linkedSessionNote.goals_addressed,
      goal_ids: linkedSessionNote.goal_ids,
      goal_measurements: linkedSessionNote.goal_measurements as Record<string, unknown>,
      goal_notes: linkedSessionNote.goal_notes,
      session_id: 'session-linked-no-plan-target',
      narrative: linkedSessionNote.narrative,
      is_locked: false,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: null,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T09:00:00.000Z',
    });
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-linked-no-plan-target',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-2',
          goal_id: 'goal-2',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await screen.findByText(/No plan target is set for this goal/i);
    expect(await screen.findByText(savedTarget)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Save progress/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        session_note_goal_measurements: {
          'goal-2': {
            version: 1,
            data: expect.objectContaining({
              metric_value: 3,
              incorrect_trials: 1,
              opportunities: 4,
              targets: [savedTarget],
              target: savedTarget,
              target_trials: [
                expect.objectContaining({
                  target: savedTarget,
                  metric_value: 3,
                  incorrect_trials: 1,
                  opportunities: 4,
                  trial_prompt_note: 'Saved no-target prompt note',
                }),
              ],
              trial_prompt_note: 'Saved no-target prompt note',
            }),
          },
        },
      }));
    });
  }, 10000);

  it('preserves remaining target trials when deleting an earlier target', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        dataCollectionOnly
        session={{
          id: 'session-target-removal',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await screen.findByRole('button', { name: /Use plan target/i });
    fireEvent.change(screen.getByLabelText(/^Per-goal note$/i), {
      target: { value: 'Plan goal context' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Add skill/i }));
    const titleInputs = await screen.findAllByPlaceholderText('Name this target');
    const titleInput = titleInputs.find((input) => input.id.startsWith('adhoc-title-')) ?? titleInputs[0];
    fireEvent.change(titleInput, { target: { value: 'Adhoc skill target' } });
    const perGoalNotes = screen.getAllByLabelText(/^Per-goal note$/i);
    fireEvent.change(perGoalNotes[perGoalNotes.length - 1], {
      target: { value: 'Target B remains in treatment' },
    });
    const targetFields = screen.getAllByLabelText(/^Target$/i);
    fireEvent.change(targetFields[targetFields.length - 1], {
      target: { value: 'Target A' },
    });
    expect(await screen.findByRole('button', {
      name: /Record full verbal prompt for target 1: Target A/i,
    })).toBeInTheDocument();
    expect(screen.getByRole('radio', {
      name: /^Correct for target 1: Target A$/i,
    })).toBeChecked();
    const addTargetButtons = screen.getAllByRole('button', { name: /add target/i });
    await userEvent.click(addTargetButtons[addTargetButtons.length - 1]);
    const secondTargetFields = screen.getAllByLabelText(/^Target 2$/i);
    fireEvent.change(secondTargetFields[secondTargetFields.length - 1], {
      target: { value: 'Target B' },
    });
    const increaseTarget1Buttons = screen.getAllByRole('button', { name: /Increase correct trials for target 1/i });
    await userEvent.click(increaseTarget1Buttons[increaseTarget1Buttons.length - 1]);
    const addFiveTarget2Buttons = screen.getAllByRole('button', { name: /Add 5 correct trials for target 2/i });
    await userEvent.click(addFiveTarget2Buttons[addFiveTarget2Buttons.length - 1]);
    const target1PromptFields = screen.getAllByLabelText(/Prompts & reactions for target 1/i);
    fireEvent.change(target1PromptFields[target1PromptFields.length - 1], {
      target: { value: 'Prompt note A' },
    });
    const target2PromptFields = screen.getAllByLabelText(/Prompts & reactions for target 2/i);
    fireEvent.change(target2PromptFields[target2PromptFields.length - 1], {
      target: { value: 'Prompt note B' },
    });
    expect(screen.queryByText('Correct trials cannot exceed opportunities.')).not.toBeInTheDocument();

    const removeTargetButtons = screen.getAllByRole('button', { name: /Remove target 1/i });
    await userEvent.click(removeTargetButtons[removeTargetButtons.length - 1]);
    const saveSkillsButton = screen.getByRole('button', { name: /Save skills/i });
    expect(saveSkillsButton).toBeEnabled();
    await userEvent.click(saveSkillsButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
      const payload = onSubmit.mock.calls[0]?.[0] as {
        session_note_goal_measurements?: Record<string, unknown>;
      };
      const adhocEntry = Object.entries(payload.session_note_goal_measurements ?? {})
        .find(([goalEntryId]) => goalEntryId.startsWith('adhoc-skill-'))?.[1];
      expect(adhocEntry).toEqual(
        expect.objectContaining({
            version: 1,
            data: expect.objectContaining({
              metric_value: 5,
              targets: ['Target B'],
              target: 'Target B',
              target_trials: [
                {
                  target: 'Target B',
                  metric_value: 5,
                  incorrect_trials: null,
                  opportunities: null,
                  trial_prompt_note: 'Prompt note B',
                },
              ],
              trial_prompt_note: 'Prompt note B',
            }),
        }),
      );
    });
  }, 15000);

  it('submits ad-hoc skill rows when Save skills is clicked during a live session', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-adhoc-save-skills',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    fireEvent.change(await screen.findByLabelText(/^Per-goal note$/i), {
      target: { value: 'Plan goal note' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Add skill/i }));
    const titleInputs = await screen.findAllByPlaceholderText('Name this target');
    const titleInput = titleInputs.find((input) => input.id.startsWith('adhoc-title-')) ?? titleInputs[0];
    fireEvent.change(titleInput, { target: { value: 'Adhoc skill target' } });
    const perGoalNotes = screen.getAllByLabelText(/^Per-goal note$/i);
    fireEvent.change(perGoalNotes[perGoalNotes.length - 1], {
      target: { value: 'Adhoc skill note' },
    });
    await userEvent.click(screen.getAllByRole('button', { name: /Increase correct trials/i }).at(-1)!);

    await userEvent.click(screen.getByTestId('session-modal-save-capture-skills'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        id: 'session-adhoc-save-skills',
        session_note_persist_requested: true,
        session_note_authorization_id: 'auth-1',
        session_note_service_code: '97153',
        session_note_goal_notes: expect.objectContaining({
          'goal-1': 'Plan goal note',
        }),
        session_note_capture_merge_goal_ids: expect.arrayContaining(['goal-1']),
      }));
    });
    const submitted = onSubmit.mock.calls[0][0];
    const adhocId = submitted.session_note_goal_ids.find((id: string) => id.startsWith('adhoc-skill-'));
    expect(adhocId).toBeTruthy();
    expect(submitted.session_note_goal_notes[adhocId]).toBe('Adhoc skill note');
    expect(submitted.session_note_capture_merge_goal_ids).toContain(adhocId);
  }, 10000);

  it('includes +5 trial shortcut in saved correct counts', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-trial-plus-five',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await userEvent.click(await screen.findByRole('button', { name: /Use plan target/i }));
    await screen.findByRole('button', { name: /Add 5 correct trials/i });
    fireEvent.change(screen.getByLabelText(/^Per-goal note$/i), {
      target: { value: 'Bundled trials' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Add 5 correct trials/i }));
    await userEvent.click(screen.getByRole('button', { name: /Increase correct trials/i }));

    await userEvent.click(screen.getByRole('button', { name: /Save progress/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          session_note_goal_measurements: {
            'goal-1': {
              version: 1,
              data: expect.objectContaining({
                metric_value: 6,
              }),
            },
          },
        }),
      );
    });
  }, 10000);

  it('disables subtract-5 correct trials when count is under five', async () => {
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        session={{
          id: 'session-trial-minus-five-disabled',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await userEvent.click(await screen.findByRole('button', { name: /Use plan target/i }));
    await screen.findByRole('button', { name: /Subtract 5 correct trials/i });
    expect(screen.getByRole('button', { name: /Subtract 5 correct trials/i })).toBeDisabled();
  });

  it('normalizes linked legacy goal_measurements payloads on save', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const linkedSessionNote = {
      id: 'linked-note-1',
      authorization_id: 'auth-1',
      service_code: '97153',
      narrative: '',
      goal_notes: {
        'goal-1': 'Observed steady progress',
      },
      goal_measurements: {
        'goal-1': {
          count: 4,
          trials: 5,
          promptLevel: 'Gestural',
        },
      },
      goal_ids: ['goal-1'],
      goals_addressed: ['Default Goal'],
    };

    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'linked-note-legacy-measurements',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: linkedSessionNote.goals_addressed,
      goal_ids: linkedSessionNote.goal_ids,
      goal_measurements: linkedSessionNote.goal_measurements as Record<string, unknown>,
      goal_notes: linkedSessionNote.goal_notes,
      session_id: 'session-linked-legacy-measurements',
      narrative: linkedSessionNote.narrative,
      is_locked: false,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: null,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T09:00:00.000Z',
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockPrograms, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'goals') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockGoals, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'authorizations') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
          order: vi.fn(async () => ({
            data: [{ id: 'auth-1', authorization_number: 'AUTH-001', services: [{ service_code: '97153' }] }],
            error: null,
          })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-linked-legacy-measurements',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Observed steady progress')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Save progress/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        session_note_persist_requested: true,
        session_note_goal_measurements: {
          'goal-1': {
            version: 1,
            data: expect.objectContaining({
              metric_label: 'Count',
              metric_value: 4,
              opportunities: 5,
              prompt_level: 'Gestural',
            }),
          },
        },
      }));
    });
  }, 10000);

  it('filters saved plan-goal targets and persists prompt buttons for legacy capture', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const planTarget = 'Match peer greeting in 4/5 trials';
    const legacyFreeformTarget = 'Legacy freeform target';
    const linkedSessionNote = {
      id: 'linked-note-mixed-plan-targets',
      authorization_id: 'auth-1',
      service_code: '97153',
      narrative: '',
      goal_notes: {
        'goal-1': 'Observed mixed saved targets',
      },
      goal_measurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_label: 'Count',
            metric_unit: 'responses',
            targets: [legacyFreeformTarget, planTarget],
            target: planTarget,
            target_trials: [
              {
                target: legacyFreeformTarget,
                metric_value: 5,
                incorrect_trials: 4,
                opportunities: 9,
                trial_prompt_note: 'Legacy target prompt note',
              },
              {
                target: planTarget,
                metric_value: 4,
                incorrect_trials: 1,
                opportunities: 6,
                trial_prompt_note: 'Plan target prompt note',
              },
            ],
          },
        },
      },
      goal_ids: ['goal-1'],
      goals_addressed: ['Default Goal'],
    };

    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'linked-note-mixed-plan-targets',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: linkedSessionNote.goals_addressed,
      goal_ids: linkedSessionNote.goal_ids,
      goal_measurements: linkedSessionNote.goal_measurements as Record<string, unknown>,
      goal_notes: linkedSessionNote.goal_notes,
      session_id: 'session-linked-mixed-plan-targets',
      narrative: linkedSessionNote.narrative,
      is_locked: false,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: null,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T09:00:00.000Z',
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockPrograms, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'goals') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockGoals, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'authorizations') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
          order: vi.fn(async () => ({
            data: [{ id: 'auth-1', authorization_number: 'AUTH-001', services: [{ service_code: '97153' }] }],
            error: null,
          })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-linked-mixed-plan-targets',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Observed mixed saved targets')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /Use plan target/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plan target selected/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(planTarget)).toHaveLength(1);
    expect(screen.queryByText(legacyFreeformTarget)).not.toBeInTheDocument();

    const noResponseOutcome = screen.getByRole('radio', {
      name: /^No response for target 1:/i,
    });
    expect(screen.getByRole('radio', { name: /^Correct for target 1:/i })).toBeChecked();
    for (const label of ['full verbal', 'partial verbal', 'gesture', 'model', 'visual', 'full physical', 'partial physical']) {
      expect(screen.getByRole('button', {
        name: new RegExp(`Record ${label} prompt for target 1`, 'i'),
      })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', {
      name: /Record full verbal prompt for target 1/i,
    }));
    const subtractFiveCorrect = screen.getByRole('button', {
      name: /Subtract 5 correct trials for target 1/i,
    });
    expect(subtractFiveCorrect).toBeEnabled();
    await userEvent.click(subtractFiveCorrect);
    await userEvent.click(screen.getByRole('button', {
      name: /Record full verbal prompt for target 1/i,
    }));
    await userEvent.click(noResponseOutcome);
    await userEvent.click(screen.getByRole('button', {
      name: /Record gesture prompt for target 1/i,
    }));
    await userEvent.click(screen.getByRole('button', { name: /Increase correct trials for target 1/i }));
    fireEvent.change(screen.getByLabelText(/Prompts & reactions for target 1/i), {
      target: { value: 'Edited plan target prompt note' },
    });

    await userEvent.click(screen.getByRole('button', { name: /Save progress/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        session_note_persist_requested: true,
        session_note_goal_measurements: {
          'goal-1': {
            version: 1,
            data: expect.objectContaining({
              metric_value: 2,
              incorrect_trials: 2,
              opportunities: 6,
              targets: [planTarget],
              target: planTarget,
              target_trials: [
                expect.objectContaining({
                  target: planTarget,
                  metric_value: 2,
                  incorrect_trials: 2,
                  opportunities: 6,
                  trial_prompt_note: 'Edited plan target prompt note',
                  prompt_counts: [
                    { prompt_type: 'verbal', prompt_level: 'full', correct_trials: 1, incorrect_trials: 0 },
                    { prompt_type: 'gesture', prompt_level: null, correct_trials: 0, incorrect_trials: 0, no_response_trials: 1 },
                  ],
                }),
              ],
              trial_prompt_note: 'Edited plan target prompt note',
            }),
          },
        },
      }));
    });
    const submitted = onSubmit.mock.calls[0]?.[0] as { session_note_trial_events?: unknown[] };
    expect(submitted.session_note_trial_events ?? []).toEqual([]);
  }, 10000);

  it('keeps a blank persisted plan-target evidence row visible and bindable when legacy target strings are missing', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const planTarget = 'Match peer greeting in 4/5 trials';
    const targetId = '88888888-8888-4888-8888-888888888890';
    const linkedSessionNote = {
      id: 'linked-note-blank-plan-target-evidence',
      authorization_id: 'auth-1',
      service_code: '97153',
      narrative: '',
      goal_notes: {
        'goal-1': 'Observed saved evidence without a stored target label',
      },
      goal_measurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_label: 'Count',
            metric_unit: 'responses',
            target_trials: [
              {
                metric_value: 4,
                incorrect_trials: 1,
                opportunities: 6,
                trial_prompt_note: 'Persisted blank target row note',
              },
            ],
          },
        },
      },
      goal_ids: ['goal-1'],
      goals_addressed: ['Default Goal'],
    };

    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'linked-note-blank-plan-target-evidence',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: linkedSessionNote.goals_addressed,
      goal_ids: linkedSessionNote.goal_ids,
      goal_measurements: linkedSessionNote.goal_measurements as Record<string, unknown>,
      goal_notes: linkedSessionNote.goal_notes,
      session_id: 'session-linked-blank-plan-target-evidence',
      narrative: linkedSessionNote.narrative,
      is_locked: false,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: null,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T09:00:00.000Z',
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockPrograms, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'goals') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockGoals, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'authorizations') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({
            data: [{ id: 'auth-1', authorization_number: 'AUTH-001', services: [{ service_code: '97153' }] }],
            error: null,
          })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'goal_targets') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({
            data: [{
              id: targetId,
              organization_id: 'org-a',
              client_id: 'test-client-1',
              goal_id: 'goal-1',
              name: planTarget,
              measurement_type: 'frequency',
              graph_config: {},
              status: 'active',
              sort_order: 0,
              is_current: true,
              created_by: null,
              updated_by: null,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            }],
            error: null,
          })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-linked-blank-plan-target-evidence',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Observed saved evidence without a stored target label')).toBeInTheDocument();
    });

    const planTargetButton = screen.getByRole('button', { name: /Use plan target/i });
    expect(planTargetButton).toHaveTextContent(planTarget);
    expect(screen.queryByRole('button', { name: /Plan target selected/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(planTarget)).toHaveLength(1);
    expect(screen.getByText('No target selected')).toBeInTheDocument();
    expect(screen.getByText(/\+4 · −1/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Prompts & reactions for target 1/i)).toHaveValue('Persisted blank target row note');
    expect(screen.getByRole('button', { name: /Increase correct trials for target 1/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Frequency value for target 1 \(count\)/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add frequency trial for target 1/i })).not.toBeInTheDocument();

    await userEvent.click(planTargetButton);

    expect(screen.queryByRole('button', { name: /Use plan target/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(planTarget)).toHaveLength(1);
    expect(screen.queryByText('No target selected')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Prompts & reactions for target 1/i)).toHaveValue('Persisted blank target row note');
    expect(screen.getByLabelText(/Frequency value for target 1 \(count\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add frequency trial for target 1/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Save progress/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        session_note_persist_requested: true,
        session_note_goal_measurements: {
          'goal-1': {
            version: 1,
            data: expect.objectContaining({
              metric_value: 4,
              incorrect_trials: 1,
              opportunities: 6,
              targets: [planTarget],
              target: planTarget,
              target_trials: [
                expect.objectContaining({
                  target: planTarget,
                  metric_value: 4,
                  incorrect_trials: 1,
                  opportunities: 6,
                  trial_prompt_note: 'Persisted blank target row note',
                }),
              ],
              trial_prompt_note: 'Persisted blank target row note',
            }),
          },
        },
      }));
    });
  }, 10000);

  it('treats explicit zero blank plan-target trial values as persisted evidence', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const planTarget = 'Match peer greeting in 4/5 trials';
    const targetId = '88888888-8888-4888-8888-888888888891';
    const linkedSessionNote = {
      id: 'linked-note-blank-plan-target-zero-evidence',
      authorization_id: 'auth-1',
      service_code: '97153',
      narrative: '',
      goal_notes: {
        'goal-1': 'Observed saved zero evidence without a stored target label',
      },
      goal_measurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_label: 'Count',
            metric_unit: 'responses',
            target_trials: [
              {
                metric_value: 0,
                incorrect_trials: 0,
                opportunities: 0,
              },
            ],
          },
        },
      },
      goal_ids: ['goal-1'],
      goals_addressed: ['Default Goal'],
    };

    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'linked-note-blank-plan-target-zero-evidence',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: linkedSessionNote.goals_addressed,
      goal_ids: linkedSessionNote.goal_ids,
      goal_measurements: linkedSessionNote.goal_measurements as Record<string, unknown>,
      goal_notes: linkedSessionNote.goal_notes,
      session_id: 'session-linked-blank-plan-target-zero-evidence',
      narrative: linkedSessionNote.narrative,
      is_locked: false,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: null,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T09:00:00.000Z',
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockPrograms, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'goals') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockGoals, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'authorizations') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({
            data: [{ id: 'auth-1', authorization_number: 'AUTH-001', services: [{ service_code: '97153' }] }],
            error: null,
          })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'goal_targets') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({
            data: [{
              id: targetId,
              organization_id: 'org-a',
              client_id: 'test-client-1',
              goal_id: 'goal-1',
              name: planTarget,
              measurement_type: 'frequency',
              graph_config: {},
              status: 'active',
              sort_order: 0,
              is_current: true,
              created_by: null,
              updated_by: null,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            }],
            error: null,
          })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-linked-blank-plan-target-zero-evidence',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Observed saved zero evidence without a stored target label')).toBeInTheDocument();
    });

    const planTargetButton = screen.getByRole('button', { name: /Use plan target/i });
    expect(planTargetButton).toHaveTextContent(planTarget);
    expect(screen.getByText('No target selected')).toBeInTheDocument();
    expect(screen.getByText(/\+0 · −0/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Frequency value for target 1 \(count\)/i)).not.toBeInTheDocument();
  }, 10000);

  it('shows inline trial bounds validation and blocks save progress when correct trials exceed opportunities', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const planTarget = 'Match peer greeting in 4/5 trials';
    const linkedSessionNote = {
      id: 'linked-note-over-bounds-target',
      authorization_id: 'auth-1',
      service_code: '97153',
      narrative: '',
      goal_notes: {
        'goal-1': 'Observed target trials',
      },
      goal_measurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_label: 'Count',
            metric_unit: 'responses',
            targets: [planTarget],
            target: planTarget,
            metric_value: 8,
            incorrect_trials: 0,
            opportunities: 7,
            target_trials: [
              {
                target: planTarget,
                metric_value: 8,
                incorrect_trials: 0,
                opportunities: 7,
              },
            ],
          },
        },
      },
      goal_ids: ['goal-1'],
      goals_addressed: ['Default Goal'],
    };

    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'linked-note-over-bounds-target',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: linkedSessionNote.goals_addressed,
      goal_ids: linkedSessionNote.goal_ids,
      goal_measurements: linkedSessionNote.goal_measurements as Record<string, unknown>,
      goal_notes: linkedSessionNote.goal_notes,
      session_id: 'session-linked-over-bounds-target',
      narrative: linkedSessionNote.narrative,
      is_locked: false,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: null,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T09:00:00.000Z',
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const buildChain = (rows: unknown[]) => {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: rows, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      };
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([{ id: 'auth-1', authorization_number: 'AUTH-001', services: [{ service_code: '97153' }] }]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-linked-over-bounds-target',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Observed target trials')).toBeInTheDocument();
    });

    expect(await screen.findByText('Correct trials cannot exceed opportunities.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Save progress/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  }, 10000);

  it('does not block Save skills for an out-of-scope behavior row with trial bounds errors', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const behaviorGoalId = 'adhoc-bx-550e8400-e29b-41d4-a716-446655440000';
    const linkedSessionNote = {
      id: 'linked-note-partial-save-bounds',
      authorization_id: 'auth-1',
      service_code: '97153',
      narrative: '',
      goal_notes: {
        'goal-1': 'Skill target remains in progress',
        [behaviorGoalId]: 'Behavior target stays on the BX tab',
      },
      goal_measurements: {
        [behaviorGoalId]: {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_label: 'Count',
            metric_unit: 'responses',
            targets: ['Behavior target'],
            target: 'Behavior target',
            metric_value: 8,
            incorrect_trials: 0,
            opportunities: 7,
            target_trials: [
              {
                target: 'Behavior target',
                metric_value: 8,
                incorrect_trials: 0,
                opportunities: 7,
              },
            ],
          },
        },
      },
      goal_ids: ['goal-1', behaviorGoalId],
      goals_addressed: ['Default Goal', 'Behavior target'],
    };

    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'linked-note-partial-save-bounds',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: linkedSessionNote.goals_addressed,
      goal_ids: linkedSessionNote.goal_ids,
      goal_measurements: linkedSessionNote.goal_measurements as Record<string, unknown>,
      goal_notes: linkedSessionNote.goal_notes,
      session_id: 'session-linked-partial-save-bounds',
      narrative: linkedSessionNote.narrative,
      is_locked: false,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: null,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T09:00:00.000Z',
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const buildChain = (rows: unknown[]) => {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: rows, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      };
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([{ id: 'auth-1', authorization_number: 'AUTH-001', services: [{ service_code: '97153' }] }]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-linked-partial-save-bounds',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Skill target remains in progress')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Save skills/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
  }, 10000);

  it('preserves linked note measurements for drifted saved goals when saving', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const linkedSessionNote = {
      id: 'linked-note-drifted-goals',
      authorization_id: 'auth-1',
      service_code: '97153',
      narrative: '',
      goal_notes: {
        'goal-1': 'Observed steady progress',
        'goal-legacy': 'Maintained prior skill with faded prompts',
      },
      goal_measurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_label: 'Count',
            metric_unit: 'responses',
            metric_value: 4,
          },
        },
        'goal-legacy': {
          count: 2,
          promptLevel: 'Independent',
          note: 'Legacy goal stayed stable',
        },
      },
      goal_ids: ['goal-1', 'goal-legacy'],
      goals_addressed: ['Default Goal', 'Legacy Goal'],
    };

    vi.mocked(fetchLinkedClientSessionNoteForSession).mockResolvedValue({
      id: 'linked-note-drifted-goals',
      date: '2026-03-01',
      start_time: '10:00:00',
      end_time: '11:00:00',
      service_code: '97153',
      therapist_id: 'test-therapist-1',
      therapist_name: 'Test Therapist 1',
      goals_addressed: linkedSessionNote.goals_addressed,
      goal_ids: linkedSessionNote.goal_ids,
      goal_measurements: linkedSessionNote.goal_measurements as Record<string, unknown>,
      goal_notes: linkedSessionNote.goal_notes,
      session_id: 'session-linked-drifted-goals',
      narrative: linkedSessionNote.narrative,
      is_locked: false,
      client_id: 'test-client-1',
      authorization_id: 'auth-1',
      organization_id: 'org-a',
      session_duration: 60,
      signed_at: null,
      created_at: '2026-03-01T09:00:00.000Z',
      updated_at: '2026-03-01T09:00:00.000Z',
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockPrograms, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'goals') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockGoals, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'authorizations') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
          order: vi.fn(async () => ({
            data: [{ id: 'auth-1', authorization_number: 'AUTH-001', services: [{ service_code: '97153' }] }],
            error: null,
          })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-linked-drifted-goals',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Maintained prior skill with faded prompts')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Save progress/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        goal_ids: ['goal-1'],
        session_note_goal_ids: ['goal-1', 'goal-legacy'],
        session_note_goal_measurements: {
          'goal-1': {
            version: 1,
            data: expect.objectContaining({
              metric_value: 4,
            }),
          },
          'goal-legacy': {
            version: 1,
            data: expect.objectContaining({
              metric_label: 'Count',
              metric_value: 2,
              prompt_level: 'Independent',
              note: 'Legacy goal stayed stable',
            }),
          },
        },
      }));
    });
  }, 10000);

  it('blocks submit when session capture is present without authorization metadata', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'sessions') {
        return buildChain([], {
          program_id: 'program-1',
          goal_id: 'goal-1',
          started_at: null,
        });
      }
      if (table === 'session_goals') {
        return buildChain([{ goal_id: 'goal-1' }]);
      }
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([]);
      }
      if (table === 'client_session_notes') {
        return buildChain([]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-clinical-validation',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    fireEvent.change(await screen.findByLabelText(/^Per-goal note$/i), {
      target: { value: 'Progress details' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Save progress/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not call onSessionStarted when startSessionFromModal rejects', async () => {
    vi.mocked(startSessionFromModal).mockRejectedValue(new Error('RPC failure'));
    const onSessionStarted = vi.fn();

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSessionStarted={onSessionStarted}
        dataCollectionOnly
        allowStartSession
        session={{
          id: 'session-fail-start',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    const startButton = await screen.findByRole('button', { name: /Start Session/i });
    await waitFor(() => expect(startButton).not.toBeDisabled());
    await userEvent.click(startButton);

    await waitFor(() => {
      expect(vi.mocked(startSessionFromModal)).toHaveBeenCalledOnce();
    });
    expect(onSessionStarted).not.toHaveBeenCalled();
    expect(defaultProps.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(toastMocks.showError).toHaveBeenCalledWith('RPC failure');
  });
});
