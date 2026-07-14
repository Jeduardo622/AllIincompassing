export interface LifecycleSessionArtifactCoverage {
  sessionGoalIds: string[];
  clientSessionNoteGoalNotes: unknown[];
}

export const getMissingLifecycleArtifacts = (
  coverage: LifecycleSessionArtifactCoverage,
): string[] => {
  const missing: string[] = [];
  if (coverage.sessionGoalIds.length < 1) {
    missing.push("session_goals");
  }
  if (coverage.clientSessionNoteGoalNotes.length < 1) {
    missing.push("client_session_notes");
    return missing;
  }

  const persistedGoalIds = new Set<string>();
  for (const goalNotes of coverage.clientSessionNoteGoalNotes) {
    if (!goalNotes || typeof goalNotes !== "object" || Array.isArray(goalNotes)) {
      continue;
    }
    for (const [goalId, note] of Object.entries(goalNotes)) {
      if (typeof note === "string" && note.trim().length > 0) {
        persistedGoalIds.add(goalId);
      }
    }
  }
  for (const goalId of Array.from(new Set(coverage.sessionGoalIds))) {
    if (!persistedGoalIds.has(goalId)) {
      missing.push(`client_session_notes.goal_notes[${goalId}]`);
    }
  }
  return missing;
};

export const assertLifecycleSessionArtifacts = (
  stage: string,
  coverage: LifecycleSessionArtifactCoverage,
): void => {
  const missing = getMissingLifecycleArtifacts(coverage);
  if (missing.length === 0) {
    return;
  }
  throw new Error(
    `Lifecycle smoke ${stage} is missing durable artifacts: ${missing.join(", ")}`,
  );
};
