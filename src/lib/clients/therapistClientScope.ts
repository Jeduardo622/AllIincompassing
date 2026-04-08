import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../generated/database.types";

export type LinkableClient = {
  id: string;
  full_name: string;
  email: string | null;
  primary_therapist_id: string | null;
  primary_therapist_name: string | null;
  linked_therapist_ids: string[];
  linked_therapist_names: string[];
};

/** Client IDs that appear via link table or sessions but are not in the direct-assignment map yet. */
export const getMissingClientIds = (
  directAssignmentIds: string[],
  linkedClientIds: string[],
  sessionClientIds: string[],
): string[] => {
  const directSet = new Set(directAssignmentIds);
  return [...new Set([...linkedClientIds, ...sessionClientIds])].filter((clientId) => !directSet.has(clientId));
};

export const isAlreadyLinkedToTherapist = (client: LinkableClient, therapistId: string): boolean =>
  client.linked_therapist_ids.includes(therapistId) || client.primary_therapist_id === therapistId;

export type ClientsSupabaseForLinks = SupabaseClient<Database>;

/** Distinct client_ids linked to a therapist via client_therapist_links (org enforced on clients row when joined). */
export async function fetchLinkedClientIdsForTherapist(
  client: ClientsSupabaseForLinks,
  therapistId: string,
): Promise<string[]> {
  const { data, error } = await client.from("client_therapist_links").select("client_id").eq("therapist_id", therapistId);

  if (error) {
    throw error;
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) => row.client_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
}
