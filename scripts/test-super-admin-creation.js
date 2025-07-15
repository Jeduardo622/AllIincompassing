#!/usr/bin/env node

/**
 * Test Super Admin Creation Script
 * 
 * This script tests the complete flow of:
 * 1. Creating a test super admin account
 * 2. Verifying the signup process works
 * 3. Promoting the user's account to super admin if tests pass
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const supabaseAdmin = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

// Test user details
const TEST_USER = {
  email: 'test-super-admin@example.com',
  password: 'TestPassword123!',
  firstName: 'Test',
  lastName: 'SuperAdmin'
};

const REAL_USER_EMAIL = 'j_eduardo622@yahoo.com';

async function cleanupTestUser() {
  if (!supabaseAdmin) {
    console.log('⚠️  No service role key, skipping cleanup');
    return;
  }

  try {
    // Delete test user if exists
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const testUser = users.users.find(u => u.email === TEST_USER.email);
    
    if (testUser) {
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
      console.log('🧹 Cleaned up test user');
    }
  } catch (error) {
    console.log('⚠️  Cleanup failed:', error.message);
  }
}

async function testSignup() {
  console.log('🔧 Testing signup flow...');
  
  // Test signup
  const { data, error } = await supabase.auth.signUp({
    email: TEST_USER.email,
    password: TEST_USER.password,
    options: {
      data: {
        first_name: TEST_USER.firstName,
        last_name: TEST_USER.lastName,
        role: 'super_admin'
      }
    }
  });

  if (error) {
    console.error('❌ Signup failed:', error.message);
    return false;
  }

  if (!data.user) {
    console.error('❌ No user created');
    return false;
  }

  console.log('✅ Signup successful, user created:', data.user.email);
  
  // Wait a moment for triggers to complete
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return data.user;
}

async function testProfileCreation(userId) {
  console.log('🔧 Testing profile creation...');
  
  // Check if profile was created
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('❌ Profile fetch failed:', error.message);
    return false;
  }

  if (!profile) {
    console.error('❌ No profile found');
    return false;
  }

  console.log('✅ Profile created successfully:', {
    email: profile.email,
    role: profile.role,
    first_name: profile.first_name,
    last_name: profile.last_name
  });

  return profile;
}

async function testLogin() {
  console.log('🔧 Testing login flow...');
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_USER.email,
    password: TEST_USER.password
  });

  if (error) {
    console.error('❌ Login failed:', error.message);
    return false;
  }

  console.log('✅ Login successful');
  return true;
}

async function promoteRealUserToSuperAdmin() {
  if (!supabaseAdmin) {
    console.log('⚠️  No service role key, cannot promote real user');
    return false;
  }

  console.log(`🔧 Promoting ${REAL_USER_EMAIL} to super admin...`);
  
  try {
    // Get user by email
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const realUser = users.users.find(u => u.email === REAL_USER_EMAIL);
    
    if (!realUser) {
      console.error(`❌ User ${REAL_USER_EMAIL} not found`);
      return false;
    }

    // Update profile role
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ role: 'super_admin' })
      .eq('id', realUser.id);

    if (error) {
      console.error('❌ Failed to update role:', error.message);
      return false;
    }

    console.log(`✅ Successfully promoted ${REAL_USER_EMAIL} to super admin`);
    return true;
  } catch (error) {
    console.error('❌ Error promoting user:', error.message);
    return false;
  }
}

async function testSuperAdminFunction() {
  if (!supabaseAdmin) {
    console.log('⚠️  No service role key, skipping function test');
    return true;
  }

  console.log('🔧 Testing create_super_admin function...');
  
  try {
    const { error } = await supabaseAdmin.rpc('create_super_admin', {
      user_email: TEST_USER.email
    });

    if (error) {
      console.error('❌ Function test failed:', error.message);
      return false;
    }

    console.log('✅ create_super_admin function works');
    return true;
  } catch (error) {
    console.error('❌ Function test error:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting Super Admin Creation Tests\n');
  
  try {
    // Cleanup any existing test user
    await cleanupTestUser();
    
    // Test 1: Signup
    const user = await testSignup();
    if (!user) return false;
    
    // Test 2: Profile Creation
    const profile = await testProfileCreation(user.id);
    if (!profile) return false;
    
    // Test 3: Login
    const loginSuccess = await testLogin();
    if (!loginSuccess) return false;
    
    // Test 4: Super Admin Function
    const functionSuccess = await testSuperAdminFunction();
    if (!functionSuccess) return false;
    
    console.log('\n🎉 All tests passed!');
    
    // If all tests passed, promote the real user
    const realUserPromoted = await promoteRealUserToSuperAdmin();
    
    if (realUserPromoted) {
      console.log('\n✅ Real user successfully promoted to super admin');
    }
    
    // Cleanup test user
    await cleanupTestUser();
    
    return true;
    
  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
    await cleanupTestUser();
    return false;
  }
}

// Run the tests
runTests().then(success => {
  process.exit(success ? 0 : 1);
});