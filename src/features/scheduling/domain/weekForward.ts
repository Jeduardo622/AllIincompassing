import type {
  WeekForwardCommitResult,
  WeekForwardPreviewResult,
  WeekForwardRequestBody,
} from "../../../server/types";
import { supabase } from "../../../lib/supabase";
import { callApiRoute } from "../../../lib/sdk/client";
import { parseJsonResponse } from "../../../lib/sdk/contracts";
import { toNormalizedApiError, type NormalizedApiError } from "../../../lib/sdk/errors";
import { weekForwardEnvelopeSchema } from "../../../lib/contracts/scheduling";
import { getSupabaseAnonKey } from "../../../lib/runtimeConfig";

const getSessionAccessToken = async (): Promise<string | null> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token?.trim();
  return token && token.length > 0 ? token : null;
};

async function postWeekForward(
  payload: WeekForwardRequestBody,
): Promise<WeekForwardPreviewResult | WeekForwardCommitResult> {
  const token = await getSessionAccessToken();
  if (!token) {
    throw new Error("Authentication is required to apply this week forward");
  }

  const headers: Record<string, string> = {};
  try {
    const anonKey = getSupabaseAnonKey().trim();
    if (anonKey.length > 0) {
      headers.apikey = anonKey;
    }
  } catch {
    // Runtime config unavailable in tests or early startup; skip optional apikey.
  }

  const response = await callApiRoute(
    "/api/sessions-week-forward",
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    {
      accessToken: token,
    },
  );

  const parsed = await parseJsonResponse(response.clone(), weekForwardEnvelopeSchema);
  if (!response.ok || !parsed?.data) {
    let fallbackPayload: Record<string, unknown> | null = null;
    try {
      fallbackPayload = await response.json() as Record<string, unknown>;
    } catch {
      fallbackPayload = null;
    }
    throw toNormalizedApiError(
      fallbackPayload,
      response.status,
      "Failed to apply week-forward scheduling",
    );
  }

  return parsed.data as WeekForwardPreviewResult | WeekForwardCommitResult;
}

export async function previewWeekForwardScheduling(
  payload: Omit<WeekForwardRequestBody, "dryRun">,
): Promise<WeekForwardPreviewResult> {
  return postWeekForward({ ...payload, dryRun: true }) as Promise<WeekForwardPreviewResult>;
}

export async function applyWeekForwardScheduling(
  payload: Omit<WeekForwardRequestBody, "dryRun">,
): Promise<WeekForwardCommitResult> {
  return postWeekForward({ ...payload, dryRun: false }) as Promise<WeekForwardCommitResult>;
}

export const asWeekForwardError = (error: unknown): NormalizedApiError => {
  if (error instanceof Error) {
    return error as NormalizedApiError;
  }
  return new Error(String(error)) as NormalizedApiError;
};
