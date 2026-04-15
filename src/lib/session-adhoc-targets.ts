import type { Goal } from '../types';
import {
  hasMeaningfulGoalMeasurementEntry,
  normalizeGoalMeasurementEntry,
} from './goal-measurements';
import { showGoalOnBxTab } from './session-goal-tracks';

const ADHOC_ID_RE = /^adhoc-(skill|bx)-/i;

export function isAdhocSessionTargetId(goalId: string | undefined | null): boolean {
  if (!goalId || typeof goalId !== 'string') {
    return false;
  }
  return ADHOC_ID_RE.test(goalId.trim());
}

/** Returns kind from id, or null if not an ad-hoc session target id. */
export function getAdhocSessionTargetKind(goalId: string): 'skill' | 'bx' | null {
  const m = goalId.trim().match(ADHOC_ID_RE);
  if (!m?.[1]) {
    return null;
  }
  const k = m[1].toLowerCase();
  return k === 'skill' || k === 'bx' ? k : null;
}

export function createAdhocSessionTargetId(kind: 'skill' | 'bx'): string {
  return `adhoc-${kind}-${crypto.randomUUID()}`;
}

/** Skill tab: plan goals plus ad-hoc skill rows; excludes ad-hoc BX-only rows. */
export function showGoalOnSkillCaptureTab(goal: Goal | undefined, goalId: string): boolean {
  const adhocKind = getAdhocSessionTargetKind(goalId);
  if (adhocKind === 'skill') {
    return true;
  }
  if (adhocKind === 'bx') {
    return false;
  }
  return true;
}

/** BX tab: behavioral plan goals plus ad-hoc behavior rows; excludes ad-hoc skill-only rows. */
export function showGoalOnBxCaptureTab(goal: Goal | undefined, goalId: string): boolean {
  const adhocKind = getAdhocSessionTargetKind(goalId);
  if (adhocKind === 'bx') {
    return true;
  }
  if (adhocKind === 'skill') {
    return false;
  }
  return showGoalOnBxTab(goal);
}

export interface SessionNoteCaptureSlice {
  readonly session_note_goal_ids: string[];
  readonly session_note_goals_addressed: string[];
  readonly session_note_goal_notes: Record<string, string>;
  readonly session_note_goal_measurements: Record<string, unknown>;
}

/** Drops ad-hoc rows that have no note and no meaningful measurement (empty shells). */
export function pruneEmptyAdhocSessionTargets(
  slice: SessionNoteCaptureSlice,
  goals: Goal[],
): SessionNoteCaptureSlice {
  const ids = slice.session_note_goal_ids;
  const labels = slice.session_note_goals_addressed;
  const nextIds: string[] = [];
  const nextLabels: string[] = [];

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const label = labels[i] ?? '';
    if (!isAdhocSessionTargetId(id)) {
      nextIds.push(id);
      nextLabels.push(label);
      continue;
    }
    const note = slice.session_note_goal_notes[id]?.trim() ?? '';
    const raw = slice.session_note_goal_measurements[id];
    const goal = goals.find((g) => g.id === id);
    const normalized = normalizeGoalMeasurementEntry(raw, goal);
    const hasMeaningful =
      note.length > 0 || hasMeaningfulGoalMeasurementEntry(normalized);
    if (hasMeaningful) {
      nextIds.push(id);
      nextLabels.push(label);
    }
  }

  const droppedAdhocIds = ids.filter((id) => isAdhocSessionTargetId(id) && !nextIds.includes(id));

  const nextNotes = { ...slice.session_note_goal_notes };
  const nextMeasurements = { ...slice.session_note_goal_measurements };
  for (const id of droppedAdhocIds) {
    delete nextNotes[id];
    delete nextMeasurements[id];
  }

  return {
    session_note_goal_ids: nextIds,
    session_note_goals_addressed: nextLabels,
    session_note_goal_notes: nextNotes,
    session_note_goal_measurements: nextMeasurements,
  };
}
