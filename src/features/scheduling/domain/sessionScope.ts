import type { Therapist } from "../../../types";

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

type ScopeCandidateInput = {
  profileId?: string | null;
  userMetadata?: Record<string, unknown> | null;
  preferences?: unknown;
};

export const collectTherapistScopeCandidateIds = ({
  profileId,
  userMetadata,
  preferences,
}: ScopeCandidateInput): Set<string> => {
  const candidateIds = new Set<string>();

  const profileCandidate = toTrimmedString(profileId);
  if (profileCandidate) {
    candidateIds.add(profileCandidate);
  }

  const metadataTherapistSnake = toTrimmedString(userMetadata?.therapist_id);
  if (metadataTherapistSnake) {
    candidateIds.add(metadataTherapistSnake);
  }

  const metadataTherapistCamel = toTrimmedString(userMetadata?.therapistId);
  if (metadataTherapistCamel) {
    candidateIds.add(metadataTherapistCamel);
  }

  if (preferences && typeof preferences === "object") {
    const prefRecord = preferences as Record<string, unknown>;
    const prefTherapistSnake = toTrimmedString(prefRecord.therapist_id);
    if (prefTherapistSnake) {
      candidateIds.add(prefTherapistSnake);
    }

    const prefTherapistCamel = toTrimmedString(prefRecord.therapistId);
    if (prefTherapistCamel) {
      candidateIds.add(prefTherapistCamel);
    }
  }

  return candidateIds;
};

export const resolveScopedTherapistId = (
  therapists: Therapist[],
  candidateIds: Iterable<string>,
): string | null => {
  const candidateSet = new Set(candidateIds);
  const match = therapists.find((therapist) => candidateSet.has(therapist.id));
  return match?.id ?? null;
};
