type ConflictPolicySource = {
  retryHint?: string;
  retryAfter?: string | null;
  retryAfterSeconds?: number | null;
  orchestration?: {
    rollbackPlan?: {
      guidance?: string | null;
    } | null;
    alternatives?: unknown;
  } | null;
};

const toSeconds = (value: number): number => Math.max(0, Math.min(3600, Math.round(value)));

const formatSeconds = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
};

export function buildSchedulingConflictHint(error: unknown, fallback: string): string {
  const source = (error ?? {}) as ConflictPolicySource;
  const baseHint = typeof source.retryHint === "string" && source.retryHint.trim().length > 0
    ? source.retryHint.trim()
    : fallback;

  let waitSeconds: number | null = null;
  if (typeof source.retryAfterSeconds === "number" && Number.isFinite(source.retryAfterSeconds)) {
    waitSeconds = toSeconds(source.retryAfterSeconds);
  } else if (typeof source.retryAfter === "string" && source.retryAfter.trim().length > 0) {
    const retryAtMs = Date.parse(source.retryAfter);
    if (Number.isFinite(retryAtMs)) {
      waitSeconds = toSeconds((retryAtMs - Date.now()) / 1000);
    }
  }

  const rollbackGuidance = source.orchestration?.rollbackPlan?.guidance;
  const parts = [baseHint];
  if (waitSeconds !== null && waitSeconds > 0) {
    parts.push(`Retry in about ${formatSeconds(waitSeconds)}.`);
  }
  if (typeof rollbackGuidance === "string" && rollbackGuidance.trim().length > 0) {
    parts.push(rollbackGuidance.trim());
  }
  return parts.join(" ");
}
