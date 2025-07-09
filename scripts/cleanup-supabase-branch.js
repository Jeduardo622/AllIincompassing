#!/usr/bin/env node

/**
 * Supabase Branch Cleanup Script
 * Simple script to clean up old Supabase branches
 * Based on real-world usage patterns
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  MAX_AGE_DAYS: 7,
  BATCH_SIZE: 5,
  DRY_RUN: false,
  PATTERN: null,
  VERBOSE: false
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--max-age':
        CONFIG.MAX_AGE_DAYS = parseInt(args[++i]);
        break;
      case '--pattern':
        CONFIG.PATTERN = args[++i];
        break;
      case '--dry-run':
        CONFIG.DRY_RUN = true;
        break;
      case '--verbose':
        CONFIG.VERBOSE = true;
        break;
      case '--help':
        showHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        showHelp();
        process.exit(1);
    }
  }
}

function showHelp() {
  console.log(`
Supabase Branch Cleanup Script

Usage: node cleanup-supabase-branch.js [options]

Options:
  --max-age <days>    Clean up branches older than N days (default: 7)
  --pattern <regex>   Clean up branches matching pattern (e.g., "^pr-")
  --dry-run          Preview changes without deleting
  --verbose          Show detailed output
  --help             Show this help message

Examples:
  node cleanup-supabase-branch.js --max-age 14
  node cleanup-supabase-branch.js --pattern "^feature-"
  node cleanup-supabase-branch.js --dry-run --max-age 7
  `);
}

function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = CONFIG.DRY_RUN ? '[DRY RUN] ' : '';
  
  if (level === 'verbose' && !CONFIG.VERBOSE) return;
  
  console.log(`${timestamp} ${prefix}${message}`);
}

function executeCommand(command, suppressOutput = false) {
  try {
    const result = execSync(command, { 
      encoding: 'utf8',
      stdio: suppressOutput ? 'pipe' : 'inherit'
    });
    return result.trim();
  } catch (error) {
    if (!suppressOutput) {
      console.error(`Error executing command: ${command}`);
      console.error(error.message);
    }
    return null;
  }
}

function checkSupabaseAuth() {
  log('Checking Supabase authentication...', 'verbose');
  
  const result = executeCommand('supabase projects list', true);
  if (!result) {
    log('❌ Supabase authentication failed. Please run: supabase login');
    process.exit(1);
  }
  
  log('✅ Supabase authentication verified');
  return true;
}

function listSupabaseBranches() {
  log('Fetching Supabase branches...', 'verbose');
  
  const result = executeCommand('supabase branches list --format json', true);
  if (!result) {
    log('❌ Failed to fetch branches');
    return [];
  }
  
  try {
    const branches = JSON.parse(result);
    log(`Found ${branches.length} branches`, 'verbose');
    return branches;
  } catch (error) {
    log('❌ Failed to parse branches JSON');
    return [];
  }
}

function getBranchAge(branch) {
  const createdAt = new Date(branch.created_at);
  const now = new Date();
  const ageInDays = (now - createdAt) / (1000 * 60 * 60 * 24);
  return ageInDays;
}

function shouldCleanupBranch(branch) {
  // Don't delete main/production branches
  if (branch.name === 'main' || branch.name === 'production') {
    return false;
  }
  
  // Check pattern if provided
  if (CONFIG.PATTERN) {
    const regex = new RegExp(CONFIG.PATTERN);
    return regex.test(branch.name);
  }
  
  // Check age
  const age = getBranchAge(branch);
  return age > CONFIG.MAX_AGE_DAYS;
}

function cleanupBranch(branch) {
  const age = getBranchAge(branch).toFixed(1);
  
  if (CONFIG.DRY_RUN) {
    log(`Would delete branch: ${branch.name} (${age} days old)`);
    return true;
  }
  
  log(`Deleting branch: ${branch.name} (${age} days old)`);
  
  const result = executeCommand(`supabase branches delete ${branch.id} --confirm`, true);
  if (result !== null) {
    log(`✅ Successfully deleted branch: ${branch.name}`);
    return true;
  } else {
    log(`❌ Failed to delete branch: ${branch.name}`);
    return false;
  }
}

async function main() {
  console.log('🧹 Supabase Branch Cleanup Tool\n');
  
  parseArgs();
  
  // Validate configuration
  if (CONFIG.MAX_AGE_DAYS < 1) {
    console.error('❌ Max age must be at least 1 day');
    process.exit(1);
  }
  
  log(`Configuration:
    Max Age: ${CONFIG.MAX_AGE_DAYS} days
    Pattern: ${CONFIG.PATTERN || 'None'}
    Dry Run: ${CONFIG.DRY_RUN}
    Batch Size: ${CONFIG.BATCH_SIZE}
  `);
  
  // Check authentication
  if (!checkSupabaseAuth()) {
    process.exit(1);
  }
  
  // List branches
  const branches = listSupabaseBranches();
  if (branches.length === 0) {
    log('ℹ️  No branches found');
    return;
  }
  
  // Filter branches for cleanup
  const branchesToCleanup = branches.filter(shouldCleanupBranch);
  
  if (branchesToCleanup.length === 0) {
    log('ℹ️  No branches match cleanup criteria');
    return;
  }
  
  log(`Found ${branchesToCleanup.length} branches for cleanup:`);
  branchesToCleanup.forEach(branch => {
    const age = getBranchAge(branch).toFixed(1);
    log(`  - ${branch.name} (${age} days old)`, 'verbose');
  });
  
  // Cleanup branches in batches
  let successful = 0;
  let failed = 0;
  
  for (let i = 0; i < branchesToCleanup.length; i += CONFIG.BATCH_SIZE) {
    const batch = branchesToCleanup.slice(i, i + CONFIG.BATCH_SIZE);
    
    log(`\nProcessing batch ${Math.floor(i / CONFIG.BATCH_SIZE) + 1}/${Math.ceil(branchesToCleanup.length / CONFIG.BATCH_SIZE)}`);
    
    for (const branch of batch) {
      if (cleanupBranch(branch)) {
        successful++;
      } else {
        failed++;
      }
    }
    
    // Small delay between batches
    if (i + CONFIG.BATCH_SIZE < branchesToCleanup.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Summary
  log(`\n🎉 Cleanup complete!
    Total branches: ${branches.length}
    Cleaned up: ${successful}
    Failed: ${failed}
    Skipped: ${branches.length - branchesToCleanup.length}
  `);
  
  if (CONFIG.DRY_RUN) {
    log('\n💡 This was a dry run. Run without --dry-run to actually delete branches.');
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  });
}

module.exports = {
  cleanupBranch,
  listSupabaseBranches,
  getBranchAge,
  CONFIG
};