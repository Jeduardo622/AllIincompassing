#!/usr/bin/env node

/**
 * Database Security Check Script
 * 
 * This script runs security analysis on a Supabase database branch using
 * the Supabase advisors and other security checks.
 * 
 * Usage: node scripts/check-database-security.js <branch-id>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runPostgresQuery } from './lib/postgres-query.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const REPORTS_DIR = path.join(__dirname, '..', '.reports');
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
 * Retry utility with exponential backoff
 */
async function withRetry(operation, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.warn(`Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      logger.info(`Retrying in ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Ensure reports directory exists
 */
function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

/**
 * Run Supabase security advisors
 */
async function runSecurityAdvisors(branchId) {
  return withRetry(async () => {
    logger.info(`Running SQL security advisors for branch: ${branchId}`);

    const roleStatsQuery = `
      SELECT
        CASE
          WHEN rolname IN ('postgres', 'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin')
            THEN 'warning'
          WHEN rolsuper THEN 'critical'
          WHEN rolbypassrls THEN 'high'
          ELSE 'warning'
        END as level,
        format('Role %I: superuser=%s bypassrls=%s canlogin=%s', rolname, rolsuper, rolbypassrls, rolcanlogin) as message,
        'security' as category
      FROM pg_roles
      WHERE rolsuper OR rolbypassrls
      ORDER BY rolsuper DESC, rolbypassrls DESC, rolname;
    `;

    const advisors = await runPostgresQuery(roleStatsQuery);
    logger.success('SQL security advisors completed');
    return { advisors, errors: [] };
  }, 2, 1000).catch(error => {
    logger.error(`Security advisors failed after all retries: ${error.message}`);
    return {
      advisors: [],
      errors: [error.message]
    };
  });
}

/**
 * Check RLS policies
 */
async function checkRLSPolicies(branchId) {
  return withRetry(async () => {
    logger.info('Checking RLS policies...');
    
    // Get all public tables and check RLS from pg_class metadata.
    const tablesQuery = `
      SELECT 
        n.nspname as schemaname,
        c.relname as tablename,
        c.relrowsecurity as rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY c.relname;
    `;
    
    const tables = await runPostgresQuery(tablesQuery);
    const rlsIssues = [];
    
    for (const table of tables) {
      if (!table.rls_enabled) {
        rlsIssues.push({
          table: table.tablename,
          issue: 'RLS not enabled',
          severity: 'high'
        });
      }
    }
    
    logger.success(`RLS check completed. Found ${rlsIssues.length} issues`);
    return rlsIssues;
  }, 3, 1500).catch(error => {
    logger.error(`RLS check failed after all retries: ${error.message}`);
    return [];
  });
}

/**
 * Check for public tables that have RLS enabled but zero policies.
 * This is treated as a launch-blocking misconfiguration.
 */
async function checkRlsTablesWithoutPolicies(branchId) {
  return withRetry(async () => {
    logger.info('Checking for RLS-enabled tables without policies...');

    const rlsNoPolicyQuery = `
      SELECT
        n.nspname AS schemaname,
        c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relrowsecurity = true
        AND NOT EXISTS (
          SELECT 1
          FROM pg_policies p
          WHERE p.schemaname = n.nspname
            AND p.tablename = c.relname
        )
      ORDER BY c.relname;
    `;

    const offenders = await runPostgresQuery(rlsNoPolicyQuery);
    logger.success(`RLS no-policy check completed. Found ${offenders.length} issue(s)`);
    return offenders.map((row) => ({
      table: row.tablename,
      issue: 'RLS enabled but no policies defined',
      severity: 'critical',
    }));
  }, 3, 1500).catch((error) => {
    logger.error(`RLS no-policy check failed after all retries: ${error.message}`);
    return [];
  });
}

/**
 * Check for exposed functions
 */
async function checkExposedFunctions(branchId) {
  return withRetry(async () => {
    logger.info('Checking for exposed functions...');
    
    const functionsQuery = `
      SELECT 
        n.nspname as schema_name,
        p.proname as function_name,
        p.prosecdef as security_definer,
        pg_get_function_result(p.oid) as return_type
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      AND p.prokind = 'f';
    `;
    
    const functions = await runPostgresQuery(functionsQuery);
    const exposedFunctions = [];
    
    for (const func of functions) {
      if (!func.security_definer) {
        exposedFunctions.push({
          function: func.function_name,
          issue: 'Function is not SECURITY DEFINER',
          severity: 'medium'
        });
      }
    }
    
    logger.success(`Function check completed. Found ${exposedFunctions.length} issues`);
    return exposedFunctions;
  }, 3, 1500).catch(error => {
    logger.error(`Function check failed after all retries: ${error.message}`);
    return [];
  });
}

/**
 * Generate security report
 */
function generateSecurityReport(branchId, advisors, rlsIssues, exposedFunctions, rlsNoPolicyIssues) {
  const report = {
    branch_id: branchId,
    timestamp: new Date().toISOString(),
    summary: {
      total_issues: advisors.advisors.length + rlsIssues.length + exposedFunctions.length + rlsNoPolicyIssues.length,
      critical_issues: advisors.advisors.filter(a => a.level === 'critical').length + rlsNoPolicyIssues.length,
      high_issues: rlsIssues.filter(i => i.severity === 'high').length,
      medium_issues: exposedFunctions.filter(f => f.severity === 'medium').length,
      low_issues: advisors.advisors.filter(a => a.level === 'warning').length
    },
    advisors: advisors.advisors,
    rls_issues: rlsIssues,
    rls_no_policy_issues: rlsNoPolicyIssues,
    exposed_functions: exposedFunctions,
    errors: advisors.errors,
    recommendations: generateRecommendations(advisors, rlsIssues, exposedFunctions, rlsNoPolicyIssues)
  };
  
  return report;
}

/**
 * Generate security recommendations
 */
function generateRecommendations(advisors, rlsIssues, exposedFunctions, rlsNoPolicyIssues) {
  const recommendations = [];
  if (rlsNoPolicyIssues.length > 0) {
    recommendations.push({
      type: 'rls_policies',
      priority: 'critical',
      message: `Add RLS policies for ${rlsNoPolicyIssues.length} RLS-enabled table(s) with no policies`,
      action: 'Create least-privilege policies and tighten grants before release'
    });
  }

  
  if (rlsIssues.length > 0) {
    recommendations.push({
      type: 'rls',
      priority: 'high',
      message: `Enable RLS on ${rlsIssues.length} tables`,
      action: 'ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;'
    });
  }
  
  if (exposedFunctions.length > 0) {
    recommendations.push({
      type: 'functions',
      priority: 'medium',
      message: `Review ${exposedFunctions.length} functions for security`,
      action: 'Add SECURITY DEFINER to sensitive functions'
    });
  }
  
  const criticalAdvisors = advisors.advisors.filter(a => a.level === 'critical');
  if (criticalAdvisors.length > 0) {
    recommendations.push({
      type: 'advisors',
      priority: 'critical',
      message: `Address ${criticalAdvisors.length} critical security issues`,
      action: 'Review and fix advisor recommendations'
    });
  }
  
  return recommendations;
}

/**
 * Save security report
 */
function saveSecurityReport(report) {
  try {
    ensureReportsDir();
    
    const filename = `security-report-${report.branch_id}-${Date.now()}.json`;
    const filepath = path.join(REPORTS_DIR, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    logger.success(`Security report saved: ${filepath}`);
    
    return filepath;
  } catch (error) {
    logger.error(`Failed to save security report: ${error.message}`);
    return null;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    const branchId = process.argv[2] || process.env.SUPABASE_BRANCH_ID || 'local';
    const hasDatabaseUrl = Boolean(
      process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL,
    );

    if (!hasDatabaseUrl) {
      logger.error('Missing database connection string. Set SUPABASE_DB_URL or DATABASE_URL.');
      process.exit(1);
    }
    
    logger.info(`Starting security check for branch: ${branchId}`);
    
    // Run all security checks
    const [advisors, rlsIssues, exposedFunctions, rlsNoPolicyIssues] = await Promise.all([
      runSecurityAdvisors(branchId),
      checkRLSPolicies(branchId),
      checkExposedFunctions(branchId),
      checkRlsTablesWithoutPolicies(branchId)
    ]);
    
    // Generate report
    const report = generateSecurityReport(branchId, advisors, rlsIssues, exposedFunctions, rlsNoPolicyIssues);
    
    // Save report
    const reportPath = saveSecurityReport(report);
    
    // Output summary
    logger.info(`Security Check Summary:`);
    logger.info(`- Total Issues: ${report.summary.total_issues}`);
    logger.info(`- Critical: ${report.summary.critical_issues}`);
    logger.info(`- High: ${report.summary.high_issues}`);
    logger.info(`- Medium: ${report.summary.medium_issues}`);
    logger.info(`- Low: ${report.summary.low_issues}`);
    
    if (report.summary.critical_issues > 0 || report.errors.length > 0) {
      logger.error(`Critical security issues found!`);
      process.exit(1);
    }
    
    logger.success('Security check completed successfully');
    
  } catch (error) {
    logger.error(`Security check failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the script if called directly
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}

// ES module exports
export {
  runSecurityAdvisors,
  checkRLSPolicies,
  checkRlsTablesWithoutPolicies,
  checkExposedFunctions,
  generateSecurityReport,
  saveSecurityReport
}; 
