export interface LifecycleTargetPair {
  therapistId: string;
  clientId: string;
  authorizationWindows?: LifecycleAuthorizationWindow[];
}

export interface LifecycleAuthorizationServiceWindow {
  startDate: string;
  endDate: string;
}

export interface LifecycleAuthorizationWindow {
  startDate: string;
  endDate: string;
  serviceDateWindows?: LifecycleAuthorizationServiceWindow[];
}

interface BuildLifecycleTargetPairsParams {
  therapistIds: string[];
  clientIds: string[];
  authorizedPairs: LifecycleTargetPair[];
  allowedTherapistIds?: string[];
  candidateStarts?: Date[];
}

const toIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

const dateFallsWithinWindow = (dateIso: string, startDate: string, endDate: string): boolean =>
  startDate <= dateIso && endDate >= dateIso;

const windowCoversBookingDate = (window: LifecycleAuthorizationWindow, bookingDateIso: string): boolean =>
  dateFallsWithinWindow(bookingDateIso, window.startDate, window.endDate) &&
  Array.isArray(window.serviceDateWindows) &&
  window.serviceDateWindows.some((serviceWindow) =>
    dateFallsWithinWindow(bookingDateIso, serviceWindow.startDate, serviceWindow.endDate)
  );

export function filterLifecyclePairCoveredBookingStarts(
  pair: LifecycleTargetPair,
  candidateStarts: Date[],
): Date[] {
  if (!Array.isArray(pair.authorizationWindows) || pair.authorizationWindows.length === 0) {
    return [];
  }

  return candidateStarts.filter((candidateStart) => {
    const bookingDateIso = toIsoDate(candidateStart);
    return pair.authorizationWindows?.some((window) => windowCoversBookingDate(window, bookingDateIso));
  });
}

export function buildLifecycleTargetPairs({
  therapistIds,
  clientIds,
  authorizedPairs,
  allowedTherapistIds,
  candidateStarts,
}: BuildLifecycleTargetPairsParams): LifecycleTargetPair[] {
  const visibleTherapists = new Set(
    therapistIds.filter((therapistId) => typeof therapistId === "string" && therapistId.length > 0),
  );
  const allowedTherapists = new Set(
    (allowedTherapistIds ?? []).filter((therapistId) => typeof therapistId === "string" && therapistId.length > 0),
  );
  const therapistAllowed = (therapistId: string): boolean =>
    allowedTherapists.size === 0 || allowedTherapists.has(therapistId);
  const visibleClients = new Set(
    clientIds.filter((clientId) => typeof clientId === "string" && clientId.length > 0),
  );

  const filteredAuthorizedPairs: LifecycleTargetPair[] = [];
  const authorizedPairsByKey = new Map<string, LifecycleTargetPair>();
  for (const pair of authorizedPairs) {
    if (
      !visibleTherapists.has(pair.therapistId) ||
      !therapistAllowed(pair.therapistId) ||
      !visibleClients.has(pair.clientId)
    ) {
      continue;
    }
    const key = `${pair.therapistId}:${pair.clientId}`;
    const existingPair = authorizedPairsByKey.get(key);
    if (existingPair) {
      if (pair.authorizationWindows?.length) {
        existingPair.authorizationWindows = [
          ...(existingPair.authorizationWindows ?? []),
          ...pair.authorizationWindows,
        ];
      }
      continue;
    }

    authorizedPairsByKey.set(key, {
      therapistId: pair.therapistId,
      clientId: pair.clientId,
      authorizationWindows: pair.authorizationWindows ? [...pair.authorizationWindows] : undefined,
    });
  }

  for (const pair of authorizedPairsByKey.values()) {
    if (candidateStarts && filterLifecyclePairCoveredBookingStarts(pair, candidateStarts).length === 0) {
      continue;
    }
    filteredAuthorizedPairs.push(pair);
  }

  if (filteredAuthorizedPairs.length > 0) {
    return filteredAuthorizedPairs;
  }

  if (candidateStarts) {
    return [];
  }

  const fallbackPairs: LifecycleTargetPair[] = [];
  for (const therapistId of therapistIds) {
    if (!visibleTherapists.has(therapistId) || !therapistAllowed(therapistId)) {
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
