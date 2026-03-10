#!/usr/bin/env node

/**
 * Database Performance Check Script
 * 
 * This script runs performance analysis on a Supabase database branch using
 * the Supabase advisors and custom performance queries.
 * 
 * Usage: node scripts/check-database-performance.js <branch-id>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runPostgresQuery } from './lib/postgres-query.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const REPORTS_DIR = path.join(__dirname, '..', '.reports');
const REQUIRED_INDEXES = [
  {
    name: 'sessions_org_therapist_start_time_idx',
    table: 'public.sessions',
    definitionSnippets: ['ON public.sessions', '(organization_id, therapist_id, start_time)'],
  },
  {
    name: 'clients_org_status_active_idx',
    table: 'public.clients',
    definitionSnippets: [
      'ON public.clients',
      '(organization_id, status, full_name)',
      'WHERE (deleted_at IS NULL)'
    ],
  },
  {
    name: 'billing_records_org_status_created_idx',
    table: 'public.billing_records',
    definitionSnippets: ['ON public.billing_records', '(organization_id, status, created_at DESC)'],
  },
  {
    name: 'session_cpt_entries_org_session_line_idx',
    table: 'public.session_cpt_entries',
    definitionSnippets: ['ON public.session_cpt_entries', '(organization_id, session_id, line_number)'],
  },
];

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
    logger.info(`Running SQL performance advisors for branch: ${branchId}`);

    const query = `
      SELECT
        'slow_query' as level,
        left(query, 180) as message,
        'performance' as category
      FROM pg_stat_statements
      WHERE calls > 0
        AND (
          (COALESCE(total_exec_time, 0) + COALESCE(total_plan_time, 0)) / calls
        ) > 250
      ORDER BY (
        (COALESCE(total_exec_time, 0) + COALESCE(total_plan_time, 0)) / calls
      ) DESC
      LIMIT 10;
    `;

    let advisors;
    try {
      advisors = await runPostgresQuery(query);
    } catch {
      advisors = [];
    }

    logger.success('SQL performance advisors completed');
    return { advisors, errors: [] };
  }, 2, 1000).catch((error) => {
    logger.error(`Performance advisors failed after all retries: ${error.message}`);
    return { advisors: [], errors: [error.message] };
  });
}

/**
 * Check slow queries
 */
async function checkSlowQueries(branchId) {
  try {
    logger.info('Checking for slow queries...');

    // pg_stat_statements columns differ across PostgreSQL versions.
    const modernSlowQueriesQuery = `
      SELECT
        query,
        calls,
        round((COALESCE(total_plan_time, 0) + COALESCE(total_exec_time, 0))::numeric, 2) as total_time,
        round((COALESCE(mean_plan_time, 0) + COALESCE(mean_exec_time, 0))::numeric, 2) as mean_time,
        round(COALESCE(min_exec_time, 0)::numeric, 2) as min_time,
        round(COALESCE(max_exec_time, 0)::numeric, 2) as max_time,
        round(COALESCE(stddev_exec_time, 0)::numeric, 2) as stddev_time,
        rows,
        CASE WHEN calls > 0
          THEN round(((COALESCE(total_plan_time, 0) + COALESCE(total_exec_time, 0)) / calls)::numeric, 2)
          ELSE 0
        END as avg_time_ms
      FROM pg_stat_statements
      WHERE (COALESCE(total_plan_time, 0) + COALESCE(total_exec_time, 0)) > 1000
      ORDER BY (COALESCE(total_plan_time, 0) + COALESCE(total_exec_time, 0)) DESC
      LIMIT 10;
    `;

    const legacySlowQueriesQuery = `
      SELECT
        query,
        calls,
        round(total_time::numeric, 2) as total_time,
        round(mean_time::numeric, 2) as mean_time,
        round(min_time::numeric, 2) as min_time,
        round(max_time::numeric, 2) as max_time,
        round(stddev_time::numeric, 2) as stddev_time,
        rows,
        CASE WHEN calls > 0 THEN round((total_time / calls)::numeric, 2) ELSE 0 END as avg_time_ms
      FROM pg_stat_statements
      WHERE total_time > 1000
      ORDER BY total_time DESC
      LIMIT 10;
    `;

    let slowQueries;
    try {
      slowQueries = await runPostgresQuery(modernSlowQueriesQuery);
    } catch {
      slowQueries = await runPostgresQuery(legacySlowQueriesQuery);
    }
    
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
    
    // Check for tables without indexes
    const missingIndexesQuery = `
      SELECT 
        schemaname,
        relname as tablename,
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
    
    const indexIssues = await runPostgresQuery(missingIndexesQuery);
    
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
    
    const tableSizesQuery = `
      SELECT 
        schemaname,
        relname as tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||relname)) as size,
        pg_total_relation_size(schemaname||'.'||relname) as size_bytes,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        n_live_tup as live_tuples,
        n_dead_tup as dead_tuples,
        CASE 
          WHEN n_live_tup > 0 THEN round(((n_dead_tup::numeric / n_live_tup::numeric) * 100), 2)
          ELSE 0
        END as bloat_ratio
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||relname) DESC;
    `;
    
    const tableSizes = await runPostgresQuery(tableSizesQuery);
    
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
    
    const connections = await runPostgresQuery(connectionsQuery);
    
    logger.success(`Connection statistics retrieved`);
    return connections;
    
  } catch (error) {
    logger.error(`Connection check failed: ${error.message}`);
    return [];
  }
}

/**
 * Verify required indexes exist with expected definitions
 */
async function verifyRequiredIndexes(branchId) {
  try {
    logger.info('Verifying required indexes are present...');

    const indexNamesList = REQUIRED_INDEXES.map((index) => `'${index.name}'`).join(', ');

    const requiredIndexesQuery = `
      SELECT
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY (ARRAY[${indexNamesList}]);
    `;

    const rows = await runPostgresQuery(requiredIndexesQuery);
    const indexMap = new Map(rows.map((row) => [row.indexname, row.indexdef]));

    const missing = [];
    for (const index of REQUIRED_INDEXES) {
      const definition = indexMap.get(index.name);
      if (!definition) {
        missing.push(`${index.table}.${index.name}`);
        continue;
      }

      const hasAllSnippets = index.definitionSnippets.every((snippet) => definition.includes(snippet));
      if (!hasAllSnippets) {
        missing.push(`${index.table}.${index.name}`);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing or misconfigured indexes detected: ${missing.join(', ')}`);
    }

    logger.success('All required indexes verified');
    return {
      indexes: Object.fromEntries(indexMap),
      missing,
    };
  } catch (error) {
    logger.error(`Required index verification failed: ${error.message}`);
    throw error;
  }
}

/**
 * Generate performance report
 */
function generatePerformanceReport(branchId, advisors, slowQueries, indexIssues, tableSizes, connections, requiredIndexes) {
  const report = {
    branch_id: branchId,
    timestamp: new Date().toISOString(),
    summary: {
      total_issues: advisors.advisors.length + indexIssues.length,
      slow_queries: slowQueries.length,
      index_issues: indexIssues.length,
      largest_tables: tableSizes.slice(0, 5).map(t => ({ name: t.tablename, size: t.size })),
      total_connections: connections.reduce((sum, c) => sum + parseInt(c.connection_count || 0), 0),
      missing_required_indexes: requiredIndexes?.missing?.length ?? 0,
    },
    advisors: advisors.advisors,
    slow_queries: slowQueries,
    index_issues: indexIssues,
    table_sizes: tableSizes,
    connections: connections,
    errors: advisors.errors,
    recommendations: generatePerformanceRecommendations(advisors, slowQueries, indexIssues, tableSizes),
    required_indexes: requiredIndexes?.indexes ?? {},
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
    const [advisors, slowQueries, indexIssues, tableSizes, connections, requiredIndexes] = await Promise.all([
      runPerformanceAdvisors(branchId),
      checkSlowQueries(branchId),
      checkMissingIndexes(branchId),
      checkTableSizes(branchId),
      checkConnections(branchId),
      verifyRequiredIndexes(branchId),
    ]);

    // Generate report
    const report = generatePerformanceReport(
      branchId,
      advisors,
      slowQueries,
      indexIssues,
      tableSizes,
      connections,
      requiredIndexes,
    );
    
    // Save report
    const reportPath = savePerformanceReport(report);
    
    // Output summary
    logger.info(`Performance Check Summary:`);
    logger.info(`- Total Issues: ${report.summary.total_issues}`);
    logger.info(`- Slow Queries: ${report.summary.slow_queries}`);
    logger.info(`- Index Issues: ${report.summary.index_issues}`);
    logger.info(`- Total Connections: ${report.summary.total_connections}`);
    logger.info(`- Missing Required Indexes: ${report.summary.missing_required_indexes}`);
    
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
if (process.argv[1] === __filename) {
  main();
}

export {
  runPerformanceAdvisors,
  checkSlowQueries,
  checkMissingIndexes,
  checkTableSizes,
  checkConnections,
  verifyRequiredIndexes,
  generatePerformanceReport,
  savePerformanceReport
};
