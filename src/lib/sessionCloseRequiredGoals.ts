export const resolveSessionCloseRequiredGoalIds = ({
  sessionGoalIds,
  primaryGoalId,
}: {
  sessionGoalIds: Array<string | null | undefined>;
  primaryGoalId?: string | null;
}): string[] => {
  const normalizedSessionGoalIds = sessionGoalIds.filter(
    (goalId): goalId is string => typeof goalId === "string" && goalId.trim().length > 0,
  );

  if (normalizedSessionGoalIds.length > 0) {
    return Array.from(new Set(normalizedSessionGoalIds));
  }

  return typeof primaryGoalId === "string" && primaryGoalId.trim().length > 0
    ? [primaryGoalId]
    : [];
};
