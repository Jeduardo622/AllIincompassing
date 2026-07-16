import { describe, expect, it } from 'vitest';

import {
  normalizeExclusiveSelections,
  validateBtAbaSessionNoteResponses,
  type BtAbaSessionNoteResponses,
} from '../bt-aba-session-note';

const validResponses = (
  overrides: Partial<BtAbaSessionNoteResponses> = {},
): BtAbaSessionNoteResponses => ({
  purpose_of_session: ['Direct treatment'],
  client_status: 'Client was ready to participate.',
  skill_strategies: ['Discrete trial training'],
  behavior_strategies: ['Differential reinforcement'],
  supervisor_support: ['N/A'],
  progress_toward_goals: 'Client made progress toward treatment goals.',
  client_response_to_treatment: 'Client responded positively to treatment.',
  data_point_scope: 'linked',
  link_unlinked_data: false,
  bt_signature: { method: 'typed', value: 'Behavior Technician' },
  ...overrides,
});

describe('BT ABA session note contract', () => {
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
      bt_signature: { method: 'typed', value: '  Behavior Technician  ' },
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.client_status).toBe('Client was ready to participate.');
      expect(result.data.bt_signature.value).toBe('Behavior Technician');
    }
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
