import type { Json } from '../../lib/generated/database.types';
import { getRequiredServerEnv } from '../env';

export interface AdminUserRecord {
  id?: string;
  user_id?: string;
  email?: string;
  created_at?: string;
  raw_user_meta_data?: Json | null;
}

export class AdminRpcError extends Error {
  readonly functionName: string;
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly hint?: unknown;
  readonly requestId?: string;

  constructor(
    functionName: string,
    message: string,
    status: number,
    options: {
      code?: string | null;
      details?: unknown;
      hint?: unknown;
      requestId?: string | null;
    } = {},
  ) {
    super(message);
    this.name = 'AdminRpcError';
    this.functionName = functionName;
    this.status = status;
    this.code = typeof options.code === 'string' ? options.code : undefined;
    this.details = options.details;
    this.hint = options.hint;
    this.requestId = typeof options.requestId === 'string' ? options.requestId : undefined;
  }
}

interface CallAdminRpcOptions {
  signal?: AbortSignal;
}

type RpcPayload = Record<string, unknown> | undefined;

type RpcResult<T> = T | null | undefined;

const JSON_CONTENT_TYPE = 'application/json';

function buildRpcUrl(baseUrl: string, functionName: string): string {
  const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmedBase}/rest/v1/rpc/${functionName}`;
}

function sanitizePayload(payload: RpcPayload): Record<string, unknown> {
  if (!payload) {
    return {};
  }

  return Object.entries(payload).reduce<Record<string, unknown>>((accumulator, [key, value]) => {
    if (value === undefined) {
      return accumulator;
    }

    if (value === null) {
      accumulator[key] = null;
      return accumulator;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return accumulator;
      }
      accumulator[key] = trimmed;
      return accumulator;
    }

    accumulator[key] = value;
    return accumulator;
  }, {});
}

async function parseSuccessBody<T>(response: Response): Promise<RpcResult<T>> {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes(JSON_CONTENT_TYPE)) {
    return text as unknown as RpcResult<T>;
  }

  try {
    return JSON.parse(text) as RpcResult<T>;
  } catch (error) {
    throw new AdminRpcError(
      'parse_success_body',
      'RPC response payload could not be parsed as JSON',
      response.status,
      {
        details: { raw: text },
        hint: error instanceof Error ? error.message : undefined,
        requestId: response.headers.get('x-request-id'),
      },
    );
  }
}

async function buildRpcError(functionName: string, response: Response): Promise<AdminRpcError> {
  let parsed: Record<string, unknown> | null = null;
  try {
    const text = await response.text();
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  const message = typeof parsed?.message === 'string'
    ? parsed.message
    : `RPC ${functionName} failed with status ${response.status}`;

  return new AdminRpcError(functionName, message, response.status, {
    code: typeof parsed?.code === 'string' ? parsed.code : undefined,
    details: parsed?.details,
    hint: parsed?.hint,
    requestId: response.headers.get('x-request-id'),
  });
}

async function callAdminRpc<T>(
  functionName: string,
  payload: RpcPayload,
  options: CallAdminRpcOptions = {},
): Promise<RpcResult<T>> {
  const supabaseUrl = getRequiredServerEnv('SUPABASE_URL');
  const serviceRoleKey = getRequiredServerEnv('SUPABASE_SERVICE_ROLE_KEY');

  const endpoint = buildRpcUrl(supabaseUrl, functionName);
  const sanitizedPayload = sanitizePayload(payload);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': JSON_CONTENT_TYPE,
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(sanitizedPayload),
    signal: options.signal,
  });

  if (!response.ok) {
    throw await buildRpcError(functionName, response);
  }

  return parseSuccessBody<T>(response);
}

export async function listAdminUsers({
  organizationId,
  signal,
}: {
  organizationId?: string | null;
  signal?: AbortSignal;
}): Promise<AdminUserRecord[]> {
  const normalizedOrgId = organizationId?.trim();

  const result = await callAdminRpc<AdminUserRecord[]>(
    'get_admin_users',
    { organization_id: normalizedOrgId ?? null },
    { signal },
  );

  return Array.isArray(result) ? result : [];
}

export async function assignAdminRole({
  userEmail,
  organizationId,
  reason,
  signal,
}: {
  userEmail: string;
  organizationId: string;
  reason?: string;
  signal?: AbortSignal;
}): Promise<void> {
  const normalizedEmail = userEmail?.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('userEmail is required to assign an admin role');
  }

  const normalizedOrgId = organizationId?.trim();
  if (!normalizedOrgId) {
    throw new Error('organizationId is required to assign an admin role');
  }

  await callAdminRpc<undefined>(
    'assign_admin_role',
    {
      user_email: normalizedEmail,
      organization_id: normalizedOrgId,
      reason,
    },
    { signal },
  );
}

export async function removeAdminUser({
  targetUserId,
  metadata,
  signal,
}: {
  targetUserId: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<void> {
  const normalizedTargetId = targetUserId?.trim();
  if (!normalizedTargetId) {
    throw new Error('targetUserId is required to remove an admin user');
  }

  await callAdminRpc<undefined>(
    'manage_admin_users',
    {
      operation: 'remove',
      target_user_id: normalizedTargetId,
      metadata,
    },
    { signal },
  );
}

export async function resetAdminPassword({
  userEmail,
  newPassword,
  createIfNotExists = false,
  signal,
}: {
  userEmail: string;
  newPassword: string;
  createIfNotExists?: boolean;
  signal?: AbortSignal;
}): Promise<void> {
  const normalizedEmail = userEmail?.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('userEmail is required to reset an admin password');
  }

  const normalizedPassword = newPassword?.trim();
  if (!normalizedPassword) {
    throw new Error('newPassword is required to reset an admin password');
  }

  const basePayload: Record<string, unknown> = {
    target_email: normalizedEmail,
    new_password: normalizedPassword,
    create_if_not_exists: createIfNotExists ? true : undefined,
  };

  try {
    await callAdminRpc<undefined>('reset_user_password', basePayload, { signal });
  } catch (error) {
    if (error instanceof AdminRpcError && error.status === 404) {
      await callAdminRpc<undefined>(
        'admin_reset_user_password',
        {
          user_email: normalizedEmail,
          new_password: normalizedPassword,
          create_if_not_exists: createIfNotExists ? true : undefined,
        },
        { signal },
      );
      return;
    }

    throw error;
  }
}
