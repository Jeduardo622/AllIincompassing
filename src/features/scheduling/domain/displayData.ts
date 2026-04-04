import type { Client, Session, Therapist } from "../../../types";

type BatchedScheduleData = {
  sessions?: Session[] | null;
  therapists?: Therapist[] | null;
  clients?: Client[] | null;
} | null | undefined;

type DropdownData = {
  therapists?: Therapist[] | null;
  clients?: Client[] | null;
} | null | undefined;

type BuildScheduleDisplayDataInput = {
  filteredBatchedSessions: Session[] | null;
  fallbackSessions: Session[];
  batchedData: BatchedScheduleData;
  dropdownData: DropdownData;
};

export type ScheduleDisplayData = {
  sessions: Session[];
  therapists: Therapist[];
  clients: Client[];
};

const hasStringId = (value: unknown): value is { id: string } => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { id?: unknown };
  return typeof candidate.id === "string" && candidate.id.trim().length > 0;
};

const sanitizeById = <T>(items: T[] | null | undefined): T[] => {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter((item): item is T => hasStringId(item));
};

export const buildScheduleDisplayData = ({
  filteredBatchedSessions,
  fallbackSessions,
  batchedData,
  dropdownData,
}: BuildScheduleDisplayDataInput): ScheduleDisplayData => {
  const normalizedSessions = sanitizeById(filteredBatchedSessions ?? fallbackSessions) as Session[];
  const normalizedTherapists = sanitizeById(
    batchedData?.therapists || dropdownData?.therapists,
  ) as Therapist[];
  const normalizedClients = sanitizeById(
    batchedData?.clients || dropdownData?.clients,
  ) as Client[];

  return {
    sessions: normalizedSessions,
    therapists: normalizedTherapists,
    clients: normalizedClients,
  };
};
