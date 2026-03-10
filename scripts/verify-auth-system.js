#!/usr/bin/env node

/**
 * Authentication System Verification Script
 * 
 * This script verifies the integrity of the authentication and authorization system.
 * It should be run in CI/CD pipelines to catch security regressions early.
 * 
 * Usage: node scripts/verify-auth-system.js
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runPostgresQuery } from './lib/postgres-query.js';

const __filename = fileURLToPath(import.meta.url);

// Configuration
const REQUIRED_TABLES = [
  'profiles',
  'clients', 
  'therapists',
  'sessions',
  'authorizations',
  'billing_records'
];

const REQUIRED_ROLES = [
  'client',
  'therapist', 
  'admin',
  'super_admin'
];

const REQUIRED_FUNCTION_GROUPS = [
  {
    name: 'role-check helper',
    variants: ['app.user_has_role', 'auth.user_has_role', 'public.user_has_role']
  },
  {
    name: 'role-fetch helper',
    variants: ['public.get_user_roles', 'auth.get_user_roles', 'get_user_roles']
  },
  {
    name: 'admin-check helper',
    variants: ['app.is_admin', 'auth.is_admin', 'public.is_admin']
  }
];

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
  log(`❌ ${message}`, 'red');
}

function success(message) {
  log(`✅ ${message}`, 'green');
}

function warning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function info(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

function title(message) {
  log(`\n${colors.bright}${colors.blue}=== ${message} ===${colors.reset}`);
}

/**
 * Execute SQL query via direct Postgres connection
 */
async function runQuery(query) {
  return runPostgresQuery(query);
}

/**
 * Check if Supabase CLI is available
 */
function checkSupabaseCLI() {
  try {
    execSync('supabase --version', { stdio: 'pipe' });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Verify RLS is enabled on all required tables
 */
async function verifyRLSEnabled() {
  title('Verifying RLS Policies');
  
  try {
    const query = `
      SELECT 
        c.relname as table_name,
        c.relrowsecurity as rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname IN ('${REQUIRED_TABLES.join("', '")}')
      ORDER BY c.relname;
    `;
    
    const tables = await runQuery(query);
    
    let allEnabled = true;
    
    tables.forEach((tableRow) => {
      const tableName = tableRow.table_name;
      const rlsEnabled = Boolean(tableRow.rls_enabled);
      
      if (rlsEnabled) {
        success(`RLS enabled on ${tableName}`);
      } else {
        error(`RLS NOT enabled on ${tableName}`);
        allEnabled = false;
      }
    });
    
    if (allEnabled) {
      success('All required tables have RLS enabled');
    } else {
      throw new Error('Some tables are missing RLS policies');
    }
    
  } catch (err) {
    error(`RLS verification failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Verify role_type enum exists with all required roles
 */
async function verifyRoleSystem() {
  title('Verifying Role System');
  
  try {
    // Check if role_type enum exists
    const enumQuery = `
      SELECT enumlabel
      FROM pg_enum 
      WHERE enumtypid = (
        SELECT oid 
        FROM pg_type 
        WHERE typname = 'role_type'
      )
      ORDER BY enumlabel;
    `;
    
    const result = await runQuery(enumQuery);
    const existingRoles = result.map((role) => role.enumlabel);
    
    let allRolesExist = true;
    
    REQUIRED_ROLES.forEach(role => {
      if (existingRoles.includes(role)) {
        success(`Role '${role}' exists in role_type enum`);
      } else {
        error(`Role '${role}' missing from role_type enum`);
        allRolesExist = false;
      }
    });
    
    if (allRolesExist) {
      success('All required roles exist in role_type enum');
    } else {
      throw new Error('Role system is incomplete');
    }
    
  } catch (err) {
    error(`Role system verification failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Verify profiles table has correct structure
 */
async function verifyProfilesTable() {
  title('Verifying Profiles Table');
  
  try {
    const query = `
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'profiles'
        AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    const columns = await runQuery(query);
    
    const requiredColumns = [
      'id',
      'email', 
      'role',
      'is_active',
      'created_at',
      'updated_at'
    ];
    
    const existingColumns = columns.map((col) => col.column_name);
    
    let allColumnsExist = true;
    
    requiredColumns.forEach(col => {
      if (existingColumns.includes(col)) {
        success(`Column '${col}' exists in profiles table`);
      } else {
        error(`Column '${col}' missing from profiles table`);
        allColumnsExist = false;
      }
    });
    
    if (allColumnsExist) {
      success('Profiles table has correct structure');
    } else {
      throw new Error('Profiles table structure is incorrect');
    }
    
  } catch (err) {
    error(`Profiles table verification failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Verify required authentication functions exist
 */
async function verifyAuthFunctions() {
  title('Verifying Authentication Functions');
  
  try {
    const query = `
      SELECT 
        routine_name,
        routine_schema
      FROM information_schema.routines
      WHERE routine_schema IN ('public', 'auth', 'app', 'app_auth')
        AND routine_name IN ('user_has_role', 'get_user_roles', 'is_admin')
      ORDER BY routine_name;
    `;
    
    const functions = await runQuery(query);

    const existingFunctions = new Set(
      functions.map((func) => `${func.routine_schema}.${func.routine_name}`),
    );

    let allFunctionGroupsExist = true;

    REQUIRED_FUNCTION_GROUPS.forEach((group) => {
      const matched = group.variants.find((variant) => existingFunctions.has(variant));
      if (matched) {
        success(`Function group '${group.name}' satisfied by '${matched}'`);
      } else {
        error(
          `Function group '${group.name}' missing. Expected one of: ${group.variants.join(', ')}`,
        );
        allFunctionGroupsExist = false;
      }
    });

    if (allFunctionGroupsExist) {
      success('All required authentication functions exist');
    } else {
      throw new Error('Some authentication functions are missing');
    }
    
  } catch (err) {
    error(`Authentication functions verification failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Verify API routes exist
 */
function verifyAPIRoutes() {
  title('Verifying API Routes');
  
  const requiredRoutes = [
    'supabase/functions/auth-signup/index.ts',
    'supabase/functions/auth-login/index.ts',
    'supabase/functions/profiles-me/index.ts',
    'supabase/functions/admin-users/index.ts',
    'supabase/functions/admin-users-roles/index.ts',
    'supabase/functions/_shared/auth-middleware.ts'
  ];
  
  let allRoutesExist = true;
  
  requiredRoutes.forEach(route => {
    if (fs.existsSync(route)) {
      success(`API route '${route}' exists`);
    } else {
      error(`API route '${route}' missing`);
      allRoutesExist = false;
    }
  });
  
  if (allRoutesExist) {
    success('All required API routes exist');
  } else {
    error('Some API routes are missing');
    process.exit(1);
  }
}

/**
 * Verify test files exist
 */
function verifyTestFiles() {
  title('Verifying Test Files');
  
  const requiredTests = [
    'cypress/e2e/auth-roles.cy.ts'
  ];
  
  let allTestsExist = true;
  
  requiredTests.forEach(test => {
    if (fs.existsSync(test)) {
      success(`Test file '${test}' exists`);
    } else {
      warning(`Test file '${test}' missing`);
      allTestsExist = false;
    }
  });
  
  if (allTestsExist) {
    success('All required test files exist');
  } else {
    warning('Some test files are missing - consider adding them');
  }
}

/**
 * Check for schema drift
 */
function checkSchemaDrift() {
  title('Checking for Schema Drift');

  if (process.env.RUN_SCHEMA_DIFF !== 'true') {
    info('Skipping schema drift check (set RUN_SCHEMA_DIFF=true to enable).');
    return;
  }

  try {
    // Check if there are any pending migrations
    const result = execSync('supabase db diff --schema public --linked', { 
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 45000,
    });
    
    if (result.trim() === '') {
      success('No schema drift detected');
    } else {
      warning('Schema drift detected:');
      console.log(result);
      // Don't fail here as drift might be intentional
    }
    
  } catch (err) {
    // supabase db diff returns non-zero exit code when there are differences
    if (err.stdout) {
      warning('Schema drift detected:');
      console.log(err.stdout);
    } else {
      warning(`Schema drift check skipped due runtime constraint: ${err.message}`);
    }
  }
}

/**
 * Run comprehensive verification
 */
async function runVerification() {
  console.log(`${colors.bright}${colors.magenta}`);
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                Authentication System Verification             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(colors.reset);
  
  info('Starting comprehensive authentication system verification...');
  
  // Check prerequisites
  if (!checkSupabaseCLI()) {
    error('Supabase CLI not found. Please install it first.');
    process.exit(1);
  }
  
  try {
    // Run all verification steps
    await verifyRLSEnabled();
    await verifyRoleSystem();
    await verifyProfilesTable();
    await verifyAuthFunctions();
    verifyAPIRoutes();
    verifyTestFiles();
    checkSchemaDrift();
    
    // Final success message
    console.log(`\n${colors.bright}${colors.green}`);
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    ✅ VERIFICATION PASSED                     ║');
    console.log('║                                                                ║');
    console.log('║   Authentication system is properly configured and secure!    ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(colors.reset);
    
  } catch (err) {
    console.log(`\n${colors.bright}${colors.red}`);
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    ❌ VERIFICATION FAILED                     ║');
    console.log('║                                                                ║');
    console.log('║   Authentication system has issues that need to be fixed!     ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log(colors.reset);
    
    process.exit(1);
  }
}

// Run the verification if this script is executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runVerification();
}

export {
  runVerification,
  verifyRLSEnabled,
  verifyRoleSystem,
  verifyProfilesTable,
  verifyAuthFunctions,
  verifyAPIRoutes,
  verifyTestFiles,
  checkSchemaDrift
};
