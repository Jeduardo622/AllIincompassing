import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { getRequiredServerEnv } from "./env";
import type { DerivedCpt } from "./types";

type Database = {
  public: {
    Tables: {
      cpt_codes: {
        Row: {
          id: string;
          code: string;
        };
      };
      billing_modifiers: {
        Row: {
          id: string;
          code: string;
        };
      };
      session_cpt_entries: {
        Row: {
          id: string;
        };
        Insert: {
          session_id: string;
          cpt_code_id: string;
          line_number?: number;
          units?: number;
          billed_minutes?: number | null;
          rate?: string | number | null;
          is_primary?: boolean;
          notes?: string | null;
        };
      };
      session_cpt_modifiers: {
        Row: {
          modifier_id: string;
        };
        Insert: {
          session_cpt_entry_id: string;
          modifier_id: string;
          position: number;
        };
      };
    };
  };
};

interface PersistSessionCptInput {
  sessionId: string;
  cpt: DerivedCpt;
  billedMinutes: number | null | undefined;
}

type BillingMetrics = {
  minutes: number | null;
  units: number;
};

let cachedClient: SupabaseClient<Database> | null = null;

function getServiceClient(): SupabaseClient<Database> {
  if (cachedClient) {
    return cachedClient;
  }

  const url = getRequiredServerEnv("SUPABASE_URL");
  const serviceRoleKey = getRequiredServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  cachedClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });

  return cachedClient;
}

function toError(message: string, error: PostgrestError | null): Error {
  if (error?.message) {
    return new Error(`${message}: ${error.message}`);
  }
  return new Error(message);
}

function computeBillingMetrics(candidate: number | null | undefined): BillingMetrics {
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0) {
    return { minutes: null, units: 1 };
  }

  const roundedMinutes = Math.max(1, Math.round(candidate));
  const units = Math.max(1, Math.ceil(roundedMinutes / 15));
  return { minutes: roundedMinutes, units };
}

export async function persistSessionCptMetadata({
  sessionId,
  cpt,
  billedMinutes,
}: PersistSessionCptInput): Promise<{ entryId: string; modifierIds: string[] }> {
  const client = getServiceClient();
  const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (normalizedSessionId.length === 0) {
    throw new Error("sessionId is required to persist CPT metadata");
  }

  const cptCode = typeof cpt.code === "string" ? cpt.code.trim().toUpperCase() : "";
  if (cptCode.length === 0) {
    throw new Error("CPT code is required to persist CPT metadata");
  }

  const { minutes, units } = computeBillingMetrics(
    typeof billedMinutes === "number" ? billedMinutes : cpt.durationMinutes,
  );

  const { data: cptRow, error: cptError } = await client
    .from("cpt_codes")
    .select("id, code")
    .eq("code", cptCode)
    .maybeSingle();

  if (cptError) {
    throw toError(`Failed to load CPT code ${cptCode}`, cptError);
  }

  if (!cptRow?.id) {
    throw new Error(`CPT code ${cptCode} is not registered in cpt_codes`);
  }

  const { error: deleteError } = await client
    .from("session_cpt_entries")
    .delete()
    .eq("session_id", normalizedSessionId);

  if (deleteError) {
    throw toError("Failed to clear existing session CPT entries", deleteError);
  }

  const entryPayload: Database["public"]["Tables"]["session_cpt_entries"]["Insert"] = {
    session_id: normalizedSessionId,
    cpt_code_id: cptRow.id,
    line_number: 1,
    units,
    billed_minutes: minutes,
    is_primary: true,
    notes: cpt.description,
  };

  const { data: entryRow, error: insertError } = await client
    .from("session_cpt_entries")
    .insert(entryPayload)
    .select("id")
    .single();

  if (insertError) {
    throw toError("Failed to insert session CPT entry", insertError);
  }

  let entryId = entryRow?.id;

  if (!entryId) {
    const { data: fallbackRow, error: fallbackError } = await client
      .from("session_cpt_entries")
      .select("id")
      .eq("session_id", normalizedSessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallbackError) {
      throw toError("Failed to locate session CPT entry after insert", fallbackError);
    }

    if (!fallbackRow?.id) {
      throw new Error("Failed to determine session CPT entry identifier");
    }

    entryId = fallbackRow.id;
  }

  const modifierCodes = Array.isArray(cpt.modifiers)
    ? cpt.modifiers
        .map((modifier) => (typeof modifier === "string" ? modifier.trim().toUpperCase() : ""))
        .filter((modifier) => modifier.length > 0)
    : [];

  if (modifierCodes.length === 0) {
    return { entryId, modifierIds: [] };
  }

  const { data: modifierRows, error: modifierError } = await client
    .from("billing_modifiers")
    .select("id, code")
    .in("code", modifierCodes);

  if (modifierError) {
    throw toError("Failed to load billing modifiers", modifierError);
  }

  const modifierMap = new Map<string, string>();
  modifierRows?.forEach((row) => {
    if (row?.code && row?.id) {
      modifierMap.set(row.code, row.id);
    }
  });

  const missingModifiers = modifierCodes.filter((code) => !modifierMap.has(code));
  if (missingModifiers.length > 0) {
    throw new Error(`Billing modifiers not registered: ${missingModifiers.join(", ")}`);
  }

  const modifierPayloads = modifierCodes.map((code, index) => ({
    session_cpt_entry_id: entryId,
    modifier_id: modifierMap.get(code) as string,
    position: index + 1,
  }));

  const { data: insertedModifiers, error: insertModifiersError } = await client
    .from("session_cpt_modifiers")
    .insert(modifierPayloads)
    .select("modifier_id");

  if (insertModifiersError) {
    throw toError("Failed to insert session CPT modifiers", insertModifiersError);
  }

  const modifierIds = (insertedModifiers ?? [])
    .map((row) => row?.modifier_id)
    .filter((modifierId): modifierId is string => typeof modifierId === "string" && modifierId.length > 0);

  return { entryId, modifierIds };
}

export function resetSessionCptClient(): void {
  cachedClient = null;
}
