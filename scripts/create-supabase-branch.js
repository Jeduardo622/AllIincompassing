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
      logger.info(`Branch '${branchName}' already exists, cleaning up first...`);
      await cleanupExistingBranch(branchName);
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
    
    // Handle specific error cases
    if (error.message.includes('cost confirmation')) {
      logger.info('Attempting to handle cost confirmation...');
      return await handleCostConfirmation(branchName);
    }
    
    if (error.message.includes('Failed to insert preview branch') || 
        error.message.includes('already exists')) {
      logger.info('Branch already exists, attempting cleanup and retry...');
      await cleanupExistingBranch(branchName);
      
      // Retry with a unique name
      const uniqueBranchName = `${branchName}-${Date.now()}`;
      logger.info(`Retrying with unique name: ${uniqueBranchName}`);
      return await createBranch(uniqueBranchName);
    }
    
    throw error;
  }
}

/**
 * Clean up an existing branch
 */
async function cleanupExistingBranch(branchName) {
  try {
    logger.info(`Cleaning up existing branch: ${branchName}`);
    
    // Try to delete the branch
    const deleteCommand = `supabase branches delete ${branchName} --experimental --force --project-ref ${PROJECT_REF}`;
    execSync(deleteCommand, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    logger.success(`Existing branch '${branchName}' cleaned up successfully`);
    
    // Wait a moment for the deletion to propagate
    await new Promise(resolve => setTimeout(resolve, 2000));
    
  } catch (error) {
    logger.warn(`Could not cleanup existing branch: ${error.message}`);
    // Continue anyway - the new branch creation might still work
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
    logger.info(`Parsing branch output: ${output}`);
    
    // Try to parse as JSON first
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      logger.info(`Parsed JSON: ${JSON.stringify(parsed)}`);
      return parsed;
    }
    
    // Try multiple regex patterns for different CLI output formats
    const patterns = [
      // Pattern 1: id: name:
      { id: /id:\s*([a-zA-Z0-9-]+)/, name: /name:\s*([a-zA-Z0-9-]+)/ },
      // Pattern 2: Branch ID: Branch Name:
      { id: /Branch ID:\s*([a-zA-Z0-9-]+)/, name: /Branch Name:\s*([a-zA-Z0-9-]+)/ },
      // Pattern 3: "branch_id": "branch_name":
      { id: /"branch_id":\s*"([a-zA-Z0-9-]+)"/, name: /"branch_name":\s*"([a-zA-Z0-9-]+)"/ },
      // Pattern 4: Extract from any line containing branch info
      { id: /([a-zA-Z0-9]{8}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{12})/, name: null }
    ];
    
    for (const pattern of patterns) {
      const idMatch = output.match(pattern.id);
      const nameMatch = pattern.name ? output.match(pattern.name) : null;
      
      if (idMatch) {
        const branchInfo = {
          id: idMatch[1],
          name: nameMatch ? nameMatch[1] : process.argv[2], // Use provided branch name as fallback
          database_url: `https://${idMatch[1]}.supabase.co`,
          created_at: new Date().toISOString()
        };
        
        logger.success(`Parsed branch info: ${JSON.stringify(branchInfo)}`);
        return branchInfo;
      }
    }
    
    // If no patterns match, try to extract UUID-like strings (branch IDs are usually UUIDs)
    const uuidPattern = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    const uuidMatch = output.match(uuidPattern);
    
    if (uuidMatch) {
      const branchInfo = {
        id: uuidMatch[1],
        name: process.argv[2], // Use provided branch name
        database_url: `https://${uuidMatch[1]}.supabase.co`,
        created_at: new Date().toISOString()
      };
      
      logger.success(`Extracted UUID as branch ID: ${JSON.stringify(branchInfo)}`);
      return branchInfo;
    }
    
    throw new Error('Could not parse branch information from output');
    
  } catch (error) {
    logger.error(`Failed to parse branch output: ${error.message}`);
    logger.error(`Raw output was: ${output}`);
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
  saveBranchInfo,
  cleanupExistingBranch
}; 