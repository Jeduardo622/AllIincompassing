export interface LifecycleTargetPair {
  therapistId: string;
  clientId: string;
}

interface BuildLifecycleTargetPairsParams {
  therapistIds: string[];
  clientIds: string[];
  authorizedPairs: LifecycleTargetPair[];
}

export function buildLifecycleTargetPairs({
  therapistIds,
  clientIds,
  authorizedPairs,
}: BuildLifecycleTargetPairsParams): LifecycleTargetPair[] {
  const visibleTherapists = new Set(
    therapistIds.filter((therapistId) => typeof therapistId === "string" && therapistId.length > 0),
  );
  const visibleClients = new Set(
    clientIds.filter((clientId) => typeof clientId === "string" && clientId.length > 0),
  );

  const filteredAuthorizedPairs: LifecycleTargetPair[] = [];
  const seenAuthorizedPairs = new Set<string>();
  for (const pair of authorizedPairs) {
    if (!visibleTherapists.has(pair.therapistId) || !visibleClients.has(pair.clientId)) {
      continue;
    }
    const key = `${pair.therapistId}:${pair.clientId}`;
    if (seenAuthorizedPairs.has(key)) {
      continue;
    }
    seenAuthorizedPairs.add(key);
    filteredAuthorizedPairs.push(pair);
  }

  if (filteredAuthorizedPairs.length > 0) {
    return filteredAuthorizedPairs;
  }

  const fallbackPairs: LifecycleTargetPair[] = [];
  for (const therapistId of therapistIds) {
    if (!visibleTherapists.has(therapistId)) {
      continue;
    }
    for (const clientId of clientIds) {
      if (!visibleClients.has(clientId)) {
        continue;
      }
      fallbackPairs.push({ therapistId, clientId });
    }
  }
  return fallbackPairs;
}
