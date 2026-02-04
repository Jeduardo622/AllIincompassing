import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { getRequiredServerEnv } from "./env";

type Database = {
  public: {
    Tables: {
      sessions: {
        Row: {
          id: string;
          organization_id: string;
          client_id: string;
          program_id: string;
          goal_id: string;
        };
      };
      session_goals: {
        Insert: {
          session_id: string;
          goal_id: string;
          organization_id: string;
          client_id: string;
          program_id: string;
        };
      };
    };
  };
};

interface PersistSessionGoalsInput {
  sessionId: string;
  goalIds: string[];
}

let cachedClient: SupabaseClient<Database> | null = null;

function getServiceClient(): SupabaseClient<Database> {
  if (cachedClient) {
    return cachedClient;
  }

  const url = getRequiredServerEnv("SUPABASE_URL");
  const serviceRoleKey = getRequiredServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  cachedClient = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  return cachedClient;
}

function toError(message: string, error: PostgrestError | null): Error {
  if (error?.message) {
    return new Error(`${message}: ${error.message}`);
  }
  return new Error(message);
}

export async function persistSessionGoals({ sessionId, goalIds }: PersistSessionGoalsInput): Promise<void> {
  const client = getServiceClient();
  const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalizedSessionId) {
    throw new Error("sessionId is required to persist session goals");
  }

  const normalizedGoalIds = Array.from(
    new Set(goalIds.map((goalId) => goalId.trim()).filter((goalId) => goalId.length > 0)),
  );
  if (normalizedGoalIds.length === 0) {
    return;
  }

  const { data: sessionRow, error: sessionError } = await client
    .from("sessions")
    .select("id, organization_id, client_id, program_id, goal_id")
    .eq("id", normalizedSessionId)
    .maybeSingle();

  if (sessionError) {
    throw toError("Failed to load session for goal persistence", sessionError);
  }

  if (!sessionRow) {
    throw new Error("Session not found for goal persistence");
  }

  const mergedGoalIds = Array.from(
    new Set([sessionRow.goal_id, ...normalizedGoalIds].filter((goalId) => typeof goalId === "string")),
  );

  const payloads: Database["public"]["Tables"]["session_goals"]["Insert"][] = mergedGoalIds.map((goalId) => ({
    session_id: normalizedSessionId,
    goal_id: goalId,
    organization_id: sessionRow.organization_id,
    client_id: sessionRow.client_id,
    program_id: sessionRow.program_id,
  }));

  const { error: upsertError } = await client
    .from("session_goals")
    .upsert(payloads, { onConflict: "session_id,goal_id" });

  if (upsertError) {
    throw toError("Failed to persist session goals", upsertError);
  }
}

export function resetSessionGoalsClient(): void {
  cachedClient = null;
}
