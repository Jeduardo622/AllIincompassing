export const parseReplaySeed = (value?: string): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
};

export const buildReplayHeaders = (correlationId: string, requestId: string): Record<string, string> => ({
  'x-correlation-id': correlationId,
  'x-request-id': requestId,
});
