import type { Goal } from '../types';
import { z } from 'zod';
import {
  hasMeaningfulGoalMeasurementEntry,
  normalizeGoalMeasurementEntry,
} from './goal-measurements';
import { showGoalOnBxTab } from './session-goal-tracks';

/** `adhoc-skill-` / `adhoc-bx-` plus a UUID suffix (same shape as {@link createAdhocSessionTargetId}). */
const ADHOC_SESSION_TARGET_RE = /^adhoc-(skill|bx)-(.+)$/i;

const parseAdhocSessionTargetSegments = (goalId: string): { kind: 'skill' | 'bx' } | null => {
  const t = goalId.trim();
  const m = t.match(ADHOC_SESSION_TARGET_RE);
  if (!m?.[1] || m[2] === undefined) {
    return null;
  }
  const suffix = m[2];
  if (!z.string().uuid().safeParse(suffix).success) {
    return null;
  }
  const kindRaw = m[1].toLowerCase();
  if (kindRaw !== 'skill' && kindRaw !== 'bx') {
    return null;
  }
  return { kind: kindRaw };
};

export function isAdhocSessionTargetId(goalId: string | undefined | null): boolean {
  if (!goalId || typeof goalId !== 'string') {
    return false;
  }
  return parseAdhocSessionTargetSegments(goalId) !== null;
}

/** Keys allowed on `client_session_notes.goal_ids`, `goal_notes`, and `goal_measurements` maps. */
export function isValidSessionNoteGoalKey(goalId: string): boolean {
  const t = goalId.trim();
  if (!t) {
    return false;
  }
  if (isAdhocSessionTargetId(t)) {
    return true;
  }
  return z.string().uuid().safeParse(t).success;
}

/** Returns kind from id, or null if not an ad-hoc session target id. */
export function getAdhocSessionTargetKind(goalId: string): 'skill' | 'bx' | null {
  return parseAdhocSessionTargetSegments(goalId)?.kind ?? null;
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
