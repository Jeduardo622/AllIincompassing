import type { Goal } from '../types';

/**
 * Heuristic: goals that are likely tracked under a behavioral (BX) lens for session capture tabs.
 * Goals may still appear on the Skill tab when {@link showGoalOnSkillTab} is true — overlap is allowed.
 */
export function isLikelyBehaviorGoal(goal: Goal | undefined): boolean {
  if (!goal) {
    return false;
  }
  const mt = goal.measurement_type?.trim().toLowerCase() ?? '';
  if (
    mt.includes('behavior') ||
    mt.includes('behaviour') ||
    mt.includes('bx') ||
    mt.includes('frequency') ||
    mt.includes('maladaptive')
  ) {
    return true;
  }
  if (goal.target_behavior?.trim()) {
    return true;
  }
  const title = goal.title?.trim().toLowerCase() ?? '';
  if (title.includes('behavior') || title.includes('behaviour')) {
    return true;
  }
  return false;
}

/** Skill tab lists all worked goals for the session. */
export function showGoalOnSkillTab(_goal: Goal | undefined): boolean {
  return true;
}

/** BX tab lists goals that match {@link isLikelyBehaviorGoal}. */
export function showGoalOnBxTab(goal: Goal | undefined): boolean {
  return isLikelyBehaviorGoal(goal);
}

/**
 * Minimum trials shown to therapists (org / BCBA may set fuller targets elsewhere).
 * Parses a small integer from target_criteria or objective_data_points when present.
 */
export function getTherapistMinTrialsTarget(goal: Goal | undefined): number | null {
  if (!goal) {
    return null;
  }
  const fromText = goal.target_criteria?.trim() ?? '';
  const minMatch = fromText.match(/\bmin(?:imum)?\s*trials?\s*[:=]?\s*(\d+)/i);
  if (minMatch) {
    const n = Number(minMatch[1]);
    return Number.isFinite(n) ? n : null;
  }
  const slash = fromText.match(/(\d+)\s*\/\s*(\d+)/);
  if (slash) {
    const a = Number(slash[1]);
    return Number.isFinite(a) ? a : null;
  }
  return null;
}
