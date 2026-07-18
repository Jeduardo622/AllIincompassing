import { supabase } from './supabase';

type SupabaseUntyped = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

const callRpc = (fn: string, args: Record<string, unknown>) => (supabase as unknown as SupabaseUntyped).rpc(fn, args);

export type SupervisionWorkflowStatus =
  | 'pending'
  | 'correction_required'
  | 'resubmitted'
  | 'completed'
  | 'cancelled';

export const SUPERVISION_STATUS_LABELS: Record<SupervisionWorkflowStatus, string> = {
  pending: 'Pending Review',
  correction_required: 'Correction Required',
  resubmitted: 'Resubmitted',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

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

export type BtNoteVersion = {
  versionNumber: number;
  noteId: string;
  source: 'original' | 'amendment';
  correctionRound: number | null;
  responses: Record<string, unknown>;
  templateSnapshot: { sections: SupervisionTemplateSection[] };
  signatureMethod: 'typed' | 'drawn' | null;
  signatureValue: string | null;
  signedAt: string | null;
};

export type SupervisionCorrectionMetadata = {
  id: string;
  round: number | null;
  reason: string;
  requestedAt: string | null;
  reviewerUserId: string | null;
};

export type SupervisionBtReviewPacket = {
  noteId: string;
  responses: Record<string, unknown>;
  templateSnapshot: { sections: SupervisionTemplateSection[] };
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
  status: SupervisionWorkflowStatus;
  statusLabel: string;
  createdAt: string;
  sessionStartTime: string | null;
  sessionEndTime: string | null;
  placeOfService: string | null;
  clientName: string;
  btTherapistName: string;
  btTherapistTitle: string | null;
  canComplete: boolean;
  canReturn: boolean;
  latestVersionNumber: number;
  correction: SupervisionCorrectionMetadata | null;
  versions: BtNoteVersion[];
  btReview: SupervisionBtReviewPacket;
};

export type BtCorrectionTask = {
  id: string;
  organizationId: string;
  sessionId: string;
  clientId: string;
  btTherapistId: string;
  assignedAdminUserId: string | null;
  status: SupervisionWorkflowStatus;
  statusLabel: string;
  createdAt: string;
  clientName: string;
  btTherapistName: string;
  btTherapistTitle: string | null;
  correction: SupervisionCorrectionMetadata;
  originalVersion: BtNoteVersion;
  latestVersion: BtNoteVersion;
  versions: BtNoteVersion[];
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
  request_status: SupervisionWorkflowStatus;
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
  can_return: boolean;
  correction_id: string | null;
  correction_round: number | null;
  correction_reason: string | null;
  correction_requested_at: string | null;
  correction_reviewer_user_id: string | null;
  latest_version_number: number | null;
  review_versions: unknown;
};

type BtCorrectionTaskRow = {
  request_id: string;
  organization_id: string;
  session_id: string;
  client_id: string;
  bt_therapist_id: string;
  assigned_reviewer_user_id: string | null;
  request_status: SupervisionWorkflowStatus;
  request_created_at: string;
  client_name: string | null;
  bt_therapist_name: string | null;
  bt_therapist_title: string | null;
  correction_id: string | null;
  correction_round: number | null;
  correction_reason: string | null;
  correction_requested_at: string | null;
  correction_reviewer_user_id: string | null;
  original_version: unknown;
  latest_version: unknown;
  review_versions: unknown;
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

const normalizeWorkflowStatus = (value: unknown): SupervisionWorkflowStatus => {
  switch (value) {
    case 'pending':
    case 'correction_required':
    case 'resubmitted':
    case 'completed':
    case 'cancelled':
      return value;
    default:
      throw new Error('Unsupported supervision workflow status.');
  }
};

const normalizeCorrection = (row: {
  correction_id: string | null;
  correction_round: number | null;
  correction_reason: string | null;
  correction_requested_at: string | null;
  correction_reviewer_user_id: string | null;
}): SupervisionCorrectionMetadata | null => {
  if (!row.correction_id) {
    return null;
  }

  return {
    id: row.correction_id,
    round: typeof row.correction_round === 'number' ? row.correction_round : null,
    reason: row.correction_reason?.trim() || '',
    requestedAt: row.correction_requested_at,
    reviewerUserId: row.correction_reviewer_user_id,
  };
};

const normalizeVersion = (value: unknown): BtNoteVersion | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;
  const noteId = typeof row.note_id === 'string' ? row.note_id : '';
  const source = row.source === 'amendment' ? 'amendment' : row.source === 'original' ? 'original' : null;
  const versionNumber = typeof row.version_number === 'number' ? row.version_number : null;

  if (!noteId || !source || versionNumber === null) {
    return null;
  }

  return {
    versionNumber,
    noteId,
    source,
    correctionRound: typeof row.correction_round === 'number' ? row.correction_round : null,
    responses: normalizeResponses(row.responses),
    templateSnapshot: { sections: normalizeSections(row.template_snapshot) },
    signatureMethod: row.signature_method === 'typed' || row.signature_method === 'drawn'
      ? row.signature_method
      : null,
    signatureValue: typeof row.signature_value === 'string' ? row.signature_value : null,
    signedAt: typeof row.signed_at === 'string' ? row.signed_at : null,
  };
};

const normalizeVersions = (value: unknown): BtNoteVersion[] => (
  Array.isArray(value)
    ? value
      .map(normalizeVersion)
      .filter((version): version is BtNoteVersion => version !== null)
    : []
);

const deriveTemplate = (row: ReviewPacketRow | undefined): SupervisionSessionNoteTemplate | null => {
  const templateId = row?.supervision_template_id?.trim();
  const templateName = row?.supervision_template_name?.trim();

  if (!templateId || !templateName) {
    return null;
  }

  return {
    id: templateId,
    templateName,
    sections: normalizeSections(row.supervision_template_structure),
  };
};

const mapReviewPacketRow = (row: ReviewPacketRow): PendingSupervisionSessionNoteRequest => {
  const status = normalizeWorkflowStatus(row.request_status);
  const versions = normalizeVersions(row.review_versions);

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
    status,
    statusLabel: SUPERVISION_STATUS_LABELS[status],
    createdAt: row.request_created_at,
    sessionStartTime: row.session_start_time,
    sessionEndTime: row.session_end_time,
    placeOfService: row.place_of_service,
    clientName: row.client_name?.trim() || 'Client',
    btTherapistName: row.bt_therapist_name?.trim() || 'BT/RBT',
    btTherapistTitle: row.bt_therapist_title ?? null,
    canComplete: Boolean(row.can_complete),
    canReturn: Boolean(row.can_return),
    latestVersionNumber: typeof row.latest_version_number === 'number' ? row.latest_version_number : 1,
    correction: normalizeCorrection(row),
    versions,
    btReview: {
      noteId: row.bt_note_id,
      responses: normalizeResponses(row.bt_responses),
      templateSnapshot: { sections: normalizeSections(row.bt_template_snapshot) },
      signatureMethod: row.bt_signature_method,
      signedAt: row.bt_signed_at,
    },
  };
};

const mapBtCorrectionTaskRow = (row: BtCorrectionTaskRow): BtCorrectionTask => {
  const status = normalizeWorkflowStatus(row.request_status);
  const correction = normalizeCorrection(row);
  const originalVersion = normalizeVersion(row.original_version);
  const latestVersion = normalizeVersion(row.latest_version);

  if (!correction) {
    throw new Error('Correction metadata is unavailable for this BT task.');
  }
  if (!originalVersion) {
    throw new Error('Original BT review packet is unavailable for this correction task.');
  }
  if (!latestVersion) {
    throw new Error('Latest BT review packet is unavailable for this correction task.');
  }

  return {
    id: row.request_id,
    organizationId: row.organization_id,
    sessionId: row.session_id,
    clientId: row.client_id,
    btTherapistId: row.bt_therapist_id,
    assignedAdminUserId: row.assigned_reviewer_user_id,
    status,
    statusLabel: SUPERVISION_STATUS_LABELS[status],
    createdAt: row.request_created_at,
    clientName: row.client_name?.trim() || 'Client',
    btTherapistName: row.bt_therapist_name?.trim() || 'BT/RBT',
    btTherapistTitle: row.bt_therapist_title ?? null,
    correction,
    originalVersion,
    latestVersion,
    versions: normalizeVersions(row.review_versions),
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

  const packets = Array.isArray(data) ? data as ReviewPacketRow[] : [];
  const firstPacket = packets[0];

  return {
    requests: packets.map(mapReviewPacketRow),
    template: deriveTemplate(firstPacket),
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

export type ReturnSupervisionRequestToBtInput = {
  organizationId: string;
  requestId: string;
  reason: string;
};

export const returnSupervisionRequestToBt = async (
  input: ReturnSupervisionRequestToBtInput,
): Promise<{ correctionId: string }> => {
  if (!input.organizationId) {
    throw new Error('Organization context is required to return a supervision note.');
  }

  const reason = input.reason.trim();
  if (!reason) {
    throw new Error('Correction reason is required.');
  }
  if (reason.length > 2000) {
    throw new Error('Correction reason must be 2000 characters or fewer.');
  }

  const { data, error } = await callRpc('return_supervision_session_note_request_to_bt', {
    p_request_id: input.requestId,
    p_reason: reason,
  });

  if (error) {
    throw error;
  }

  return { correctionId: String(data) };
};

export const fetchBtSupervisionCorrectionTasks = async (
  organizationId: string,
): Promise<BtCorrectionTask[]> => {
  if (!organizationId) {
    throw new Error('Organization context is required to load BT correction tasks.');
  }

  const { data, error } = await callRpc('get_bt_supervision_correction_tasks', {});
  if (error) {
    throw error;
  }

  const tasks = Array.isArray(data) ? data as BtCorrectionTaskRow[] : [];
  return tasks.map(mapBtCorrectionTaskRow);
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

export type ResubmitBtSupervisionCorrectionInput = {
  organizationId: string;
  requestId: string;
  responses: Record<string, unknown>;
  signature: ClinicalSignatureValue;
};

export const resubmitBtSupervisionCorrection = async (
  input: ResubmitBtSupervisionCorrectionInput,
): Promise<{ amendmentId: string }> => {
  if (!input.organizationId) {
    throw new Error('Organization context is required to resubmit a BT correction.');
  }

  const { data, error } = await callRpc('resubmit_bt_supervision_correction', {
    p_request_id: input.requestId,
    p_responses: input.responses,
    p_signature_method: input.signature.method,
    p_signature_value: input.signature.value,
  });

  if (error) {
    throw error;
  }

  return { amendmentId: String(data) };
};

export const fetchPendingSupervisionSessionNoteCount = async (
  organizationId: string,
): Promise<number> => {
  if (!organizationId) {
    throw new Error('Organization context is required to load supervision note notifications.');
  }

  const { data, error } = await callRpc('get_supervision_session_note_action_count', {});

  if (error) {
    throw error;
  }

  return typeof data === 'number' ? data : Number(data ?? 0);
};
