import { differenceInSeconds } from 'date-fns';

export const MAX_IMPERSONATION_MINUTES = 30;
export const MIN_IMPERSONATION_MINUTES = 1;
export const DEFAULT_IMPERSONATION_MINUTES = 15;

export interface ImpersonationAuditRecord {
  id: string;
  actor_user_id: string;
  target_user_id: string;
  actor_organization_id: string;
  target_organization_id: string;
  token_jti: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  reason: string | null;
}

export interface BuildImpersonationPayloadOptions {
  actorOrganizationId: string | null | undefined;
  targetOrganizationId: string | null | undefined;
  targetUserId?: string;
  targetUserEmail?: string;
  requestedMinutes?: number;
  reason?: string;
  now?: Date;
}

export interface ImpersonationIssueBody {
  action: 'issue';
  targetUserId?: string;
  targetUserEmail?: string;
  expiresInMinutes: number;
  reason?: string;
}

export interface ImpersonationIssuePayloadResult {
  body: ImpersonationIssueBody;
  expiresAt: string;
  expiresInMinutes: number;
}

export const clampImpersonationMinutes = (value?: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_IMPERSONATION_MINUTES;
  }

  const rounded = Math.round(value);
  const clamped = Math.max(MIN_IMPERSONATION_MINUTES, Math.min(MAX_IMPERSONATION_MINUTES, rounded));
  return clamped;
};

export const validateImpersonationScope = (
  actorOrganizationId: string | null | undefined,
  targetOrganizationId: string | null | undefined,
): void => {
  if (!actorOrganizationId) {
    throw new Error('Actor organization is required for impersonation.');
  }

  if (!targetOrganizationId) {
    throw new Error('Target organization is required for impersonation.');
  }

  if (actorOrganizationId !== targetOrganizationId) {
    throw new Error('Cross-organization impersonation is not permitted.');
  }
};

const normaliseReason = (reason?: string): string | undefined => {
  if (typeof reason !== 'string') {
    return undefined;
  }
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const buildImpersonationIssuePayload = (
  options: BuildImpersonationPayloadOptions,
): ImpersonationIssuePayloadResult => {
  validateImpersonationScope(options.actorOrganizationId, options.targetOrganizationId);

  if (!options.targetUserId && !options.targetUserEmail) {
    throw new Error('Either target user ID or email must be provided.');
  }

  const expiresInMinutes = clampImpersonationMinutes(options.requestedMinutes);
  const issuedAt = options.now ?? new Date();
  const expiresAtDate = new Date(issuedAt.getTime() + expiresInMinutes * 60_000);

  const body: ImpersonationIssueBody = {
    action: 'issue',
    targetUserId: options.targetUserId || undefined,
    targetUserEmail: options.targetUserEmail || undefined,
    expiresInMinutes,
  };

  const reason = normaliseReason(options.reason);
  if (reason) {
    body.reason = reason;
  }

  return {
    body,
    expiresAt: expiresAtDate.toISOString(),
    expiresInMinutes,
  };
};

export const getExpiryCountdownLabel = (expiresAtIso: string, now: Date = new Date()): string => {
  const expiresAt = new Date(expiresAtIso);
  const totalSeconds = Math.max(0, differenceInSeconds(expiresAt, now));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = minutes.toString().padStart(2, '0');
  const paddedSeconds = seconds.toString().padStart(2, '0');
  return `${paddedMinutes}:${paddedSeconds}`;
};

export const shouldAutoRevoke = (
  expiresAtIso: string,
  revokedAtIso: string | null,
  now: Date = new Date(),
): boolean => {
  if (revokedAtIso) {
    return false;
  }
  const expiresAt = new Date(expiresAtIso);
  return expiresAt.getTime() <= now.getTime();
};
