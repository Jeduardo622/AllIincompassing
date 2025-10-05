import { logger } from './logger/logger';
import { redactPhi } from './logger/redactPhi';

const generateTraceId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `trace_${Math.random().toString(36).slice(2, 10)}`;
};

export type AssistantRole = 'client' | 'therapist' | 'admin' | 'super_admin';

export type AssistantTool =
  | 'cancel_sessions'
  | 'schedule_session'
  | 'modify_session'
  | 'create_client'
  | 'update_client'
  | 'create_therapist'
  | 'update_therapist'
  | 'create_authorization'
  | 'update_authorization'
  | 'initiate_client_onboarding';

export interface GuardrailActor {
  id: string;
  role: AssistantRole;
  organizationId?: string;
  allowedTools?: AssistantTool[];
}

export interface GuardrailAudit {
  auditVersion: string;
  traceId: string;
  actorId: string;
  actorRole: AssistantRole;
  timestamp: string;
  reason: 'approved' | 'tool_denied' | 'prompt_blocked' | 'invalid_message';
  allowedTools: AssistantTool[];
  deniedTools: AssistantTool[];
  requestedTools: AssistantTool[];
  toolUsed: AssistantTool | null;
  actionDenied: boolean;
  messagePreview: string;
  redactedPrompt: string;
  truncated: boolean;
  metadata?: Record<string, unknown>;
}

export interface GuardrailAuditLogEntry {
  auditVersion: string;
  traceId: string;
  actorId: string;
  actorRole: AssistantRole;
  timestamp: string;
  reason: GuardrailAudit['reason'];
  allowedTools: AssistantTool[];
  deniedTools: AssistantTool[];
  requestedTools: AssistantTool[];
  toolUsed: AssistantTool | null;
  actionDenied: boolean;
  messagePreview: string;
  redactedPrompt: string;
  truncated: boolean;
  metadata?: Record<string, unknown>;
}

export interface GuardrailInput {
  message: string;
  actor?: GuardrailActor | null;
  requestedTools?: AssistantTool[];
  metadata?: Record<string, unknown>;
}

export interface GuardrailEvaluation {
  sanitizedMessage: string;
  allowedTools: AssistantTool[];
  auditTrail: GuardrailAudit;
  auditLog: GuardrailAuditLogEntry;
}

export class AssistantGuardrailError extends Error {
  readonly audit: GuardrailAudit;
  readonly auditLog: GuardrailAuditLogEntry;

  constructor(message: string, audit: GuardrailAudit, auditLog: GuardrailAuditLogEntry) {
    super(message);
    this.name = 'AssistantGuardrailError';
    this.audit = audit;
    this.auditLog = auditLog;
  }
}

const MAX_MESSAGE_LENGTH = 4000;
const CONTROL_CHARACTERS = /[\p{C}]/gu;

export const GUARDRAIL_AUDIT_VERSION = '2025-10-guardrails-v1';

const ROLE_ORDER: AssistantRole[] = ['client', 'therapist', 'admin', 'super_admin'];

const ROLE_BASE_TOOLS: Record<AssistantRole, AssistantTool[]> = {
  client: [],
  therapist: ['schedule_session', 'modify_session', 'cancel_sessions'],
  admin: [
    'schedule_session',
    'modify_session',
    'cancel_sessions',
    'create_client',
    'update_client',
    'create_authorization',
    'update_authorization',
    'initiate_client_onboarding',
  ],
  super_admin: [
    'schedule_session',
    'modify_session',
    'cancel_sessions',
    'create_client',
    'update_client',
    'create_authorization',
    'update_authorization',
    'initiate_client_onboarding',
    'create_therapist',
    'update_therapist',
  ],
};

const roleToolCache = new Map<AssistantRole, AssistantTool[]>();

const DISALLOWED_PATTERNS: Array<{ pattern: RegExp; reason: GuardrailAudit['reason']; description: string }> = [
  {
    pattern: /ignore (?:all|the) previous instructions/i,
    reason: 'prompt_blocked',
    description: 'prompt_injection',
  },
  {
    pattern: /export (?:all )?(?:client|patient) data/i,
    reason: 'prompt_blocked',
    description: 'data_exfiltration',
  },
  {
    pattern: /\b(?:drop|truncate)\s+(?:table|schema)/i,
    reason: 'prompt_blocked',
    description: 'sql_injection',
  },
  {
    pattern: /\b(?:disable|bypass)\s+(?:guardrail|safety)/i,
    reason: 'prompt_blocked',
    description: 'guardrail_bypass',
  },
  {
    pattern: /\bssn\b|social security number/i,
    reason: 'prompt_blocked',
    description: 'phi_exfiltration',
  },
];

const buildMessagePreview = (message: string): string =>
  message.length > 120 ? `${message.slice(0, 117)}...` : message;

const sanitizeMessage = (
  message: string
): { sanitized: string; redacted: string; truncated: boolean } => {
  const withoutControl = message.replace(CONTROL_CHARACTERS, ' ');
  const collapsedWhitespace = withoutControl.replace(/[ \t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!collapsedWhitespace) {
    return { sanitized: '', redacted: '', truncated: false };
  }

  if (collapsedWhitespace.length > MAX_MESSAGE_LENGTH) {
    const truncatedMessage = collapsedWhitespace.slice(0, MAX_MESSAGE_LENGTH);
    const redacted = redactPhi(truncatedMessage) as string;
    return {
      sanitized: truncatedMessage,
      redacted,
      truncated: true,
    };
  }

  const redacted = redactPhi(collapsedWhitespace) as string;
  return { sanitized: collapsedWhitespace, redacted, truncated: false };
};

export const toGuardrailAuditLogEntry = (
  audit: GuardrailAudit
): GuardrailAuditLogEntry => ({
  auditVersion: audit.auditVersion,
  traceId: audit.traceId,
  actorId: audit.actorId,
  actorRole: audit.actorRole,
  timestamp: audit.timestamp,
  reason: audit.reason,
  allowedTools: audit.allowedTools,
  deniedTools: audit.deniedTools,
  requestedTools: audit.requestedTools,
  toolUsed: audit.toolUsed,
  actionDenied: audit.actionDenied,
  messagePreview: audit.messagePreview,
  redactedPrompt: audit.redactedPrompt,
  truncated: audit.truncated,
  metadata: audit.metadata,
});

export const getRoleAllowedTools = (role: AssistantRole): AssistantTool[] => {
  if (roleToolCache.has(role)) {
    return roleToolCache.get(role) ?? [];
  }

  const roleIndex = ROLE_ORDER.indexOf(role);
  if (roleIndex === -1) {
    roleToolCache.set(role, []);
    return [];
  }

  const allowed = new Set<AssistantTool>();
  for (let index = 0; index <= roleIndex; index += 1) {
    const inheritedRole = ROLE_ORDER[index];
    const tools = ROLE_BASE_TOOLS[inheritedRole] ?? [];
    tools.forEach((tool) => allowed.add(tool));
  }

  const result = Array.from(allowed.values());
  roleToolCache.set(role, result);
  return result;
};

const normalizeRequestedTools = (
  actor: GuardrailActor,
  requestedTools?: AssistantTool[]
): { allowed: AssistantTool[]; denied: AssistantTool[] } => {
  const roleAllowedTools = new Set(getRoleAllowedTools(actor.role));
  const desiredTools = requestedTools ?? actor.allowedTools ?? Array.from(roleAllowedTools.values());
  const uniqueRequested = Array.from(new Set(desiredTools));

  const allowed: AssistantTool[] = [];
  const denied: AssistantTool[] = [];

  uniqueRequested.forEach((tool) => {
    if (roleAllowedTools.has(tool)) {
      allowed.push(tool);
    } else {
      denied.push(tool);
    }
  });

  if (allowed.length === 0 && denied.length === 0) {
    allowed.push(...roleAllowedTools.values());
  }

  return { allowed, denied };
};

export const evaluateAssistantGuardrails = (
  input: GuardrailInput
): GuardrailEvaluation => {
  const actor = input.actor ?? null;
  const traceId = generateTraceId();
  if (!actor || !actor.id || !actor.role) {
    const audit: GuardrailAudit = {
      auditVersion: GUARDRAIL_AUDIT_VERSION,
      traceId,
      actorId: actor?.id ?? 'unknown',
      actorRole: actor?.role ?? 'client',
      timestamp: new Date().toISOString(),
      reason: 'invalid_message',
      allowedTools: [],
      deniedTools: [],
      requestedTools: input.requestedTools ?? [],
      toolUsed: null,
      actionDenied: true,
      messagePreview: '',
      redactedPrompt: '',
      truncated: false,
      metadata: input.metadata,
    };
    const auditLog = toGuardrailAuditLogEntry(audit);
    logger.warn('AI guardrail rejected request without actor context', { metadata: auditLog });
    throw new AssistantGuardrailError(
      'Unable to verify assistant permissions for this request',
      audit,
      auditLog
    );
  }

  const sanitized = sanitizeMessage(input.message);
  if (!sanitized.sanitized) {
    const audit: GuardrailAudit = {
      auditVersion: GUARDRAIL_AUDIT_VERSION,
      traceId,
      actorId: actor.id,
      actorRole: actor.role,
      timestamp: new Date().toISOString(),
      reason: 'invalid_message',
      allowedTools: [],
      deniedTools: [],
      requestedTools: input.requestedTools ?? [],
      toolUsed: null,
      actionDenied: true,
      messagePreview: '',
      redactedPrompt: '',
      truncated: sanitized.truncated,
      metadata: input.metadata,
    };
    const auditLog = toGuardrailAuditLogEntry(audit);
    logger.warn('AI guardrail rejected empty or invalid message', { metadata: auditLog });
    throw new AssistantGuardrailError('Assistant prompt rejected by guardrails', audit, auditLog);
  }

  const violation = DISALLOWED_PATTERNS.find(({ pattern }) => pattern.test(sanitized.sanitized));
  if (violation) {
    const audit: GuardrailAudit = {
      auditVersion: GUARDRAIL_AUDIT_VERSION,
      traceId,
      actorId: actor.id,
      actorRole: actor.role,
      timestamp: new Date().toISOString(),
      reason: violation.reason,
      allowedTools: [],
      deniedTools: [],
      requestedTools: input.requestedTools ?? [],
      toolUsed: null,
      actionDenied: true,
      messagePreview: buildMessagePreview(sanitized.redacted),
      redactedPrompt: sanitized.redacted,
      truncated: sanitized.truncated,
      metadata: {
        ...input.metadata,
        violation: violation.description,
      },
    };
    const auditLog = toGuardrailAuditLogEntry(audit);
    logger.warn('AI guardrail blocked high-risk prompt', { metadata: auditLog });
    throw new AssistantGuardrailError('Assistant prompt violates safety guardrails', audit, auditLog);
  }

  const { allowed, denied } = normalizeRequestedTools(actor, input.requestedTools);
  const requestedTools = input.requestedTools ?? actor.allowedTools ?? getRoleAllowedTools(actor.role);
  const toolUsed = requestedTools.length > 0 ? requestedTools[0] : null;
  const actionDenied = denied.length > 0;
  const messagePreview = buildMessagePreview(sanitized.redacted);

  const audit: GuardrailAudit = {
    auditVersion: GUARDRAIL_AUDIT_VERSION,
    traceId,
    actorId: actor.id,
    actorRole: actor.role,
    timestamp: new Date().toISOString(),
    reason: actionDenied ? 'tool_denied' : 'approved',
    allowedTools: allowed,
    deniedTools: denied,
    requestedTools,
    toolUsed,
    actionDenied,
    messagePreview,
    redactedPrompt: sanitized.redacted,
    truncated: sanitized.truncated,
    metadata: input.metadata,
  };

  const auditLog = toGuardrailAuditLogEntry(audit);

  if (denied.length > 0) {
    logger.warn('AI guardrail denied tool permissions for request', { metadata: auditLog });
    throw new AssistantGuardrailError('Assistant tools not permitted for current role', audit, auditLog);
  }

  logger.info('AI guardrail approved assistant request', { metadata: auditLog });
  return {
    sanitizedMessage: sanitized.redacted,
    allowedTools: allowed,
    auditTrail: audit,
    auditLog,
  };
};
