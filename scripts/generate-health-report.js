#!/usr/bin/env node

/**
 * Generate Health Report Script
 * 
 * This script generates a comprehensive health report by combining
 * security and performance reports into a formatted markdown report.
 * 
 * Usage: node scripts/generate-health-report.js <branch-id>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { runSecurityAdvisors, checkRLSPolicies, checkExposedFunctions } from './check-database-security.js';
import { runPerformanceAdvisors, checkSlowQueries, checkMissingIndexes, checkTableSizes } from './check-database-performance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * Generate comprehensive health report
 */
async function generateHealthReport(branchId) {
  try {
    logger.info(`Generating health report for branch: ${branchId}`);
    
    // Run security checks
    const [securityAdvisors, rlsIssues, exposedFunctions] = await Promise.all([
      runSecurityAdvisors(branchId),
      checkRLSPolicies(branchId),
      checkExposedFunctions(branchId)
    ]);
    
    // Run performance checks
    const [performanceAdvisors, slowQueries, indexIssues, tableSizes] = await Promise.all([
      runPerformanceAdvisors(branchId),
      checkSlowQueries(branchId),
      checkMissingIndexes(branchId),
      checkTableSizes(branchId)
    ]);
    
    // Generate combined report
    const report = {
      branch_id: branchId,
      timestamp: new Date().toISOString(),
      summary: {
        overall_health: 'unknown',
        security_score: 0,
        performance_score: 0,
        total_issues: 0,
        critical_issues: 0,
        warnings: 0
      },
      security: {
        advisors: securityAdvisors.advisors || [],
        rls_issues: rlsIssues || [],
        exposed_functions: exposedFunctions || [],
        errors: securityAdvisors.errors || []
      },
      performance: {
        advisors: performanceAdvisors.advisors || [],
        slow_queries: slowQueries || [],
        index_issues: indexIssues || [],
        table_sizes: tableSizes || [],
        errors: performanceAdvisors.errors || []
      }
    };
    
    // Calculate scores and summary
    calculateHealthScores(report);
    
    logger.success('Health report generated successfully');
    return report;
    
  } catch (error) {
    logger.error(`Failed to generate health report: ${error.message}`);
    throw error;
  }
}

/**
 * Calculate health scores
 */
function calculateHealthScores(report) {
  // Security score calculation
  const securityIssues = report.security.advisors.length + 
                        report.security.rls_issues.length + 
                        report.security.exposed_functions.length;
  
  const criticalSecurityIssues = report.security.advisors.filter(a => a.level === 'critical').length;
  const highSecurityIssues = report.security.rls_issues.filter(i => i.severity === 'high').length;
  
  // Performance score calculation
  const performanceIssues = report.performance.advisors.length + 
                           report.performance.slow_queries.length + 
                           report.performance.index_issues.length;
  
  const criticalPerformanceIssues = report.performance.slow_queries.filter(q => 
    parseFloat(q.avg_time_ms) > 5000
  ).length;
  
  // Overall calculations
  const totalIssues = securityIssues + performanceIssues;
  const criticalIssues = criticalSecurityIssues + highSecurityIssues + criticalPerformanceIssues;
  
  // Security score (0-100)
  let securityScore = 100;
  securityScore -= (criticalSecurityIssues * 30);
  securityScore -= (highSecurityIssues * 20);
  securityScore -= (report.security.exposed_functions.length * 10);
  securityScore -= (report.security.advisors.filter(a => a.level === 'warning').length * 5);
  securityScore = Math.max(0, securityScore);
  
  // Performance score (0-100)
  let performanceScore = 100;
  performanceScore -= (criticalPerformanceIssues * 25);
  performanceScore -= (report.performance.slow_queries.length * 10);
  performanceScore -= (report.performance.index_issues.length * 5);
  performanceScore = Math.max(0, performanceScore);
  
  // Overall health
  const overallScore = (securityScore + performanceScore) / 2;
  let overallHealth = 'excellent';
  if (overallScore < 50) overallHealth = 'poor';
  else if (overallScore < 70) overallHealth = 'fair';
  else if (overallScore < 85) overallHealth = 'good';
  
  // Update summary
  report.summary = {
    overall_health: overallHealth,
    security_score: Math.round(securityScore),
    performance_score: Math.round(performanceScore),
    overall_score: Math.round(overallScore),
    total_issues: totalIssues,
    critical_issues: criticalIssues,
    warnings: report.security.advisors.filter(a => a.level === 'warning').length +
              report.performance.advisors.filter(a => a.level === 'warning').length
  };
}

/**
 * Format health report as markdown
 */
function formatAsMarkdown(report) {
  const { summary, security, performance } = report;
  
  const healthEmoji = {
    excellent: '🟢',
    good: '🟡',
    fair: '🟠',
    poor: '🔴'
  };
  
  let markdown = `# 🏥 Database Health Report

## 📊 Overall Health: ${healthEmoji[summary.overall_health]} ${summary.overall_health.toUpperCase()}

| Metric | Score | Status |
|--------|-------|--------|
| 🔒 Security | ${summary.security_score}/100 | ${getScoreStatus(summary.security_score)} |
| ⚡ Performance | ${summary.performance_score}/100 | ${getScoreStatus(summary.performance_score)} |
| 📋 Total Issues | ${summary.total_issues} | ${summary.total_issues === 0 ? '✅ None' : '⚠️ Found'} |
| 🚨 Critical Issues | ${summary.critical_issues} | ${summary.critical_issues === 0 ? '✅ None' : '❌ Action Required'} |

---

## 🔒 Security Analysis

`;

  // Security section
  if (security.advisors.length > 0) {
    markdown += `### 🛡️ Security Advisors (${security.advisors.length} issues)

`;
    security.advisors.forEach(advisor => {
      const icon = advisor.level === 'critical' ? '🚨' : advisor.level === 'error' ? '❌' : '⚠️';
      markdown += `- ${icon} **${advisor.level.toUpperCase()}**: ${advisor.message}\n`;
    });
    markdown += '\n';
  }
  
  if (security.rls_issues.length > 0) {
    markdown += `### 🔐 Row Level Security Issues (${security.rls_issues.length} tables)

`;
    security.rls_issues.forEach(issue => {
      markdown += `- ❌ **${issue.table}**: ${issue.issue}\n`;
    });
    markdown += '\n';
  }
  
  if (security.exposed_functions.length > 0) {
    markdown += `### 🔓 Exposed Functions (${security.exposed_functions.length} functions)

`;
    security.exposed_functions.forEach(func => {
      markdown += `- ⚠️ **${func.function}**: ${func.issue}\n`;
    });
    markdown += '\n';
  }
  
  if (security.advisors.length === 0 && security.rls_issues.length === 0 && security.exposed_functions.length === 0) {
    markdown += `### ✅ No Security Issues Found

All security checks passed successfully!

`;
  }
  
  markdown += `---

## ⚡ Performance Analysis

`;
  
  // Performance section
  if (performance.slow_queries.length > 0) {
    markdown += `### 🐌 Slow Queries (${performance.slow_queries.length} queries)

`;
    performance.slow_queries.slice(0, 5).forEach(query => {
      const avgTime = parseFloat(query.avg_time_ms || 0).toFixed(2);
      markdown += `- 🐌 **${avgTime}ms avg**: ${query.query.substring(0, 80)}...\n`;
    });
    if (performance.slow_queries.length > 5) {
      markdown += `- _... and ${performance.slow_queries.length - 5} more slow queries_\n`;
    }
    markdown += '\n';
  }
  
  if (performance.index_issues.length > 0) {
    markdown += `### 📊 Index Issues (${performance.index_issues.length} tables)

`;
    performance.index_issues.slice(0, 5).forEach(issue => {
      markdown += `- 📊 **${issue.tablename}**: ${issue.index_health}\n`;
    });
    if (performance.index_issues.length > 5) {
      markdown += `- _... and ${performance.index_issues.length - 5} more index issues_\n`;
    }
    markdown += '\n';
  }
  
  if (performance.table_sizes.length > 0) {
    markdown += `### 📦 Largest Tables

`;
    performance.table_sizes.slice(0, 5).forEach(table => {
      const bloat = parseFloat(table.bloat_ratio || 0);
      const bloatWarning = bloat > 20 ? ' ⚠️' : '';
      markdown += `- 📦 **${table.tablename}**: ${table.size}${bloatWarning}\n`;
    });
    markdown += '\n';
  }
  
  if (performance.slow_queries.length === 0 && performance.index_issues.length === 0) {
    markdown += `### ✅ No Performance Issues Found

All performance checks passed successfully!

`;
  }
  
  // Recommendations section
  markdown += `---

## 💡 Recommendations

`;
  
  const recommendations = generateRecommendations(report);
  if (recommendations.length > 0) {
    recommendations.forEach(rec => {
      const icon = rec.priority === 'critical' ? '🚨' : rec.priority === 'high' ? '❌' : rec.priority === 'medium' ? '⚠️' : 'ℹ️';
      markdown += `- ${icon} **${rec.type.toUpperCase()}**: ${rec.message}\n`;
      if (rec.action) {
        markdown += `  - 💡 _Action: ${rec.action}_\n`;
      }
    });
  } else {
    markdown += `✅ No immediate recommendations. Your database is in excellent health!

`;
  }
  
  markdown += `
---

*Report generated at ${new Date(report.timestamp).toLocaleString()}*
*Branch: \`${report.branch_id}\`*
`;
  
  return markdown;
}

/**
 * Get score status
 */
function getScoreStatus(score) {
  if (score >= 85) return '🟢 Excellent';
  if (score >= 70) return '🟡 Good';
  if (score >= 50) return '🟠 Fair';
  return '🔴 Poor';
}

/**
 * Generate recommendations
 */
function generateRecommendations(report) {
  const recommendations = [];
  
  // Security recommendations
  if (report.security.rls_issues.length > 0) {
    recommendations.push({
      type: 'security',
      priority: 'high',
      message: `Enable RLS on ${report.security.rls_issues.length} tables`,
      action: 'ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;'
    });
  }
  
  const criticalSecurity = report.security.advisors.filter(a => a.level === 'critical');
  if (criticalSecurity.length > 0) {
    recommendations.push({
      type: 'security',
      priority: 'critical',
      message: `Address ${criticalSecurity.length} critical security issues`,
      action: 'Review security advisor recommendations immediately'
    });
  }
  
  // Performance recommendations
  if (report.performance.slow_queries.length > 0) {
    recommendations.push({
      type: 'performance',
      priority: 'high',
      message: `Optimize ${report.performance.slow_queries.length} slow queries`,
      action: 'Review query execution plans and add indexes'
    });
  }
  
  if (report.performance.index_issues.length > 0) {
    recommendations.push({
      type: 'performance',
      priority: 'medium',
      message: `Add indexes to ${report.performance.index_issues.length} tables`,
      action: 'CREATE INDEX ON table_name (column_name);'
    });
  }
  
  return recommendations;
}

/**
 * Main execution
 */
async function main() {
  try {
    const branchId = process.argv[2];
    
    if (!branchId) {
      logger.error('Branch ID is required');
      logger.info('Usage: node scripts/generate-health-report.js <branch-id>');
      process.exit(1);
    }
    
    // Generate health report
    const report = await generateHealthReport(branchId);
    
    // Format as markdown
    const markdown = formatAsMarkdown(report);
    
    // Output the markdown (this will be captured by GitHub Actions)
    console.log(markdown);
    
    // Also save to file
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
    
    const filename = `health-report-${branchId}-${Date.now()}.md`;
    const filepath = path.join(REPORTS_DIR, filename);
    fs.writeFileSync(filepath, markdown);
    
    logger.success(`Health report saved: ${filepath}`);
    
    // Exit with error if critical issues found
    if (report.summary.critical_issues > 0) {
      logger.error(`Critical issues found! Review required.`);
      process.exit(1);
    }
    
  } catch (error) {
    logger.error(`Health report generation failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
if (process.argv[1] === __filename) {
  main();
}

export {
  generateHealthReport,
  formatAsMarkdown,
  calculateHealthScores,
  generateRecommendations
}; 