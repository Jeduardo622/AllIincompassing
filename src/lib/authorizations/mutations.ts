import { supabase } from '../supabase';

export interface AuthorizationServiceInput {
  service_code: string;
  service_description?: string | null;
  from_date: string;
  to_date: string;
  requested_units: number;
  approved_units?: number | null;
  unit_type?: string | null;
  decision_status?: string | null;
}

export interface CreateAuthorizationWithServicesInput {
  client_id: string;
  provider_id: string;
  authorization_number: string;
  diagnosis_code: string;
  diagnosis_description?: string | null;
  start_date: string;
  end_date: string;
  status?: string | null;
  insurance_provider_id?: string | null;
  plan_type?: string | null;
  member_id?: string | null;
  services: AuthorizationServiceInput[];
}

export async function createAuthorizationWithServices(
  input: CreateAuthorizationWithServicesInput,
): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('create_authorization_with_services', {
    p_client_id: input.client_id,
    p_provider_id: input.provider_id,
    p_authorization_number: input.authorization_number,
    p_diagnosis_code: input.diagnosis_code,
    p_diagnosis_description: input.diagnosis_description ?? null,
    p_start_date: input.start_date,
    p_end_date: input.end_date,
    p_status: input.status ?? null,
    p_insurance_provider_id: input.insurance_provider_id ?? null,
    p_plan_type: input.plan_type ?? null,
    p_member_id: input.member_id ?? null,
    p_services: input.services,
  });

  if (error) {
    throw error;
  }

  if (!data || typeof (data as any).id !== 'string') {
    throw new Error('Authorization RPC returned an unexpected payload');
  }

  return { id: (data as any).id as string };
}

export interface UpdateAuthorizationWithServicesInput extends CreateAuthorizationWithServicesInput {
  authorization_id: string;
}

export async function updateAuthorizationWithServices(
  input: UpdateAuthorizationWithServicesInput,
): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('update_authorization_with_services', {
    p_authorization_id: input.authorization_id,
    p_authorization_number: input.authorization_number,
    p_client_id: input.client_id,
    p_provider_id: input.provider_id,
    p_diagnosis_code: input.diagnosis_code,
    p_diagnosis_description: input.diagnosis_description ?? null,
    p_start_date: input.start_date,
    p_end_date: input.end_date,
    p_status: input.status ?? null,
    p_insurance_provider_id: input.insurance_provider_id ?? null,
    p_plan_type: input.plan_type ?? null,
    p_member_id: input.member_id ?? null,
    p_services: input.services,
  });

  if (error) {
    throw error;
  }

  if (!data || typeof (data as any).id !== 'string') {
    throw new Error('Authorization update RPC returned an unexpected payload');
  }

  return { id: (data as any).id as string };
}

export interface AuthorizationDocumentInput {
  name: string;
  path: string;
  size: number;
  type: string;
}

export async function updateAuthorizationDocuments(input: {
  authorization_id: string;
  documents: AuthorizationDocumentInput[];
}): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('update_authorization_documents', {
    p_authorization_id: input.authorization_id,
    p_documents: input.documents,
  });

  if (error) {
    throw error;
  }

  if (!data || typeof (data as any).id !== 'string') {
    throw new Error('Authorization documents RPC returned an unexpected payload');
  }

  return { id: (data as any).id as string };
}

