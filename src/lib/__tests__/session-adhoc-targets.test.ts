import { describe, expect, it } from 'vitest';
import {
  createAdhocSessionTargetId,
  getAdhocSessionTargetKind,
  isAdhocSessionTargetId,
  pruneEmptyAdhocSessionTargets,
  showGoalOnBxCaptureTab,
  showGoalOnSkillCaptureTab,
} from '../session-adhoc-targets';

describe('session-adhoc-targets', () => {
  it('detects ad-hoc ids and kind', () => {
    const id = createAdhocSessionTargetId('skill');
    expect(isAdhocSessionTargetId(id)).toBe(true);
    expect(getAdhocSessionTargetKind(id)).toBe('skill');
    expect(isAdhocSessionTargetId('goal-uuid')).toBe(false);
    expect(getAdhocSessionTargetKind('goal-uuid')).toBe(null);
  });

  it('routes skill vs bx tabs for ad-hoc ids', () => {
    const skillId = 'adhoc-skill-11111111-1111-4111-8111-111111111111';
    const bxId = 'adhoc-bx-22222222-2222-4222-8222-222222222222';
    expect(showGoalOnSkillCaptureTab(undefined, skillId)).toBe(true);
    expect(showGoalOnBxCaptureTab(undefined, skillId)).toBe(false);
    expect(showGoalOnSkillCaptureTab(undefined, bxId)).toBe(false);
    expect(showGoalOnBxCaptureTab(undefined, bxId)).toBe(true);
  });

  it('keeps plan-goal note keys when they are not listed in session_note_goal_ids', () => {
    const pruned = pruneEmptyAdhocSessionTargets(
      {
        session_note_goal_ids: [],
        session_note_goals_addressed: [],
        session_note_goal_notes: { 'plan-goal-1': 'Progress' },
        session_note_goal_measurements: { 'plan-goal-1': { data: { metric_value: 2 } } },
      },
      [],
    );
    expect(pruned.session_note_goal_notes['plan-goal-1']).toBe('Progress');
    expect(pruned.session_note_goal_measurements['plan-goal-1']).toBeDefined();
  });

  it('prunes empty ad-hoc shells and keeps rows with notes or trials', () => {
    const emptyId = createAdhocSessionTargetId('bx');
    const filledId = createAdhocSessionTargetId('skill');
    const pruned = pruneEmptyAdhocSessionTargets(
      {
        session_note_goal_ids: ['plan-1', emptyId, filledId],
        session_note_goals_addressed: ['Plan', 'Empty shell', 'Has data'],
        session_note_goal_notes: {
          'plan-1': 'ok',
          [emptyId]: '   ',
          [filledId]: 'note',
        },
        session_note_goal_measurements: {
          [emptyId]: {},
          [filledId]: { data: { metric_value: 1 } },
        },
      },
      [],
    );
    expect(pruned.session_note_goal_ids).toEqual(['plan-1', filledId]);
    expect(pruned.session_note_goals_addressed).toEqual(['Plan', 'Has data']);
    expect(pruned.session_note_goal_notes[emptyId]).toBeUndefined();
    expect(pruned.session_note_goal_measurements[emptyId]).toBeUndefined();
  });
});
