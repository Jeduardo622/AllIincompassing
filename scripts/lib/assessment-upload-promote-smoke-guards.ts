export type PromotedLiveCleanupQueries = {
  goalDataPoints?: string;
  goals?: string;
  programs?: string;
};

export const requireSmokeClientId = (value: string | undefined): string => {
  const clientId = value?.trim();
  if (!clientId) {
    throw new Error(
      "PW_ASSESSMENT_CLIENT_ID is required. Use a dedicated smoke client; this promote smoke never falls back to the first accessible client.",
    );
  }
  return clientId;
};

export const assertSmokeClientMarker = (clientName: string | null | undefined, clientId: string): void => {
  const label = clientName?.trim() ?? "";
  if (!/\b(smoke|synthetic|test)\b/i.test(label)) {
    throw new Error(
      `PW_ASSESSMENT_CLIENT_ID must point at a clearly marked smoke client. Rename the client to include "Smoke", "Synthetic", or "Test" before running: ${clientId}`,
    );
  }
};

export const buildInFilter = (ids: string[]): string =>
  `in.(${ids.map((id) => encodeURIComponent(id)).join(",")})`;

export const buildPromotedLiveCleanupQueries = (args: {
  assessmentDocumentId: string;
  organizationId: string;
  clientId: string;
  programIds: string[];
  goalIds: string[];
}): PromotedLiveCleanupQueries => {
  if (args.programIds.length === 0) {
    return {};
  }

  const programFilter = buildInFilter(args.programIds);
  const orgFilter = encodeURIComponent(args.organizationId);
  const clientFilter = encodeURIComponent(args.clientId);
  return {
    goalDataPoints: args.goalIds.length > 0
      ? `goal_id=${buildInFilter(args.goalIds)}&assessment_document_id=eq.${encodeURIComponent(args.assessmentDocumentId)}&organization_id=eq.${orgFilter}&client_id=eq.${clientFilter}`
      : undefined,
    goals: `program_id=${programFilter}&organization_id=eq.${orgFilter}&client_id=eq.${clientFilter}`,
    programs: `id=${programFilter}&organization_id=eq.${orgFilter}&client_id=eq.${clientFilter}`,
  };
};
