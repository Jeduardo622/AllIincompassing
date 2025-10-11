import type { SupabaseClient } from '@supabase/supabase-js';
import type { Client } from '../../types';
import type { Database } from '../generated/database.types';
import { supabase } from '../supabase';
import { CLIENT_SELECT } from './select';

export type ClientsSupabaseClient = SupabaseClient<Database>;

const DEFAULT_ORDER_COLUMN = 'full_name';

export const fetchClients = async (
  client: ClientsSupabaseClient = supabase
): Promise<Client[]> => {
  const { data, error } = await client
    .from('clients')
    .select(CLIENT_SELECT)
    .order(DEFAULT_ORDER_COLUMN, { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as Client[];
};

export const fetchClientById = async (
  clientId: string,
  client: ClientsSupabaseClient = supabase
): Promise<Client | null> => {
  const { data, error } = await client
    .from('clients')
    .select(CLIENT_SELECT)
    .eq('id', clientId)
    .single();

  if (error) {
    throw error;
  }

  return (data ?? null) as Client | null;
};
