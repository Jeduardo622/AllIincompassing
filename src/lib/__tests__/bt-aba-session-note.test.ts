import { describe, expect, it } from 'vitest';

import {
  BT_ABA_BEHAVIOR_STRATEGY_OPTIONS,
  BT_ABA_FIELD_LABELS,
  BT_ABA_PURPOSE_OPTIONS,
  BT_ABA_SKILL_STRATEGY_OPTIONS,
  BT_ABA_SUPERVISOR_SUPPORT_OPTIONS,
  normalizeExclusiveSelections,
  validateBtAbaSessionNoteResponses,
  type BtAbaSessionNoteResponses,
} from '../bt-aba-session-note';

const validResponses = (
  overrides: Partial<BtAbaSessionNoteResponses> = {},
): BtAbaSessionNoteResponses => ({
  purpose_of_session: ['RBT/BT worked on goals as stated in the treatment plan'],
  client_status: 'Client was ready to participate.',
  skill_strategies: ['Discrete trial training'],
  behavior_strategies: ['Differential Reinforcement'],
  supervisor_support: ['Supervisor did not attend this session'],
  progress_toward_goals: 'Client made progress toward treatment goals.',
  client_response_to_treatment: 'Client responded positively to treatment.',
  data_point_scope: 'linked',
  link_unlinked_data: false,
  bt_signature: { method: 'typed', value: 'Behavior Technician' },
  ...overrides,
});

describe('BT ABA session note contract', () => {
  it('exports the canonical option values seeded by the approved template', () => {
    expect(BT_ABA_PURPOSE_OPTIONS).toEqual([
      'RBT/BT worked on goals as stated in the treatment plan',
      'RBT/BT worked on pairing self with reinforcers',
      'Other',
    ]);
    expect(BT_ABA_SKILL_STRATEGY_OPTIONS).toEqual([
      'Role playing or modeling',
      'Generalization training',
      'Natural environment teaching',
      'Discrete trial training',
      'Shaping/Chaining',
      'Providing support with prompt fading',
      'Behavior Momentum',
      'Other',
      'N/A',
    ]);
    expect(BT_ABA_BEHAVIOR_STRATEGY_OPTIONS).toEqual([
      'Modeling',
      'Verbal reminders provided',
      'Contingent rewards/reinforcers',
      'Guided Compliance',
      'First/Then statements',
      'Visual supports',
      'Differential Reinforcement',
      'Other',
      'N/A',
    ]);
    expect(BT_ABA_SUPERVISOR_SUPPORT_OPTIONS).toEqual([
      'Supervisor did not attend this session',
      'Problem-solved concerns',
      'Supervisor provided some direct support',
      'Modeled strategies/interventions',
      'Discussed programs/progress/data collection',
      'Other',
    ]);
    expect(BT_ABA_FIELD_LABELS).toMatchObject({
      purpose_of_session: 'Purpose of Session',
      purpose_other: 'Describe Other',
      skill_strategies_other: 'Describe Other Skill Strategy',
      behavior_strategies_other: 'Describe Other Behavior Strategy',
      supervisor_support_other: 'Describe Other Supervisor Support',
      progress_toward_goals: 'Summary of Progress Toward Treatment Goals',
      client_response_to_treatment: "Client's Response to Treatment",
      bt_signature: 'Behavior Technician Signature',
    });
  });

  it('requires every clinical closeout section and BT signature', () => {
    expect(validateBtAbaSessionNoteResponses({}).success).toBe(false);
  });

  it('requires Other narratives and makes N/A exclusive', () => {
    const responses = validResponses({
      skill_strategies: ['N/A', 'Discrete trial training'],
      skill_strategies_other: '',
    });

    expect(validateBtAbaSessionNoteResponses(responses).success).toBe(false);
    expect(normalizeExclusiveSelections(['N/A', 'Discrete trial training'], 'N/A')).toEqual(['N/A']);
  });

  it('accepts a complete response and trims narrative values', () => {
    const result = validateBtAbaSessionNoteResponses(validResponses({
      client_status: '  Client was ready to participate.  ',
      progress_toward_goals: '  Made measurable progress.  ',
      client_response_to_treatment: '  Responded positively.  ',
      bt_signature: { method: 'typed', value: '  Behavior Technician  ' },
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.client_status).toBe('Client was ready to participate.');
      expect(result.data.progress_toward_goals).toBe('Made measurable progress.');
      expect(result.data.client_response_to_treatment).toBe('Responded positively.');
      expect(result.data.bt_signature.value).toBe('Behavior Technician');
    }
  });

  it.each(['progress_toward_goals', 'client_response_to_treatment'] as const)(
    'rejects a blank required narrative for %s',
    (field) => {
      expect(validateBtAbaSessionNoteResponses(validResponses({ [field]: '   ' })).success).toBe(false);
    },
  );

  it('requires a valid data-point scope and explicit link-unlinked-data choice', () => {
    const missingScope = { ...validResponses(), data_point_scope: undefined };
    const missingLinkChoice = { ...validResponses(), link_unlinked_data: undefined };
    expect(validateBtAbaSessionNoteResponses(missingScope).success).toBe(false);
    expect(validateBtAbaSessionNoteResponses(missingLinkChoice).success).toBe(false);
    expect(validateBtAbaSessionNoteResponses(validResponses({ data_point_scope: 'all', link_unlinked_data: true })).success).toBe(true);
  });

  it.each([
    ['purpose_of_session', 'Arbitrary purpose'],
    ['skill_strategies', 'Arbitrary skill strategy'],
    ['behavior_strategies', 'Arbitrary behavior strategy'],
    ['supervisor_support', 'Arbitrary supervisor support'],
  ] as const)('rejects a non-canonical option for %s', (group, option) => {
    expect(validateBtAbaSessionNoteResponses(validResponses({ [group]: [option] })).success).toBe(false);
  });

  it('rejects a drawn signature that is not the bounded point serialization', () => {
    expect(validateBtAbaSessionNoteResponses(validResponses({
      bt_signature: { method: 'drawn', value: 'not-a-drawn-signature' },
    })).success).toBe(false);
    expect(validateBtAbaSessionNoteResponses(validResponses({
      bt_signature: { method: 'drawn', value: 'points:[[0.25,0.5],null]' },
    })).success).toBe(true);
  });

  it('bounds typed signatures to the UI contract', () => {
    expect(validateBtAbaSessionNoteResponses(validResponses({
      bt_signature: { method: 'typed', value: 'x'.repeat(200) },
    })).success).toBe(true);
    expect(validateBtAbaSessionNoteResponses(validResponses({
      bt_signature: { method: 'typed', value: 'x'.repeat(201) },
    })).success).toBe(false);
  });

  it.each([
    ['purpose_of_session', 'purpose_other'],
    ['skill_strategies', 'skill_strategies_other'],
    ['behavior_strategies', 'behavior_strategies_other'],
    ['supervisor_support', 'supervisor_support_other'],
  ] as const)('requires the matching Other narrative for %s', (group, narrative) => {
    const result = validateBtAbaSessionNoteResponses(validResponses({
      [group]: ['Other'],
      [narrative]: '   ',
    }));

    expect(result.success).toBe(false);
  });

  it.each([
    'purpose_of_session',
    'skill_strategies',
    'behavior_strategies',
    'supervisor_support',
  ] as const)('rejects mixed N/A selections in %s', (group) => {
    const result = validateBtAbaSessionNoteResponses(validResponses({
      [group]: ['N/A', 'Other'],
    }));

    expect(result.success).toBe(false);
  });
});
