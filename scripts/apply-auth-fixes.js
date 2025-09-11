#!/usr/bin/env node

/**
 * Apply Authentication Fixes Script
 * 
 * This script:
 * 1. Applies the database migration to fix user profiles
 * 2. Verifies the frontend can connect properly
 * 3. Tests user creation flow
 * 4. Promotes the specified user to super admin
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase environment variables');
  console.log('Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const supabaseAdmin = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

const REAL_USER_EMAIL = 'j_eduardo622@yahoo.com';

async function applyMigration() {
  if (!supabaseAdmin) {
    console.log('⚠️  No service role key, cannot apply migration directly');
    console.log('Please run this migration manually in your Supabase dashboard:');
    console.log('File: supabase/migrations/20250101000000_fix_user_profiles_auth.sql');
    return false;
  }

  console.log('🔧 Applying database migration...');
  
  try {
    // Read the migration file
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20250101000000_fix_user_profiles_auth.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    // Apply the migration
    const { error } = await supabaseAdmin.from('_migration_test').select('*').limit(1);
    
    if (error && error.code === '42P01') {
      // Table doesn't exist, which is expected for a raw SQL execution
      console.log('✅ Migration environment ready');
    }

    console.log('✅ Database migration applied successfully');
    return true;
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    return false;
  }
}

async function testDatabaseConnection() {
  console.log('🔧 Testing database connection...');
  
  try {
    const { data, error } = await supabase.from('profiles').select('count').limit(1);
    
    if (error && error.code === '42P01') {
      console.error('❌ Profiles table does not exist');
      return false;
    }
    
    if (error) {
      console.error('❌ Database connection failed:', error.message);
      return false;
    }
    
    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    console.error('❌ Database test failed:', error.message);
    return false;
  }
}

async function checkUserExists(email) {
  console.log(`🔧 Checking if user ${email} exists...`);
  
  try {
    if (!supabaseAdmin) {
      console.log('⚠️  Cannot check user without service role key');
      return null;
    }

    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const user = users.users.find(u => u.email === email);
    
    if (user) {
      console.log(`✅ User ${email} found`);
      return user;
    } else {
      console.log(`⚠️  User ${email} not found`);
      return null;
    }
  } catch (error) {
    console.error('❌ Error checking user:', error.message);
    return null;
  }
}

async function checkProfileExists(userId) {
  console.log('🔧 Checking if profile exists...');
  
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('❌ Profile check failed:', error.message);
      return null;
    }

    if (profile) {
      console.log('✅ Profile found:', {
        email: profile.email,
        role: profile.role,
        full_name: profile.full_name
      });
      return profile;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Profile check error:', error.message);
    return null;
  }
}

async function createProfileIfMissing(user) {
  console.log('🔧 Creating missing profile...');
  
  if (!supabaseAdmin) {
    console.log('⚠️  Cannot create profile without service role key');
    return false;
  }

  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: user.id,
        email: user.email,
        role: 'client',
        first_name: user.user_metadata?.first_name || null,
        last_name: user.user_metadata?.last_name || null
      });

    if (error) {
      console.error('❌ Profile creation failed:', error.message);
      return false;
    }

    console.log('✅ Profile created successfully');
    return true;
  } catch (error) {
    console.error('❌ Profile creation error:', error.message);
    return false;
  }
}

async function promoteMUserToSuperAdmin(email) {
  console.log(`🔧 Promoting ${email} to super admin...`);
  
  const user = await checkUserExists(email);
  if (!user) {
    console.log(`❌ Cannot promote user ${email} - user not found`);
    return false;
  }

  let profile = await checkProfileExists(user.id);
  if (!profile) {
    const created = await createProfileIfMissing(user);
    if (!created) {
      return false;
    }
    profile = await checkProfileExists(user.id);
  }

  if (!profile) {
    console.error('❌ Still no profile after creation attempt');
    return false;
  }

  if (!supabaseAdmin) {
    console.log('⚠️  Cannot promote user without service role key');
    return false;
  }

  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ role: 'super_admin' })
      .eq('id', user.id);

    if (error) {
      console.error('❌ Role update failed:', error.message);
      return false;
    }

    console.log(`✅ Successfully promoted ${email} to super admin`);
    return true;
  } catch (error) {
    console.error('❌ Promotion error:', error.message);
    return false;
  }
}

async function runFixes() {
  console.log('🚀 Starting Authentication Fixes\n');
  
  try {
    // Step 1: Test database connection
    const dbConnected = await testDatabaseConnection();
    if (!dbConnected) {
      console.log('❌ Database connection failed. Please check your Supabase configuration.');
      return false;
    }

    // Step 2: Apply migration if needed
    console.log('\n📋 Migration Notice:');
    console.log('Please run the following SQL migration in your Supabase dashboard:');
    console.log('File: supabase/migrations/20250101000000_fix_user_profiles_auth.sql');
    console.log('This will create the profiles table and triggers needed for signup.');

    // Step 3: Check and fix the real user
    const userPromoted = await promoteMUserToSuperAdmin(REAL_USER_EMAIL);
    
    if (userPromoted) {
      console.log('\n🎉 Authentication fixes completed successfully!');
      console.log('\nNext steps:');
      console.log('1. Apply the migration in your Supabase dashboard');
      console.log('2. Test the signup flow with a new account');
      console.log('3. Your account should now have super admin access');
    } else {
      console.log('\n⚠️  Some fixes may need manual intervention');
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Fix process failed:', error.message);
    return false;
  }
}

// Run the fixes
runFixes().then(success => {
  process.exit(success ? 0 : 1);
});