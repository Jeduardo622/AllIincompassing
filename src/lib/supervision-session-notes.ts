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
  clientName: string;
  btTherapistName: string;
  btTherapistTitle: string | null;
};

export type PendingSupervisionSessionNoteResult = {
  requests: PendingSupervisionSessionNoteRequest[];
  template: SupervisionSessionNoteTemplate | null;
};

type RequestRow = {
  id: string;
  organization_id: string;
  session_id: string;
  client_id: string;
  bt_therapist_id: string;
  assigned_admin_user_id: string | null;
  status: string;
  created_at: string;
  sessions?: { start_time?: string | null; end_time?: string | null } | null;
  clients?: { full_name?: string | null } | null;
  therapists?: { full_name?: string | null; title?: string | null } | null;
};

type TemplateRow = {
  id: string;
  template_name: string;
  template_structure: unknown;
};

const normalizeTemplate = (row: TemplateRow | null): SupervisionSessionNoteTemplate | null => {
  if (!row) {
    return null;
  }
  const structure = row.template_structure && typeof row.template_structure === 'object'
    ? row.template_structure as { sections?: SupervisionTemplateSection[] }
    : {};
  return {
    id: row.id,
    templateName: row.template_name,
    sections: Array.isArray(structure.sections) ? structure.sections : [],
  };
};

const mapRequestRow = (row: RequestRow): PendingSupervisionSessionNoteRequest => ({
  id: row.id,
  organizationId: row.organization_id,
  sessionId: row.session_id,
  clientId: row.client_id,
  btTherapistId: row.bt_therapist_id,
  assignedAdminUserId: row.assigned_admin_user_id,
  status: row.status,
  createdAt: row.created_at,
  sessionStartTime: row.sessions?.start_time ?? null,
  sessionEndTime: row.sessions?.end_time ?? null,
  clientName: row.clients?.full_name?.trim() || 'Client',
  btTherapistName: row.therapists?.full_name?.trim() || 'BT/RBT',
  btTherapistTitle: row.therapists?.title ?? null,
});

export const fetchPendingSupervisionSessionNoteRequests = async (
  organizationId: string,
): Promise<PendingSupervisionSessionNoteResult> => {
  if (!organizationId) {
    throw new Error('Organization context is required to load supervision note requests.');
  }

  const reconcileResult = await callRpc('reconcile_supervision_session_note_requests', {});
  if (reconcileResult.error) {
    throw reconcileResult.error;
  }

  const [requestsResult, templateResult] = await Promise.all([
    fromTable('supervision_session_note_requests')
      .select(`
        id,
        organization_id,
        session_id,
        client_id,
        bt_therapist_id,
        assigned_admin_user_id,
        status,
        created_at,
        sessions:session_id(start_time,end_time),
        clients:client_id(full_name),
        therapists:bt_therapist_id(full_name,title)
      `)
      .eq('organization_id', organizationId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    fromTable('session_note_templates')
      .select('id, template_name, template_structure')
      .eq('organization_id', organizationId)
      .eq('template_type', 'supervision_session_note')
      .maybeSingle(),
  ]);

  if (requestsResult.error) {
    throw requestsResult.error;
  }
  if (templateResult.error) {
    throw templateResult.error;
  }

  return {
    requests: ((requestsResult.data ?? []) as RequestRow[]).map(mapRequestRow),
    template: normalizeTemplate((templateResult.data ?? null) as TemplateRow | null),
  };
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
