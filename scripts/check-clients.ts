import { createClient } from '@supabase/supabase-js';
import { CLIENT_SELECT } from '../src/lib/clients/select';
import type { Database } from '../src/lib/generated/database.types';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

if (!SUPABASE_URL) {
  throw new Error('SUPABASE_URL environment variable is required');
}

if (!SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_ANON_KEY environment variable is required');
}

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);

const main = async () => {
  const { data, error, status } = await supabase
    .from('clients')
    .select(CLIENT_SELECT)
    .limit(1);

  if (error || status !== 200) {
    throw new Error(JSON.stringify({ status, error }, null, 2));
  }

  if (!Array.isArray(data)) {
    throw new Error('Unexpected response shape: expected an array');
  }

  console.log('OK: 200 with expected shape');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
