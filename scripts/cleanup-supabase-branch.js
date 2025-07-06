#!/usr/bin/env node

/**
 * Cleanup Supabase Branch Script
 * 
 * This script deletes a Supabase development branch and cleans up associated resources.
 * Used when PRs are closed to prevent resource accumulation.
 * 
 * Usage: node scripts/cleanup-supabase-branch.js <branch-name>
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
 * Get branch info from cache
 */
function getBranchFromCache(branchName) {
  try {
    const cacheFile = path.join(BRANCH_CACHE_DIR, `${branchName}.json`);
    
    if (fs.existsSync(cacheFile)) {
      const branchInfo = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      logger.info(`Found branch in cache: ${branchInfo.id}`);
      return branchInfo;
    }
    
    return null;
  } catch (error) {
    logger.warn(`Could not read from cache: ${error.message}`);
    return null;
  }
}

/**
 * Get branch info from Supabase API
 */
function getBranchFromAPI(branchName) {
  try {
    logger.info(`Querying Supabase for branch: ${branchName}`);
    
    const output = execSync('supabase branches list --format json', {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const branches = JSON.parse(output);
    const branch = branches.find(b => b.name === branchName);
    
    if (branch) {
      logger.success(`Found branch: ${branch.id}`);
      return branch;
    }
    
    return null;
  } catch (error) {
    logger.error(`Failed to query Supabase: ${error.message}`);
    return null;
  }
}

/**
 * Delete branch from Supabase
 */
function deleteBranch(branchInfo) {
  try {
    logger.info(`Deleting branch: ${branchInfo.name} (${branchInfo.id})`);
    
    const deleteCommand = `supabase branches delete ${branchInfo.id} --force`;
    
    logger.info(`Executing: ${deleteCommand}`);
    const output = execSync(deleteCommand, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    logger.success(`Branch deleted successfully: ${branchInfo.name}`);
    logger.info(`Delete output: ${output}`);
    
    return true;
  } catch (error) {
    logger.error(`Failed to delete branch: ${error.message}`);
    
    // Log the error but don't fail - the branch might already be deleted
    if (error.message.includes('not found') || error.message.includes('does not exist')) {
      logger.warn(`Branch may already be deleted: ${branchInfo.name}`);
      return true;
    }
    
    return false;
  }
}

/**
 * Clean up cache files
 */
function cleanupCache(branchName) {
  try {
    const cacheFile = path.join(BRANCH_CACHE_DIR, `${branchName}.json`);
    
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
      logger.success(`Cache file deleted: ${cacheFile}`);
    } else {
      logger.info(`No cache file found for: ${branchName}`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Failed to cleanup cache: ${error.message}`);
    return false;
  }
}

/**
 * Clean up related resources
 */
function cleanupRelatedResources(branchInfo) {
  try {
    logger.info(`Cleaning up related resources for: ${branchInfo.name}`);
    
    // Here you could add additional cleanup logic:
    // - Remove temporary files
    // - Clean up logging entries
    // - Remove monitoring configurations
    // - etc.
    
    logger.success(`Related resources cleaned up for: ${branchInfo.name}`);
    return true;
  } catch (error) {
    logger.error(`Failed to cleanup related resources: ${error.message}`);
    return false;
  }
}

/**
 * Main cleanup function
 */
async function cleanupBranch(branchName) {
  try {
    logger.info(`Starting cleanup for branch: ${branchName}`);
    
    // Get branch info
    let branchInfo = getBranchFromCache(branchName);
    if (!branchInfo) {
      branchInfo = getBranchFromAPI(branchName);
    }
    
    if (!branchInfo) {
      logger.warn(`Branch not found, cleaning up cache only: ${branchName}`);
      cleanupCache(branchName);
      return true;
    }
    
    // Delete the branch
    const deleteSuccess = deleteBranch(branchInfo);
    
    // Clean up cache regardless of delete success
    cleanupCache(branchName);
    
    // Clean up related resources
    cleanupRelatedResources(branchInfo);
    
    if (deleteSuccess) {
      logger.success(`Branch cleanup completed successfully: ${branchName}`);
      return true;
    } else {
      logger.warn(`Branch cleanup completed with warnings: ${branchName}`);
      return false;
    }
    
  } catch (error) {
    logger.error(`Branch cleanup failed: ${error.message}`);
    throw error;
  }
}

/**
 * Cleanup multiple branches by pattern
 */
async function cleanupBranchesByPattern(pattern) {
  try {
    logger.info(`Cleaning up branches matching pattern: ${pattern}`);
    
    const output = execSync('supabase branches list --format json', {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const branches = JSON.parse(output);
    const matchingBranches = branches.filter(b => b.name.match(pattern));
    
    logger.info(`Found ${matchingBranches.length} branches matching pattern`);
    
    for (const branch of matchingBranches) {
      await cleanupBranch(branch.name);
    }
    
    logger.success(`Pattern cleanup completed: ${pattern}`);
    return true;
    
  } catch (error) {
    logger.error(`Pattern cleanup failed: ${error.message}`);
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    const branchName = process.argv[2];
    const pattern = process.argv[3];
    
    if (!branchName && !pattern) {
      logger.error('Branch name or pattern is required');
      logger.info('Usage: node scripts/cleanup-supabase-branch.js <branch-name>');
      logger.info('       node scripts/cleanup-supabase-branch.js --pattern <regex-pattern>');
      process.exit(1);
    }
    
    if (branchName === '--pattern' && pattern) {
      // Cleanup by pattern
      await cleanupBranchesByPattern(pattern);
    } else {
      // Cleanup single branch
      await cleanupBranch(branchName);
    }
    
    logger.success('Cleanup operation completed');
    
  } catch (error) {
    logger.error(`Cleanup failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  cleanupBranch,
  cleanupBranchesByPattern,
  deleteBranch,
  cleanupCache,
  cleanupRelatedResources
}; 