import { logger } from './logger/logger';

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
  actorId: string;
  role: AssistantRole;
  timestamp: string;
  reason: 'approved' | 'tool_denied' | 'prompt_blocked' | 'invalid_message';
  allowedTools: AssistantTool[];
  deniedTools: AssistantTool[];
  messagePreview: string;
  truncated?: boolean;
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
}

export class AssistantGuardrailError extends Error {
  readonly audit: GuardrailAudit;

  constructor(message: string, audit: GuardrailAudit) {
    super(message);
    this.name = 'AssistantGuardrailError';
    this.audit = audit;
  }
}

const MAX_MESSAGE_LENGTH = 4000;
const CONTROL_CHARACTERS = /[\p{C}]/gu;

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

const sanitizeMessage = (message: string): { sanitized: string; truncated: boolean } => {
  const withoutControl = message.replace(CONTROL_CHARACTERS, ' ');
  const collapsedWhitespace = withoutControl.replace(/[ \t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!collapsedWhitespace) {
    return { sanitized: '', truncated: false };
  }

  if (collapsedWhitespace.length > MAX_MESSAGE_LENGTH) {
    return {
      sanitized: collapsedWhitespace.slice(0, MAX_MESSAGE_LENGTH),
      truncated: true,
    };
  }

  return { sanitized: collapsedWhitespace, truncated: false };
};

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
  if (!actor || !actor.id || !actor.role) {
    const audit: GuardrailAudit = {
      actorId: actor?.id ?? 'unknown',
      role: actor?.role ?? 'client',
      timestamp: new Date().toISOString(),
      reason: 'invalid_message',
      allowedTools: [],
      deniedTools: [],
      messagePreview: '',
      metadata: input.metadata,
    };
    throw new AssistantGuardrailError('Unable to verify assistant permissions for this request', audit);
  }

  const sanitized = sanitizeMessage(input.message);
  if (!sanitized.sanitized) {
    const audit: GuardrailAudit = {
      actorId: actor.id,
      role: actor.role,
      timestamp: new Date().toISOString(),
      reason: 'invalid_message',
      allowedTools: [],
      deniedTools: [],
      messagePreview: '',
      truncated: sanitized.truncated,
      metadata: input.metadata,
    };
    logger.warn('AI guardrail rejected empty or invalid message', { metadata: audit });
    throw new AssistantGuardrailError('Assistant prompt rejected by guardrails', audit);
  }

  const violation = DISALLOWED_PATTERNS.find(({ pattern }) => pattern.test(sanitized.sanitized));
  if (violation) {
    const audit: GuardrailAudit = {
      actorId: actor.id,
      role: actor.role,
      timestamp: new Date().toISOString(),
      reason: violation.reason,
      allowedTools: [],
      deniedTools: [],
      messagePreview: buildMessagePreview(sanitized.sanitized),
      truncated: sanitized.truncated,
      metadata: {
        ...input.metadata,
        violation: violation.description,
      },
    };
    logger.warn('AI guardrail blocked high-risk prompt', { metadata: audit });
    throw new AssistantGuardrailError('Assistant prompt violates safety guardrails', audit);
  }

  const { allowed, denied } = normalizeRequestedTools(actor, input.requestedTools);
  const audit: GuardrailAudit = {
    actorId: actor.id,
    role: actor.role,
    timestamp: new Date().toISOString(),
    reason: denied.length > 0 ? 'tool_denied' : 'approved',
    allowedTools: allowed,
    deniedTools: denied,
    messagePreview: buildMessagePreview(sanitized.sanitized),
    truncated: sanitized.truncated,
    metadata: input.metadata,
  };

  if (denied.length > 0) {
    logger.warn('AI guardrail denied tool permissions for request', { metadata: audit });
    throw new AssistantGuardrailError('Assistant tools not permitted for current role', audit);
  }

  logger.info('AI guardrail approved assistant request', { metadata: audit });
  return {
    sanitizedMessage: sanitized.sanitized,
    allowedTools: allowed,
    auditTrail: audit,
  };
};
