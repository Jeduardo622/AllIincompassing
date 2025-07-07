#!/usr/bin/env node

/**
 * Database Performance Check Script
 * 
 * This script runs performance analysis on a Supabase database branch using
 * the Supabase advisors and custom performance queries.
 * 
 * Usage: node scripts/check-database-performance.js <branch-id>
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
 * Run Supabase performance advisors
 */
async function runPerformanceAdvisors(branchId) {
  return withRetry(async () => {
    logger.info(`Running performance advisors for branch: ${branchId}`);
    
    const projectRef = branchId || PROJECT_REF;
    const command = `supabase advisors --type performance --project-id ${projectRef} --experimental`;
    
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 60000 // 60 second timeout
    });
    
    logger.success('Performance advisors completed');
    return parseAdvisorOutput(output);
  }, 3, 2000).catch(error => {
    logger.error(`Performance advisors failed after all retries: ${error.message}`);
    
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
      if (line.includes('[SLOW]') || line.includes('[MISSING_INDEX]')) {
        if (currentAdvisor) {
          advisors.push(currentAdvisor);
        }
        currentAdvisor = {
          level: line.includes('[SLOW]') ? 'slow' : 'index',
          message: line.replace(/^\[[^\]]+\]/, '').trim(),
          category: 'performance'
        };
      } else if (line.includes('[WARNING]')) {
        if (currentAdvisor) {
          advisors.push(currentAdvisor);
        }
        currentAdvisor = {
          level: 'warning',
          message: line.replace(/^\[[^\]]+\]/, '').trim(),
          category: 'performance'
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
 * Check slow queries
 */
async function checkSlowQueries(branchId) {
  try {
    logger.info('Checking for slow queries...');
    
    const projectRef = branchId || PROJECT_REF;
    
    // Get slow queries from pg_stat_statements
    const slowQueriesQuery = `
      SELECT 
        query,
        calls,
        total_time,
        mean_time,
        min_time,
        max_time,
        stddev_time,
        rows,
        (total_time / calls) as avg_time_ms
      FROM pg_stat_statements
      WHERE total_time > 1000
      ORDER BY total_time DESC
      LIMIT 10;
    `;
    
    const command = `supabase db query '${slowQueriesQuery}' --project-id ${projectRef} --experimental`;
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const slowQueries = parseQueryOutput(output);
    
    logger.success(`Found ${slowQueries.length} slow queries`);
    return slowQueries;
    
  } catch (error) {
    logger.error(`Slow query check failed: ${error.message}`);
    return [];
  }
}

/**
 * Check missing indexes
 */
async function checkMissingIndexes(branchId) {
  try {
    logger.info('Checking for missing indexes...');
    
    const projectRef = branchId || PROJECT_REF;
    
    // Check for tables without indexes
    const missingIndexesQuery = `
      SELECT 
        schemaname,
        tablename,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        CASE 
          WHEN seq_scan > 0 AND idx_scan = 0 THEN 'No index usage'
          WHEN seq_scan > idx_scan THEN 'More sequential than index scans'
          ELSE 'Good index usage'
        END as index_health
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      AND (seq_scan > idx_scan OR idx_scan = 0)
      ORDER BY seq_tup_read DESC;
    `;
    
    const command = `supabase db query '${missingIndexesQuery}' --project-id ${projectRef} --experimental`;
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const indexIssues = parseQueryOutput(output);
    
    logger.success(`Found ${indexIssues.length} potential index issues`);
    return indexIssues;
    
  } catch (error) {
    logger.error(`Index check failed: ${error.message}`);
    return [];
  }
}

/**
 * Check table sizes and bloat
 */
async function checkTableSizes(branchId) {
  try {
    logger.info('Checking table sizes and bloat...');
    
    const projectRef = branchId || PROJECT_REF;
    
    const tableSizesQuery = `
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        pg_total_relation_size(schemaname||'.'||tablename) as size_bytes,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        n_live_tup as live_tuples,
        n_dead_tup as dead_tuples,
        CASE 
          WHEN n_live_tup > 0 THEN round((n_dead_tup::float / n_live_tup::float) * 100, 2)
          ELSE 0
        END as bloat_ratio
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
    `;
    
    const command = `supabase db query '${tableSizesQuery}' --project-id ${projectRef} --experimental`;
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const tableSizes = parseQueryOutput(output);
    
    logger.success(`Analyzed ${tableSizes.length} tables`);
    return tableSizes;
    
  } catch (error) {
    logger.error(`Table size check failed: ${error.message}`);
    return [];
  }
}

/**
 * Check connection statistics
 */
async function checkConnections(branchId) {
  try {
    logger.info('Checking connection statistics...');
    
    const projectRef = branchId || PROJECT_REF;
    
    const connectionsQuery = `
      SELECT 
        state,
        COUNT(*) as connection_count,
        COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as percentage
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
      GROUP BY state
      ORDER BY connection_count DESC;
    `;
    
    const command = `supabase db query '${connectionsQuery}' --project-id ${projectRef} --experimental`;
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const connections = parseQueryOutput(output);
    
    logger.success(`Connection statistics retrieved`);
    return connections;
    
  } catch (error) {
    logger.error(`Connection check failed: ${error.message}`);
    return [];
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
 * Generate performance report
 */
function generatePerformanceReport(branchId, advisors, slowQueries, indexIssues, tableSizes, connections) {
  const report = {
    branch_id: branchId,
    timestamp: new Date().toISOString(),
    summary: {
      total_issues: advisors.advisors.length + indexIssues.length,
      slow_queries: slowQueries.length,
      index_issues: indexIssues.length,
      largest_tables: tableSizes.slice(0, 5).map(t => ({ name: t.tablename, size: t.size })),
      total_connections: connections.reduce((sum, c) => sum + parseInt(c.connection_count || 0), 0)
    },
    advisors: advisors.advisors,
    slow_queries: slowQueries,
    index_issues: indexIssues,
    table_sizes: tableSizes,
    connections: connections,
    errors: advisors.errors,
    recommendations: generatePerformanceRecommendations(advisors, slowQueries, indexIssues, tableSizes)
  };
  
  return report;
}

/**
 * Generate performance recommendations
 */
function generatePerformanceRecommendations(advisors, slowQueries, indexIssues, tableSizes) {
  const recommendations = [];
  
  if (slowQueries.length > 0) {
    recommendations.push({
      type: 'slow_queries',
      priority: 'high',
      message: `Optimize ${slowQueries.length} slow queries`,
      action: 'Review query execution plans and add missing indexes'
    });
  }
  
  if (indexIssues.length > 0) {
    recommendations.push({
      type: 'indexes',
      priority: 'medium',
      message: `Add indexes to ${indexIssues.length} tables`,
      action: 'CREATE INDEX ON table_name (column_name);'
    });
  }
  
  const bloatedTables = tableSizes.filter(t => parseFloat(t.bloat_ratio) > 20);
  if (bloatedTables.length > 0) {
    recommendations.push({
      type: 'bloat',
      priority: 'medium',
      message: `VACUUM ANALYZE ${bloatedTables.length} bloated tables`,
      action: 'Run VACUUM ANALYZE on tables with high bloat ratio'
    });
  }
  
  const largeTables = tableSizes.filter(t => parseInt(t.size_bytes) > 100000000); // 100MB
  if (largeTables.length > 0) {
    recommendations.push({
      type: 'large_tables',
      priority: 'low',
      message: `Monitor ${largeTables.length} large tables`,
      action: 'Consider partitioning or archiving old data'
    });
  }
  
  return recommendations;
}

/**
 * Save performance report
 */
function savePerformanceReport(report) {
  try {
    ensureReportsDir();
    
    const filename = `performance-report-${report.branch_id}-${Date.now()}.json`;
    const filepath = path.join(REPORTS_DIR, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    logger.success(`Performance report saved: ${filepath}`);
    
    return filepath;
  } catch (error) {
    logger.error(`Failed to save performance report: ${error.message}`);
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
      logger.info('Usage: node scripts/check-database-performance.js <branch-id>');
      process.exit(1);
    }
    
    logger.info(`Starting performance check for branch: ${branchId}`);
    
    // Run all performance checks
    const [advisors, slowQueries, indexIssues, tableSizes, connections] = await Promise.all([
      runPerformanceAdvisors(branchId),
      checkSlowQueries(branchId),
      checkMissingIndexes(branchId),
      checkTableSizes(branchId),
      checkConnections(branchId)
    ]);
    
    // Generate report
    const report = generatePerformanceReport(branchId, advisors, slowQueries, indexIssues, tableSizes, connections);
    
    // Save report
    const reportPath = savePerformanceReport(report);
    
    // Output summary
    logger.info(`Performance Check Summary:`);
    logger.info(`- Total Issues: ${report.summary.total_issues}`);
    logger.info(`- Slow Queries: ${report.summary.slow_queries}`);
    logger.info(`- Index Issues: ${report.summary.index_issues}`);
    logger.info(`- Total Connections: ${report.summary.total_connections}`);
    
    if (report.summary.slow_queries > 5) {
      logger.warn(`High number of slow queries detected!`);
    }
    
    logger.success('Performance check completed successfully');
    
  } catch (error) {
    logger.error(`Performance check failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

export {
  runPerformanceAdvisors,
  checkSlowQueries,
  checkMissingIndexes,
  checkTableSizes,
  checkConnections,
  generatePerformanceReport,
  savePerformanceReport
}; 