// Database verification script
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function verifyDatabase() {
  console.log('Checking database structure...');
  try {
    // Check if key tables exist
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('count(*)', { count: 'exact' })
      .limit(1);
      
    if (clientsError) {
      throw new Error(`clients table check failed: ${clientsError.message}`);
    }
    
    console.log('✓ clients table exists');
    
    const { data: therapists, error: therapistsError } = await supabase
      .from('therapists')
      .select('count(*)', { count: 'exact' })
      .limit(1);
      
    if (therapistsError) {
      throw new Error(`therapists table check failed: ${therapistsError.message}`);
    }
    
    console.log('✓ therapists table exists');
    
    // Check RPC functions
    const { data: rpcTest, error: rpcError } = await supabase.rpc('get_user_roles');
    if (rpcError) {
      console.log(`⚠ RPC function check failed: ${rpcError.message}`);
    } else {
      console.log('✓ RPC functions operational');
    }
    
    // Check for phase-specific features
    const { data: authCache, error: authCacheError } = await supabase
      .from('ai_response_cache')
      .select('count(*)', { count: 'exact' })
      .limit(1);
      
    if (authCacheError) {
      console.log(`⚠ Phase 3/4 feature (ai_response_cache) not found: ${authCacheError.message}`);
    } else {
      console.log('✓ Phase 3/4 features present (ai_response_cache)');
    }

    console.log('\nDatabase verification complete!');
  } catch (error) {
    console.error('Database verification failed:', error.message);
  }
}

verifyDatabase();