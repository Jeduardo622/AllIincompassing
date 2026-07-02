import { supabase } from '../supabase';
import type { StaffRecipient } from './types';

const STAFF_ROLES = new Set(['bt', 'therapist', 'midtier', 'admin_schedule', 'admin', 'bcba', 'super_admin']);

type RpcStaffRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
};

const mapRpcRows = (rows: RpcStaffRow[]): StaffRecipient[] =>
  rows
    .filter((row) => STAFF_ROLES.has(String(row.role ?? '').toLowerCase()))
    .map((row) => ({
      id: row.user_id,
      full_name: row.full_name?.trim() || row.email?.trim() || 'Staff member',
      email: row.email?.trim() ?? '',
      role: String(row.role ?? ''),
    }));

const isMissingRpc = (error: { code?: string; message?: string }): boolean => {
  const message = (error.message ?? '').toLowerCase();
  return error.code === 'PGRST202' || message.includes('list_eligible_staff_for_messaging');
};

/**
 * Org-safe staff directory for messaging compose.
 * Uses SECURITY DEFINER RPC so therapists are not limited by profiles_select_self RLS.
 */
export const fetchStaffRecipients = async (
  organizationId: string,
  currentUserId: string,
): Promise<StaffRecipient[]> => {
  const { data, error } = await supabase.rpc('list_eligible_staff_for_messaging', {
    p_organization_id: organizationId,
  });

  if (error) {
    if (isMissingRpc(error)) {
      throw new Error(
        'Staff recipient lookup is not available until the list_eligible_staff_for_messaging migration is applied.',
      );
    }
    throw error;
  }

  const rows = (data ?? []) as RpcStaffRow[];
  return mapRpcRows(rows).filter((recipient) => recipient.id !== currentUserId);
};
