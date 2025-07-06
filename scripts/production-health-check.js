#!/usr/bin/env node

/**
 * Production Health Check Script
 * 
 * This script performs comprehensive health checks on the production database
 * after deployments to ensure everything is working correctly.
 * 
 * Usage: node scripts/production-health-check.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'wnnjeqheqxxyrgsjmygy';
const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://allincompassing.netlify.app';
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
 * Check database connectivity
 */
async function checkDatabaseConnectivity() {
  try {
    logger.info('Checking database connectivity...');
    
    const query = 'SELECT NOW() as current_time;';
    const command = `supabase db query '${query}' --project-ref ${PROJECT_REF}`;
    
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    logger.success('Database connectivity: OK');
    return { status: 'ok', response_time: Date.now() };
    
  } catch (error) {
    logger.error(`Database connectivity failed: ${error.message}`);
    return { status: 'error', error: error.message };
  }
}

/**
 * Check critical tables exist
 */
async function checkCriticalTables() {
  try {
    logger.info('Checking critical tables...');
    
    const criticalTables = [
      'clients',
      'therapists', 
      'sessions',
      'authorizations',
      'users'
    ];
    
    const results = [];
    
    for (const table of criticalTables) {
      try {
        const query = `SELECT COUNT(*) as count FROM ${table} LIMIT 1;`;
        const command = `supabase db query '${query}' --project-ref ${PROJECT_REF}`;
        
        execSync(command, {
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        results.push({ table, status: 'ok' });
      } catch (error) {
        results.push({ table, status: 'error', error: error.message });
        logger.error(`Table ${table} check failed: ${error.message}`);
      }
    }
    
    const failedTables = results.filter(r => r.status === 'error');
    if (failedTables.length === 0) {
      logger.success('All critical tables: OK');
    } else {
      logger.error(`${failedTables.length} critical tables failed`);
    }
    
    return results;
    
  } catch (error) {
    logger.error(`Critical tables check failed: ${error.message}`);
    return [];
  }
}

/**
 * Check database functions
 */
async function checkDatabaseFunctions() {
  try {
    logger.info('Checking database functions...');
    
    const functionsQuery = `
      SELECT 
        n.nspname as schema_name,
        p.proname as function_name,
        pg_get_function_result(p.oid) as return_type
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      ORDER BY p.proname;
    `;
    
    const command = `supabase db query '${functionsQuery}' --project-ref ${PROJECT_REF}`;
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const functions = parseQueryOutput(output);
    
    logger.success(`Found ${functions.length} database functions`);
    return { status: 'ok', count: functions.length, functions };
    
  } catch (error) {
    logger.error(`Database functions check failed: ${error.message}`);
    return { status: 'error', error: error.message };
  }
}

/**
 * Check RLS policies
 */
async function checkRLSPolicies() {
  try {
    logger.info('Checking RLS policies...');
    
    const rlsQuery = `
      SELECT 
        schemaname,
        tablename,
        rowsecurity as rls_enabled,
        (SELECT COUNT(*) FROM pg_policies WHERE schemaname = t.schemaname AND tablename = t.tablename) as policy_count
      FROM pg_tables t
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `;
    
    const command = `supabase db query '${rlsQuery}' --project-ref ${PROJECT_REF}`;
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const tables = parseQueryOutput(output);
    const rlsIssues = tables.filter(t => !t.rls_enabled);
    
    if (rlsIssues.length === 0) {
      logger.success('RLS policies: OK');
    } else {
      logger.warn(`${rlsIssues.length} tables without RLS`);
    }
    
    return {
      status: rlsIssues.length === 0 ? 'ok' : 'warning',
      total_tables: tables.length,
      tables_without_rls: rlsIssues.length,
      tables: tables
    };
    
  } catch (error) {
    logger.error(`RLS policies check failed: ${error.message}`);
    return { status: 'error', error: error.message };
  }
}

/**
 * Check application endpoints
 */
async function checkApplicationEndpoints() {
  try {
    logger.info('Checking application endpoints...');
    
    const endpoints = [
      { name: 'Homepage', url: PRODUCTION_URL },
      { name: 'Login', url: `${PRODUCTION_URL}/login` },
      { name: 'Dashboard', url: `${PRODUCTION_URL}/dashboard` }
    ];
    
    const results = [];
    
    for (const endpoint of endpoints) {
      try {
        // Use curl to check endpoint (cross-platform)
        const curlCommand = `curl -s -o /dev/null -w "%{http_code}" -m 10 "${endpoint.url}"`;
        const statusCode = execSync(curlCommand, {
          encoding: 'utf8',
          stdio: 'pipe'
        }).trim();
        
        const status = statusCode.startsWith('2') ? 'ok' : statusCode.startsWith('3') ? 'redirect' : 'error';
        results.push({
          name: endpoint.name,
          url: endpoint.url,
          status_code: statusCode,
          status
        });
        
      } catch (error) {
        results.push({
          name: endpoint.name,
          url: endpoint.url,
          status: 'error',
          error: error.message
        });
      }
    }
    
    const failedEndpoints = results.filter(r => r.status === 'error');
    if (failedEndpoints.length === 0) {
      logger.success('Application endpoints: OK');
    } else {
      logger.error(`${failedEndpoints.length} endpoints failed`);
    }
    
    return results;
    
  } catch (error) {
    logger.error(`Application endpoints check failed: ${error.message}`);
    return [];
  }
}

/**
 * Check database performance metrics
 */
async function checkPerformanceMetrics() {
  try {
    logger.info('Checking performance metrics...');
    
    const metricsQuery = `
      SELECT 
        datname,
        numbackends as active_connections,
        xact_commit as committed_transactions,
        xact_rollback as rolled_back_transactions,
        blks_read,
        blks_hit,
        tup_returned,
        tup_fetched,
        tup_inserted,
        tup_updated,
        tup_deleted
      FROM pg_stat_database 
      WHERE datname = current_database();
    `;
    
    const command = `supabase db query '${metricsQuery}' --project-ref ${PROJECT_REF}`;
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const metrics = parseQueryOutput(output);
    
    logger.success('Performance metrics retrieved');
    return { status: 'ok', metrics: metrics[0] || {} };
    
  } catch (error) {
    logger.error(`Performance metrics check failed: ${error.message}`);
    return { status: 'error', error: error.message };
  }
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
 * Generate production health report
 */
function generateProductionReport(checks) {
  const report = {
    timestamp: new Date().toISOString(),
    environment: 'production',
    overall_status: 'unknown',
    checks,
    summary: {
      total_checks: Object.keys(checks).length,
      passed_checks: 0,
      failed_checks: 0,
      warning_checks: 0
    }
  };
  
  // Calculate summary
  Object.values(checks).forEach(check => {
    if (Array.isArray(check)) {
      // For arrays (like endpoints), check individual items
      check.forEach(item => {
        if (item.status === 'ok') report.summary.passed_checks++;
        else if (item.status === 'warning') report.summary.warning_checks++;
        else report.summary.failed_checks++;
      });
    } else {
      // For objects
      if (check.status === 'ok') report.summary.passed_checks++;
      else if (check.status === 'warning') report.summary.warning_checks++;
      else report.summary.failed_checks++;
    }
  });
  
  // Determine overall status
  if (report.summary.failed_checks > 0) {
    report.overall_status = 'failed';
  } else if (report.summary.warning_checks > 0) {
    report.overall_status = 'warning';
  } else {
    report.overall_status = 'healthy';
  }
  
  return report;
}

/**
 * Format report as markdown
 */
function formatReportAsMarkdown(report) {
  const statusEmoji = {
    healthy: '🟢',
    warning: '🟡',
    failed: '🔴'
  };
  
  let markdown = `# 🏥 Production Health Check Report

## 📊 Overall Status: ${statusEmoji[report.overall_status]} ${report.overall_status.toUpperCase()}

**Timestamp**: ${new Date(report.timestamp).toLocaleString()}
**Environment**: Production

### Summary
- ✅ **Passed**: ${report.summary.passed_checks}
- ⚠️ **Warnings**: ${report.summary.warning_checks}
- ❌ **Failed**: ${report.summary.failed_checks}

---

## 🔍 Check Results

### 🗄️ Database Connectivity
`;

  if (report.checks.database?.status === 'ok') {
    markdown += '✅ Database connection successful\n\n';
  } else {
    markdown += `❌ Database connection failed: ${report.checks.database?.error}\n\n`;
  }
  
  markdown += '### 📋 Critical Tables\n';
  if (report.checks.tables && Array.isArray(report.checks.tables)) {
    report.checks.tables.forEach(table => {
      const icon = table.status === 'ok' ? '✅' : '❌';
      markdown += `${icon} **${table.table}**: ${table.status}\n`;
    });
  }
  markdown += '\n';
  
  markdown += '### 🔧 Database Functions\n';
  if (report.checks.functions?.status === 'ok') {
    markdown += `✅ Found ${report.checks.functions.count} database functions\n\n`;
  } else {
    markdown += `❌ Function check failed: ${report.checks.functions?.error}\n\n`;
  }
  
  markdown += '### 🔐 RLS Policies\n';
  if (report.checks.rls?.status === 'ok') {
    markdown += `✅ All ${report.checks.rls.total_tables} tables have RLS enabled\n\n`;
  } else if (report.checks.rls?.status === 'warning') {
    markdown += `⚠️ ${report.checks.rls.tables_without_rls} tables missing RLS out of ${report.checks.rls.total_tables}\n\n`;
  } else {
    markdown += `❌ RLS check failed: ${report.checks.rls?.error}\n\n`;
  }
  
  markdown += '### 🌐 Application Endpoints\n';
  if (report.checks.endpoints && Array.isArray(report.checks.endpoints)) {
    report.checks.endpoints.forEach(endpoint => {
      const icon = endpoint.status === 'ok' ? '✅' : endpoint.status === 'redirect' ? '🔄' : '❌';
      markdown += `${icon} **${endpoint.name}** (${endpoint.status_code}): ${endpoint.url}\n`;
    });
  }
  markdown += '\n';
  
  markdown += '### ⚡ Performance Metrics\n';
  if (report.checks.performance?.status === 'ok') {
    const metrics = report.checks.performance.metrics;
    markdown += `✅ Performance metrics retrieved
- **Active Connections**: ${metrics.active_connections}
- **Committed Transactions**: ${metrics.committed_transactions}
- **Tuples Returned**: ${metrics.tup_returned}

`;
  } else {
    markdown += `❌ Performance metrics failed: ${report.checks.performance?.error}\n\n`;
  }
  
  // Recommendations
  markdown += '---\n\n## 💡 Recommendations\n\n';
  
  if (report.overall_status === 'healthy') {
    markdown += '🎉 **All systems operational!** No immediate action required.\n\n';
  } else {
    if (report.summary.failed_checks > 0) {
      markdown += '🚨 **Immediate Action Required**: Address failed checks immediately.\n\n';
    }
    if (report.summary.warning_checks > 0) {
      markdown += '⚠️ **Review Warnings**: Address warning conditions when possible.\n\n';
    }
  }
  
  markdown += `---

*Health check completed at ${new Date(report.timestamp).toLocaleString()}*
`;
  
  return markdown;
}

/**
 * Save report
 */
function saveReport(report) {
  try {
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
    
    const filename = `production-health-${Date.now()}.json`;
    const filepath = path.join(REPORTS_DIR, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    logger.success(`Production health report saved: ${filepath}`);
    
    return filepath;
  } catch (error) {
    logger.error(`Failed to save report: ${error.message}`);
    return null;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    logger.info('Starting production health check...');
    
    // Run all health checks
    const [database, tables, functions, rls, endpoints, performance] = await Promise.all([
      checkDatabaseConnectivity(),
      checkCriticalTables(),
      checkDatabaseFunctions(),
      checkRLSPolicies(),
      checkApplicationEndpoints(),
      checkPerformanceMetrics()
    ]);
    
    const checks = {
      database,
      tables,
      functions,
      rls,
      endpoints,
      performance
    };
    
    // Generate report
    const report = generateProductionReport(checks);
    
    // Save report
    saveReport(report);
    
    // Output summary
    logger.info(`Production Health Check Summary:`);
    logger.info(`- Overall Status: ${report.overall_status.toUpperCase()}`);
    logger.info(`- Passed: ${report.summary.passed_checks}`);
    logger.info(`- Warnings: ${report.summary.warning_checks}`);
    logger.info(`- Failed: ${report.summary.failed_checks}`);
    
    // Output markdown for GitHub Actions (optional)
    if (process.env.GITHUB_ACTIONS) {
      const markdown = formatReportAsMarkdown(report);
      console.log('\n--- MARKDOWN REPORT ---\n');
      console.log(markdown);
    }
    
    if (report.overall_status === 'failed') {
      logger.error('Production health check failed!');
      process.exit(1);
    } else if (report.overall_status === 'warning') {
      logger.warn('Production health check completed with warnings');
    } else {
      logger.success('Production health check passed successfully');
    }
    
  } catch (error) {
    logger.error(`Production health check failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  checkDatabaseConnectivity,
  checkCriticalTables,
  checkDatabaseFunctions,
  checkRLSPolicies,
  checkApplicationEndpoints,
  checkPerformanceMetrics,
  generateProductionReport,
  formatReportAsMarkdown
}; 