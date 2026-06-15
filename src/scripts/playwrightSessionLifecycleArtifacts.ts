export interface LifecycleSessionArtifactCounts {
  sessionGoalsCount: number;
  clientSessionNotesCount: number;
}

export const getMissingLifecycleArtifacts = (
  counts: LifecycleSessionArtifactCounts,
): string[] => {
  const missing: string[] = [];
  if (counts.sessionGoalsCount < 1) {
    missing.push("session_goals");
  }
  if (counts.clientSessionNotesCount < 1) {
    missing.push("client_session_notes");
  }
  return missing;
};

export const assertLifecycleSessionArtifacts = (
  stage: string,
  counts: LifecycleSessionArtifactCounts,
): void => {
  const missing = getMissingLifecycleArtifacts(counts);
  if (missing.length === 0) {
    return;
  }
  throw new Error(
    `Lifecycle smoke ${stage} is missing durable artifacts: ${missing.join(", ")}`,
  );
};
