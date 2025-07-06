#!/usr/bin/env node

/**
 * Get Supabase Branch URL Script
 * 
 * This script generates the database URL for a given branch ID.
 * The URL is used for connecting to the branch database.
 * 
 * Usage: node scripts/get-branch-url.js <branch-id>
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BRANCH_CACHE_DIR = path.join(__dirname, '..', '.cache', 'supabase-branches');

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
 * Get branch URL from cache
 */
function getBranchUrlFromCache(branchId) {
  try {
    const cacheFiles = fs.readdirSync(BRANCH_CACHE_DIR);
    
    for (const file of cacheFiles) {
      if (file.endsWith('.json')) {
        const branchInfo = JSON.parse(fs.readFileSync(path.join(BRANCH_CACHE_DIR, file), 'utf8'));
        if (branchInfo.id === branchId) {
          logger.info(`Found branch URL in cache: ${branchInfo.database_url}`);
          return branchInfo.database_url;
        }
      }
    }
    
    return null;
  } catch (error) {
    logger.warn(`Could not read from cache: ${error.message}`);
    return null;
  }
}

/**
 * Get branch URL from Supabase API
 */
function getBranchUrlFromAPI(branchId) {
  try {
    logger.info(`Querying Supabase for branch URL: ${branchId}`);
    
    const output = execSync('supabase branches list --format json', {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const branches = JSON.parse(output);
    const branch = branches.find(b => b.id === branchId);
    
    if (branch) {
      const databaseUrl = branch.database_url || `https://${branchId}.supabase.co`;
      logger.success(`Found branch URL: ${databaseUrl}`);
      return databaseUrl;
    }
    
    return null;
  } catch (error) {
    logger.error(`Failed to query Supabase: ${error.message}`);
    return null;
  }
}

/**
 * Generate branch URL from branch ID
 */
function generateBranchUrl(branchId) {
  // Standard Supabase URL format
  return `https://${branchId}.supabase.co`;
}

/**
 * Get branch URL by ID
 */
function getBranchUrl(branchId) {
  // First try cache
  let branchUrl = getBranchUrlFromCache(branchId);
  
  if (branchUrl) {
    return branchUrl;
  }
  
  // Try API
  branchUrl = getBranchUrlFromAPI(branchId);
  
  if (branchUrl) {
    return branchUrl;
  }
  
  // Fallback to generated URL
  logger.warn(`Could not find branch URL, generating from ID: ${branchId}`);
  return generateBranchUrl(branchId);
}

/**
 * Main execution
 */
function main() {
  try {
    const branchId = process.argv[2];
    
    if (!branchId) {
      logger.error('Branch ID is required');
      logger.info('Usage: node scripts/get-branch-url.js <branch-id>');
      process.exit(1);
    }
    
    logger.info(`Getting branch URL for: ${branchId}`);
    
    const branchUrl = getBranchUrl(branchId);
    
    // Output for GitHub Actions
    console.log(branchUrl);
    
  } catch (error) {
    logger.error(`Failed to get branch URL: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  getBranchUrl,
  getBranchUrlFromCache,
  getBranchUrlFromAPI,
  generateBranchUrl
}; 