import { supabase } from './supabase';

type SupabaseUntyped = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

const fromTable = (table: string) => (supabase as unknown as SupabaseUntyped).from(table);
const callRpc = (fn: string, args: Record<string, unknown>) => (supabase as unknown as SupabaseUntyped).rpc(fn, args);

export type SupervisionTemplateField = {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  required_when?: string;
  options?: string[];
  placeholder?: string;
};

export type SupervisionTemplateSection = {
  key: string;
  label?: string;
  fields?: SupervisionTemplateField[];
};

export type SupervisionSessionNoteTemplate = {
  id: string;
  templateName: string;
  sections: SupervisionTemplateSection[];
};

export type ClinicalSignatureValue = {
  method: 'typed' | 'drawn';
  value: string;
};

export type SupervisionBtReviewPacket = {
  noteId: string;
  responses: Record<string, unknown>;
  templateSnapshot: { sections?: SupervisionTemplateSection[] };
  signatureMethod: 'typed' | 'drawn' | null;
  signedAt: string | null;
};

export type PendingSupervisionSessionNoteRequest = {
  id: string;
  organizationId: string;
  sessionId: string;
  clientId: string;
  btTherapistId: string;
  assignedAdminUserId: string | null;
  status: string;
  createdAt: string;
  sessionStartTime: string | null;
  sessionEndTime: string | null;
  placeOfService: string | null;
  clientName: string;
  btTherapistName: string;
  btTherapistTitle: string | null;
  canComplete: boolean;
  btReview: SupervisionBtReviewPacket;
};

export type PendingSupervisionSessionNoteResult = {
  requests: PendingSupervisionSessionNoteRequest[];
  template: SupervisionSessionNoteTemplate | null;
};

export const SUPERVISION_SESSION_NOTES_QUERY_KEY = 'supervision-session-note-requests' as const;

type ReviewPacketRow = {
  request_id: string;
  organization_id: string;
  session_id: string;
  client_id: string;
  bt_therapist_id: string;
  assigned_reviewer_user_id: string | null;
  request_status: string;
  request_created_at: string;
  session_start_time: string | null;
  session_end_time: string | null;
  place_of_service: string | null;
  client_name: string | null;
  bt_therapist_name: string | null;
  bt_therapist_title: string | null;
  bt_note_id: string | null;
  bt_responses: unknown;
  bt_template_snapshot: unknown;
  bt_signature_method: 'typed' | 'drawn' | null;
  bt_signed_at: string | null;
  supervision_template_id: string;
  supervision_template_name: string;
  supervision_template_structure: unknown;
  can_complete: boolean;
};

const normalizeSections = (value: unknown): SupervisionTemplateSection[] => {
  const structure = value && typeof value === 'object'
    ? value as { sections?: SupervisionTemplateSection[] }
    : {};
  return Array.isArray(structure.sections) ? structure.sections : [];
};

const normalizeResponses = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const mapReviewPacketRow = (row: ReviewPacketRow): PendingSupervisionSessionNoteRequest => {
  if (!row.bt_note_id) {
    throw new Error('Completed BT note is unavailable for supervision review.');
  }

  return {
    id: row.request_id,
    organizationId: row.organization_id,
    sessionId: row.session_id,
    clientId: row.client_id,
    btTherapistId: row.bt_therapist_id,
    assignedAdminUserId: row.assigned_reviewer_user_id,
    status: row.request_status,
    createdAt: row.request_created_at,
    sessionStartTime: row.session_start_time,
    sessionEndTime: row.session_end_time,
    placeOfService: row.place_of_service,
    clientName: row.client_name?.trim() || 'Client',
    btTherapistName: row.bt_therapist_name?.trim() || 'BT/RBT',
    btTherapistTitle: row.bt_therapist_title ?? null,
    canComplete: Boolean(row.can_complete),
    btReview: {
      noteId: row.bt_note_id,
      responses: normalizeResponses(row.bt_responses),
      templateSnapshot: { sections: normalizeSections(row.bt_template_snapshot) },
      signatureMethod: row.bt_signature_method,
      signedAt: row.bt_signed_at,
    },
  };
};

export const fetchPendingSupervisionSessionNoteRequests = async (
  organizationId: string,
): Promise<PendingSupervisionSessionNoteResult> => {
  if (!organizationId) {
    throw new Error('Organization context is required to load supervision note requests.');
  }

  const { data, error } = await callRpc('get_pending_supervision_review_packets', {});
  if (error) {
    throw error;
  }

  const packets = (data ?? []) as ReviewPacketRow[];
  const firstPacket = packets[0];

  return {
    requests: packets.map(mapReviewPacketRow),
    template: firstPacket
      ? {
        id: firstPacket.supervision_template_id,
        templateName: firstPacket.supervision_template_name,
        sections: normalizeSections(firstPacket.supervision_template_structure),
      }
      : null,
  };
};

export const reconcilePendingSupervisionSessionNoteRequests = async (
  organizationId: string,
): Promise<void> => {
  if (!organizationId) {
    throw new Error('Organization context is required to reconcile supervision note requests.');
  }

  const reconcileResult = await callRpc('reconcile_supervision_session_note_requests', {});
  if (reconcileResult.error) {
    throw reconcileResult.error;
  }
};

export type CompleteSupervisionSessionNoteInput = {
  organizationId: string;
  requestId: string;
  templateId: string;
  responses: Record<string, unknown>;
};

export const completeSupervisionSessionNote = async (
  input: CompleteSupervisionSessionNoteInput,
): Promise<{ noteId: string }> => {
  if (!input.organizationId) {
    throw new Error('Organization context is required to complete a supervision note.');
  }

  const { data, error } = await callRpc('complete_supervision_session_note_request', {
    p_request_id: input.requestId,
    p_template_id: input.templateId,
    p_responses: input.responses,
  });

  if (error) {
    throw error;
  }

  return { noteId: String(data) };
};

export const fetchPendingSupervisionSessionNoteCount = async (
  organizationId: string,
): Promise<number> => {
  if (!organizationId) {
    throw new Error('Organization context is required to load supervision note notifications.');
  }

  const { count, error } = await fromTable('supervision_session_note_requests')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('status', 'pending');

  if (error) {
    throw error;
  }

  return count ?? 0;
};
