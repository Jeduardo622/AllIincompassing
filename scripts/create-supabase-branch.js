#!/usr/bin/env node

/**
 * Create Supabase Branch Script
 * 
 * This script creates a new development branch in Supabase for PR testing.
 * It handles cost confirmation and branch creation using the Supabase CLI.
 * 
 * Usage: node scripts/create-supabase-branch.js <branch-name>
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'wnnjeqheqxxyrgsjmygy';
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
 * Ensure cache directory exists
 */
function ensureCacheDir() {
  if (!fs.existsSync(BRANCH_CACHE_DIR)) {
    fs.mkdirSync(BRANCH_CACHE_DIR, { recursive: true });
  }
}

/**
 * Check if branch already exists
 */
function checkBranchExists(branchName) {
  try {
    const output = execSync('supabase branches list --experimental --output json', {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const branches = JSON.parse(output);
    const existingBranch = branches.find(b => b.name === branchName);
    
    if (existingBranch) {
      logger.info(`Branch '${branchName}' already exists with ID: ${existingBranch.id}`);
      return existingBranch;
    }
    
    return null;
  } catch (error) {
    logger.warn(`Could not check existing branches: ${error.message}`);
    return null;
  }
}

/**
 * Create a new Supabase branch
 */
async function createBranch(branchName) {
  try {
    // Check if branch already exists
    const existingBranch = checkBranchExists(branchName);
    if (existingBranch) {
      saveBranchInfo(branchName, existingBranch);
      return existingBranch;
    }

    logger.info(`Creating new branch: ${branchName}`);
    
    // Create the branch using Supabase CLI
    // Note: This assumes cost confirmation is handled elsewhere or auto-approved
    const createCommand = `supabase branches create ${branchName} --experimental --project-ref ${PROJECT_REF}`;
    
    logger.info(`Executing: ${createCommand}`);
    const output = execSync(createCommand, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    logger.success(`Branch created successfully: ${branchName}`);
    
    // Parse the output to get branch information
    const branchInfo = parseBranchOutput(output);
    
    // Save branch info to cache
    saveBranchInfo(branchName, branchInfo);
    
    return branchInfo;
    
  } catch (error) {
    logger.error(`Failed to create branch: ${error.message}`);
    
    // If creation fails, try to handle specific error cases
    if (error.message.includes('cost confirmation')) {
      logger.info('Attempting to handle cost confirmation...');
      return await handleCostConfirmation(branchName);
    }
    
    throw error;
  }
}

/**
 * Handle cost confirmation for branch creation
 */
async function handleCostConfirmation(branchName) {
  try {
    // First, get the cost confirmation ID
    const costCommand = `supabase branches create ${branchName} --experimental --project-ref ${PROJECT_REF} --dry-run`;
    const costOutput = execSync(costCommand, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const costConfirmId = parseCostConfirmation(costOutput);
    
    if (costConfirmId) {
      logger.info(`Cost confirmation ID: ${costConfirmId}`);
      
      // Now create the branch with cost confirmation
      const createCommand = `supabase branches create ${branchName} --experimental --project-ref ${PROJECT_REF} --confirm-cost ${costConfirmId}`;
      const output = execSync(createCommand, {
        encoding: 'utf8',
        stdio: 'pipe'
      });
      
      return parseBranchOutput(output);
    }
    
    throw new Error('Could not get cost confirmation ID');
    
  } catch (error) {
    logger.error(`Cost confirmation failed: ${error.message}`);
    throw error;
  }
}

/**
 * Parse cost confirmation from output
 */
function parseCostConfirmation(output) {
  // Look for cost confirmation ID in output
  const match = output.match(/cost-confirmation-id:\s*([a-zA-Z0-9-]+)/);
  return match ? match[1] : null;
}

/**
 * Parse branch information from CLI output
 */
function parseBranchOutput(output) {
  try {
    // Try to parse as JSON first
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // Fallback to regex parsing
    const idMatch = output.match(/id:\s*([a-zA-Z0-9-]+)/);
    const nameMatch = output.match(/name:\s*([a-zA-Z0-9-]+)/);
    
    if (idMatch && nameMatch) {
      return {
        id: idMatch[1],
        name: nameMatch[1],
        database_url: `https://${idMatch[1]}.supabase.co`,
        created_at: new Date().toISOString()
      };
    }
    
    throw new Error('Could not parse branch information from output');
    
  } catch (error) {
    logger.error(`Failed to parse branch output: ${error.message}`);
    throw error;
  }
}

/**
 * Save branch information to cache
 */
function saveBranchInfo(branchName, branchInfo) {
  try {
    ensureCacheDir();
    
    const cacheFile = path.join(BRANCH_CACHE_DIR, `${branchName}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify(branchInfo, null, 2));
    
    logger.success(`Branch info saved to cache: ${cacheFile}`);
    
  } catch (error) {
    logger.warn(`Could not save branch info to cache: ${error.message}`);
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    const branchName = process.argv[2];
    
    if (!branchName) {
      logger.error('Branch name is required');
      logger.info('Usage: node scripts/create-supabase-branch.js <branch-name>');
      process.exit(1);
    }
    
    logger.info(`Starting branch creation for: ${branchName}`);
    
    // Validate branch name
    if (!/^[a-zA-Z0-9-]+$/.test(branchName)) {
      logger.error('Invalid branch name. Use only letters, numbers, and hyphens.');
      process.exit(1);
    }
    
    // Create the branch
    const branchInfo = await createBranch(branchName);
    
    logger.success(`Branch creation completed successfully!`);
    logger.info(`Branch ID: ${branchInfo.id}`);
    logger.info(`Branch Name: ${branchInfo.name}`);
    
    // Output branch ID for GitHub Actions
    console.log(`BRANCH_ID=${branchInfo.id}`);
    
  } catch (error) {
    logger.error(`Branch creation failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  createBranch,
  checkBranchExists,
  saveBranchInfo
}; 