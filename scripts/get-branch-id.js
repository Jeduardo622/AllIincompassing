#!/usr/bin/env node

/**
 * Get Supabase Branch ID Script
 * 
 * This script retrieves the branch ID for a given branch name.
 * It first checks the cache, then falls back to querying Supabase.
 * 
 * Usage: node scripts/get-branch-id.js <branch-name>
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BRANCH_CACHE_DIR = path.join(__dirname, '..', '.cache', 'supabase-branches');
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'wnnjeqheqxxyrgsjmygy';

/**
 * Logger utility - sends debug messages to stderr, not stdout
 */
const logger = {
  info: (msg) => console.error(`ℹ️  ${msg}`),
  success: (msg) => console.error(`✅ ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  warn: (msg) => console.error(`⚠️  ${msg}`)
};

/**
 * Get branch ID from cache
 */
function getBranchFromCache(branchName) {
  try {
    const cacheFile = path.join(BRANCH_CACHE_DIR, `${branchName}.json`);
    
    if (fs.existsSync(cacheFile)) {
      const branchInfo = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      logger.info(`Found branch in cache: ${branchInfo.id}`);
      return branchInfo.id;
    }
    
    return null;
  } catch (error) {
    logger.warn(`Could not read from cache: ${error.message}`);
    return null;
  }
}

/**
 * Get branch ID from Supabase API
 */
function getBranchFromAPI(branchName) {
  try {
    logger.info(`Querying Supabase for branch: ${branchName}`);
    
    const output = execSync(`supabase branches list --experimental --output json --project-ref ${PROJECT_REF}`, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const branches = JSON.parse(output);
    const branch = branches.find(b => b.name === branchName);
    
    if (branch) {
      logger.success(`Found branch: ${branch.id}`);
      return branch.id;
    }
    
    return null;
  } catch (error) {
    logger.error(`Failed to query Supabase: ${error.message}`);
    return null;
  }
}

/**
 * Get branch ID by name
 */
function getBranchId(branchName) {
  // First try cache
  let branchId = getBranchFromCache(branchName);
  
  if (branchId) {
    return branchId;
  }
  
  // Fallback to API
  branchId = getBranchFromAPI(branchName);
  
  if (branchId) {
    return branchId;
  }
  
  throw new Error(`Branch not found: ${branchName}`);
}

/**
 * Main execution
 */
function main() {
  try {
    const branchName = process.argv[2];
    
    if (!branchName) {
      logger.error('Branch name is required');
      logger.info('Usage: node scripts/get-branch-id.js <branch-name>');
      process.exit(1);
    }
    
    logger.info(`Getting branch ID for: ${branchName}`);
    
    const branchId = getBranchId(branchName);
    
    // Output ONLY the branch ID to stdout for GitHub Actions
    console.log(branchId);
    
  } catch (error) {
    logger.error(`Failed to get branch ID: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  getBranchId,
  getBranchFromCache,
  getBranchFromAPI
};