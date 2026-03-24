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

export const buildScheduleDisplayData = ({
  filteredBatchedSessions,
  fallbackSessions,
  batchedData,
  dropdownData,
}: BuildScheduleDisplayDataInput): ScheduleDisplayData => {
  return {
    sessions: filteredBatchedSessions ?? fallbackSessions,
    therapists: batchedData?.therapists || dropdownData?.therapists || [],
    clients: batchedData?.clients || dropdownData?.clients || [],
  };
};
