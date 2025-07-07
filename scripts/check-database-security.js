#!/usr/bin/env node

/**
 * Database Security Check Script
 * 
 * This script runs security analysis on a Supabase database branch using
 * the Supabase advisors and other security checks.
 * 
 * Usage: node scripts/check-database-security.js <branch-id>
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const REPORTS_DIR = path.join(__dirname, '..', '.reports');
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'wnnjeqheqxxyrgsjmygy';

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
    logger.info(`Running security advisors for branch: ${branchId}`);
    
    const projectRef = branchId || PROJECT_REF;
    const command = `supabase advisors --type security --project-id ${projectRef} --experimental`;
    
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 60000 // 60 second timeout
    });
    
    logger.success('Security advisors completed');
    return parseAdvisorOutput(output);
  }, 3, 2000).catch(error => {
    logger.error(`Security advisors failed after all retries: ${error.message}`);
    
    // Return a default structure if advisors fail
    return {
      advisors: [],
      errors: [error.message]
    };
  });
}

/**
 * Parse advisor output
 */
function parseAdvisorOutput(output) {
  try {
    // Try to parse as JSON first
    if (output.trim().startsWith('{') || output.trim().startsWith('[')) {
      return JSON.parse(output);
    }
    
    // Parse text output
    const lines = output.split('\n');
    const advisors = [];
    
    let currentAdvisor = null;
    for (const line of lines) {
      if (line.includes('[ERROR]') || line.includes('[CRITICAL]')) {
        if (currentAdvisor) {
          advisors.push(currentAdvisor);
        }
        currentAdvisor = {
          level: line.includes('[CRITICAL]') ? 'critical' : 'error',
          message: line.replace(/^\[[^\]]+\]/, '').trim(),
          category: 'security'
        };
      } else if (line.includes('[WARNING]')) {
        if (currentAdvisor) {
          advisors.push(currentAdvisor);
        }
        currentAdvisor = {
          level: 'warning',
          message: line.replace(/^\[[^\]]+\]/, '').trim(),
          category: 'security'
        };
      } else if (currentAdvisor && line.trim()) {
        currentAdvisor.details = (currentAdvisor.details || '') + line + '\n';
      }
    }
    
    if (currentAdvisor) {
      advisors.push(currentAdvisor);
    }
    
    return { advisors, errors: [] };
    
  } catch (error) {
    logger.error(`Failed to parse advisor output: ${error.message}`);
    return {
      advisors: [],
      errors: [error.message]
    };
  }
}

/**
 * Check RLS policies
 */
async function checkRLSPolicies(branchId) {
  return withRetry(async () => {
    logger.info('Checking RLS policies...');
    
    const projectRef = branchId || PROJECT_REF;
    
    // Get all tables and check RLS status
    const tablesQuery = `
      SELECT 
        schemaname,
        tablename,
        rowsecurity,
        hasrls
      FROM pg_tables t
      LEFT JOIN pg_class c ON c.relname = t.tablename
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE schemaname = 'public'
      AND n.nspname = 'public';
    `;
    
    const command = `supabase db query '${tablesQuery}' --project-id ${projectRef} --experimental`;
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000 // 30 second timeout
    });
    
    const tables = parseQueryOutput(output);
    const rlsIssues = [];
    
    for (const table of tables) {
      if (!table.hasrls) {
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
 * Check for exposed functions
 */
async function checkExposedFunctions(branchId) {
  return withRetry(async () => {
    logger.info('Checking for exposed functions...');
    
    const projectRef = branchId || PROJECT_REF;
    
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
    
    const command = `supabase db query '${functionsQuery}' --project-id ${projectRef} --experimental`;
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000 // 30 second timeout
    });
    
    const functions = parseQueryOutput(output);
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
 * Parse query output
 */
function parseQueryOutput(output) {
  try {
    const lines = output.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];
    
    const headers = lines[0].split('|').map(h => h.trim());
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split('|').map(v => v.trim());
      if (values.length === headers.length) {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index];
        });
        rows.push(row);
      }
    }
    
    return rows;
  } catch (error) {
    logger.error(`Failed to parse query output: ${error.message}`);
    return [];
  }
}

/**
 * Generate security report
 */
function generateSecurityReport(branchId, advisors, rlsIssues, exposedFunctions) {
  const report = {
    branch_id: branchId,
    timestamp: new Date().toISOString(),
    summary: {
      total_issues: advisors.advisors.length + rlsIssues.length + exposedFunctions.length,
      critical_issues: advisors.advisors.filter(a => a.level === 'critical').length,
      high_issues: rlsIssues.filter(i => i.severity === 'high').length,
      medium_issues: exposedFunctions.filter(f => f.severity === 'medium').length,
      low_issues: advisors.advisors.filter(a => a.level === 'warning').length
    },
    advisors: advisors.advisors,
    rls_issues: rlsIssues,
    exposed_functions: exposedFunctions,
    errors: advisors.errors,
    recommendations: generateRecommendations(advisors, rlsIssues, exposedFunctions)
  };
  
  return report;
}

/**
 * Generate security recommendations
 */
function generateRecommendations(advisors, rlsIssues, exposedFunctions) {
  const recommendations = [];
  
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
    const branchId = process.argv[2];
    
    if (!branchId) {
      logger.error('Branch ID is required');
      logger.info('Usage: node scripts/check-database-security.js <branch-id>');
      process.exit(1);
    }
    
    logger.info(`Starting security check for branch: ${branchId}`);
    
    // Run all security checks
    const [advisors, rlsIssues, exposedFunctions] = await Promise.all([
      runSecurityAdvisors(branchId),
      checkRLSPolicies(branchId),
      checkExposedFunctions(branchId)
    ]);
    
    // Generate report
    const report = generateSecurityReport(branchId, advisors, rlsIssues, exposedFunctions);
    
    // Save report
    const reportPath = saveSecurityReport(report);
    
    // Output summary
    logger.info(`Security Check Summary:`);
    logger.info(`- Total Issues: ${report.summary.total_issues}`);
    logger.info(`- Critical: ${report.summary.critical_issues}`);
    logger.info(`- High: ${report.summary.high_issues}`);
    logger.info(`- Medium: ${report.summary.medium_issues}`);
    logger.info(`- Low: ${report.summary.low_issues}`);
    
    if (report.summary.critical_issues > 0) {
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
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// ES module exports
export {
  runSecurityAdvisors,
  checkRLSPolicies,
  checkExposedFunctions,
  generateSecurityReport,
  saveSecurityReport
}; 