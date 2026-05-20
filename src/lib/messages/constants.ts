export const MESSAGE_BODY_MAX_LENGTH = 8000;

export const PHI_POLICY_BANNER =
  'Staff messaging must not include PHI, client names, clinical details, or other client-sensitive content.';

export const PHI_POLICY_COMPOSER_HINT =
  'Do not include client names, clinical details, or identifiers in messages.';

export const STAFF_MESSAGING_REFETCH_MS = 30_000;

export const STAFF_ROLE_NAMES = [
  'therapist',
  'org_member',
  'admin',
  'org_admin',
  'super_admin',
  'org_super_admin',
] as const;

export const MESSAGES_ROUTES = {
  inbox: '/messages',
  new: '/messages/new',
  thread: (threadId: string) => `/messages/${threadId}`,
} as const;
