#!/usr/bin/env node

/**
 * Admin Password Reset Script
 * 
 * This script allows super admins to reset user passwords or create new users.
 * Uses service role permissions to bypass RLS policies.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables
config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://wnnjeqheqxxyrgsjmygy.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndubmplcWhlcXh4eXJnc2pteWd5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzQzMTkzOCwiZXhwIjoyMDQ5MDA3OTM4fQ.H6ju0HUIl8Xhek2OtT6QYDaAe4-_HrggHfIkPP3pLmE';

// Create Supabase client with service role
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Logger utility
 */
const logger = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  success: (msg) => console.log(`✅ ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  warn: (msg) => console.warn(`⚠️  ${msg}`)
};

/**
 * Reset user password or create user if they don't exist
 */
async function resetUserPassword(email, newPassword, createIfNotExists = false) {
  try {
    logger.info(`Processing password reset for: ${email}`);
    
    // Check if user exists in auth.users
    const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();
    
    if (listError) {
      throw new Error(`Error checking existing users: ${listError.message}`);
    }
    
    const userExists = existingUsers.users.find(user => user.email === email);
    
    if (userExists) {
      logger.info(`User found with ID: ${userExists.id}`);
      
      // Reset password for existing user
      const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(
        userExists.id,
        { 
          password: newPassword,
          email_confirm: true // Ensure email is confirmed
        }
      );
      
      if (updateError) {
        throw new Error(`Error updating password: ${updateError.message}`);
      }
      
      // Ensure user has a profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userExists.id)
        .single();
      
      if (profileError || !profile) {
        logger.info('Creating missing profile for existing user...');
        
        // Create profile if it doesn't exist
        const { error: createProfileError } = await supabase
          .from('profiles')
          .insert({
            id: userExists.id,
            email: email,
            role: 'client',
            first_name: email.split('@')[0],
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        
        if (createProfileError) {
          logger.warn(`Profile creation failed: ${createProfileError.message}`);
        } else {
          logger.success('Profile created successfully');
        }
      }
      
      logger.success(`Password reset successful for: ${email}`);
      return {
        success: true,
        action: 'password_reset',
        userId: userExists.id,
        email: email
      };
      
    } else if (createIfNotExists) {
      logger.info(`User not found. Creating new user: ${email}`);
      
      // Create new user
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: email,
        password: newPassword,
        email_confirm: true,
        user_metadata: {
          full_name: email.split('@')[0]
        }
      });
      
      if (createError) {
        throw new Error(`Error creating user: ${createError.message}`);
      }
      
      // Create user profile
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: newUser.user.id,
          email: email,
          role: 'client',
          first_name: email.split('@')[0],
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      if (profileError) {
        logger.warn(`Profile creation failed: ${profileError.message}`);
      }
      
      // Assign client role
      const { data: clientRole } = await supabase
        .from('roles')
        .select('id')
        .eq('name', 'client')
        .single();
      
      if (clientRole) {
        const { error: roleAssignError } = await supabase
          .from('user_roles')
          .insert({
            user_id: newUser.user.id,
            role_id: clientRole.id
          });
        
        if (roleAssignError) {
          logger.warn(`Role assignment failed: ${roleAssignError.message}`);
        }
      }
      
      logger.success(`User created successfully: ${email}`);
      return {
        success: true,
        action: 'user_created',
        userId: newUser.user.id,
        email: email
      };
      
    } else {
      throw new Error(`User ${email} not found and creation not requested`);
    }
    
  } catch (error) {
    logger.error(`Password reset failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      email: email
    };
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
Admin Password Reset Tool

Usage: node scripts/admin-password-reset.js <email> <new_password> [create_if_not_exists]

Examples:
  node scripts/admin-password-reset.js user@example.com newPassword123
  node scripts/admin-password-reset.js user@example.com newPassword123 true
    `);
    process.exit(1);
  }
  
  const [email, newPassword, createIfNotExists] = args;
  const shouldCreate = createIfNotExists === 'true';
  
  logger.info('🔐 Admin Password Reset Tool Starting...');
  logger.info(`Target: ${email}`);
  logger.info(`Create if not exists: ${shouldCreate}`);
  
  const result = await resetUserPassword(email, newPassword, shouldCreate);
  
  if (result.success) {
    logger.success('🎉 Operation completed successfully!');
    console.log('\nResult:', JSON.stringify(result, null, 2));
  } else {
    logger.error('💥 Operation failed!');
    console.log('\nError:', JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error(`Unexpected error: ${error.message}`);
    process.exit(1);
  });
}

export { resetUserPassword }; 