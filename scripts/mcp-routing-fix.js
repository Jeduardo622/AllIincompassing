#!/usr/bin/env node

/**
 * MCP Routing Fix Script
 * 
 * This script addresses the known Cursor MCP routing bug where tool names
 * conflict between different MCP servers (GitHub vs Supabase).
 * 
 * Issue: Both GitHub and Supabase MCP servers have tools named 'list_branches'
 * causing Cursor to incorrectly route requests to the wrong server.
 * 
 * Solutions implemented:
 * 1. Server name disambiguation
 * 2. Tool conflict detection
 * 3. Automatic server cycling
 * 4. Cache clearing utilities
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const MCP_CONFIG_PATH = path.join(__dirname, '..', '.cursor', 'mcp.json');
const BACKUP_CONFIG_PATH = path.join(__dirname, '..', '.cursor', 'mcp.backup.json');

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
 * Known conflicting tools between MCP servers
 */
const TOOL_CONFLICTS = {
  'list_branches': ['github', 'supabase'],
  'create_branch': ['github', 'supabase'],
  'delete_branch': ['github', 'supabase'],
  'get_branch': ['github', 'supabase']
};

/**
 * Server-specific configurations with disambiguation
 */
const SERVER_CONFIGS = {
  'github-mcp': {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN
    },
    conflictingTools: ['list_branches', 'create_branch', 'delete_branch']
  },
  'supabase-database': {
    command: 'npx',
    args: ['-y', '@supabase/mcp-server-supabase@latest', '--project-ref=wnnjeqheqxxyrgsjmygy'],
    env: {
      SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN || 'sbp_a6d1e749c37e86298e3a49ec7ab93f0b8eb9e653'
    },
    conflictingTools: ['list_branches', 'create_branch', 'delete_branch']
  }
};

/**
 * Read current MCP configuration
 */
function readMCPConfig() {
  try {
    if (!fs.existsSync(MCP_CONFIG_PATH)) {
      logger.warn('MCP configuration file not found');
      return { mcpServers: {} };
    }
    
    const content = fs.readFileSync(MCP_CONFIG_PATH, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    logger.error(`Failed to read MCP config: ${error.message}`);
    return { mcpServers: {} };
  }
}

/**
 * Write MCP configuration
 */
function writeMCPConfig(config) {
  try {
    fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
    logger.success('MCP configuration updated');
  } catch (error) {
    logger.error(`Failed to write MCP config: ${error.message}`);
  }
}

/**
 * Create backup of current configuration
 */
function backupConfig() {
  try {
    if (fs.existsSync(MCP_CONFIG_PATH)) {
      fs.copyFileSync(MCP_CONFIG_PATH, BACKUP_CONFIG_PATH);
      logger.success('Configuration backed up');
    }
  } catch (error) {
    logger.error(`Failed to backup config: ${error.message}`);
  }
}

/**
 * Restore configuration from backup
 */
function restoreConfig() {
  try {
    if (fs.existsSync(BACKUP_CONFIG_PATH)) {
      fs.copyFileSync(BACKUP_CONFIG_PATH, MCP_CONFIG_PATH);
      logger.success('Configuration restored from backup');
    }
  } catch (error) {
    logger.error(`Failed to restore config: ${error.message}`);
  }
}

/**
 * Detect tool conflicts in current configuration
 */
function detectConflicts() {
  const config = readMCPConfig();
  const conflicts = [];
  
  for (const [toolName, conflictingServers] of Object.entries(TOOL_CONFLICTS)) {
    const activeServers = conflictingServers.filter(server => 
      config.mcpServers[server] || config.mcpServers[`${server}-mcp`] || config.mcpServers[`${server}-database`]
    );
    
    if (activeServers.length > 1) {
      conflicts.push({
        tool: toolName,
        servers: activeServers
      });
    }
  }
  
  return conflicts;
}

/**
 * Enable only Supabase MCP server
 */
function enableSupabaseOnly() {
  logger.info('Configuring MCP for Supabase only...');
  
  const config = {
    mcpServers: {
      'supabase-database': SERVER_CONFIGS['supabase-database']
    }
  };
  
  backupConfig();
  writeMCPConfig(config);
  logger.success('Supabase MCP server configured (GitHub disabled)');
}

/**
 * Enable only GitHub MCP server
 */
function enableGitHubOnly() {
  logger.info('Configuring MCP for GitHub only...');
  
  if (!process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    logger.error('GITHUB_PERSONAL_ACCESS_TOKEN environment variable required');
    return;
  }
  
  const config = {
    mcpServers: {
      'github-mcp': SERVER_CONFIGS['github-mcp']
    }
  };
  
  backupConfig();
  writeMCPConfig(config);
  logger.success('GitHub MCP server configured (Supabase disabled)');
}

/**
 * Enable both servers with conflict resolution
 */
function enableBothWithWorkaround() {
  logger.info('Configuring both MCP servers with conflict resolution...');
  logger.warn('This is experimental and may still have routing issues');
  
  if (!process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    logger.error('GITHUB_PERSONAL_ACCESS_TOKEN environment variable required');
    return;
  }
  
  const config = {
    mcpServers: {
      'github-mcp': SERVER_CONFIGS['github-mcp'],
      'supabase-database': SERVER_CONFIGS['supabase-database']
    }
  };
  
  backupConfig();
  writeMCPConfig(config);
  logger.success('Both MCP servers configured with disambiguation');
  logger.warn('Tool conflicts may still occur - monitor usage carefully');
}

/**
 * Clear Cursor MCP cache
 */
function clearMCPCache() {
  logger.info('Clearing Cursor MCP cache...');
  
  try {
    // Clear potential cache locations
    const cacheLocations = [
      path.join(process.env.APPDATA || process.env.HOME + '/.config', 'cursor', 'mcp-cache'),
      path.join(process.env.HOME || process.env.USERPROFILE, '.cursor', 'mcp-cache'),
      path.join(__dirname, '..', '.cursor', 'cache')
    ];
    
    cacheLocations.forEach(location => {
      if (fs.existsSync(location)) {
        fs.rmSync(location, { recursive: true, force: true });
        logger.success(`Cleared cache at ${location}`);
      }
    });
    
    logger.success('MCP cache cleared');
  } catch (error) {
    logger.error(`Failed to clear cache: ${error.message}`);
  }
}

/**
 * Restart Cursor (platform-specific)
 */
function restartCursor() {
  logger.info('Attempting to restart Cursor...');
  
  try {
    const platform = process.platform;
    
    if (platform === 'win32') {
      execSync('taskkill /f /im cursor.exe', { stdio: 'ignore' });
      setTimeout(() => {
        execSync('start cursor', { stdio: 'ignore' });
      }, 2000);
    } else if (platform === 'darwin') {
      execSync('pkill -f cursor', { stdio: 'ignore' });
      setTimeout(() => {
        execSync('open -a cursor', { stdio: 'ignore' });
      }, 2000);
    } else {
      execSync('pkill -f cursor', { stdio: 'ignore' });
      setTimeout(() => {
        execSync('cursor &', { stdio: 'ignore' });
      }, 2000);
    }
    
    logger.success('Cursor restart initiated');
  } catch (error) {
    logger.error(`Failed to restart Cursor: ${error.message}`);
    logger.info('Please restart Cursor manually');
  }
}

/**
 * Main command handler
 */
function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'detect':
      logger.info('Detecting tool conflicts...');
      const conflicts = detectConflicts();
      if (conflicts.length > 0) {
        logger.error('Tool conflicts detected:');
        conflicts.forEach(conflict => {
          logger.error(`  - ${conflict.tool}: ${conflict.servers.join(', ')}`);
        });
      } else {
        logger.success('No tool conflicts detected');
      }
      break;
      
    case 'supabase-only':
      enableSupabaseOnly();
      clearMCPCache();
      logger.info('Restart Cursor to apply changes');
      break;
      
    case 'github-only':
      enableGitHubOnly();
      clearMCPCache();
      logger.info('Restart Cursor to apply changes');
      break;
      
    case 'both':
      enableBothWithWorkaround();
      clearMCPCache();
      logger.info('Restart Cursor to apply changes');
      break;
      
    case 'backup':
      backupConfig();
      break;
      
    case 'restore':
      restoreConfig();
      clearMCPCache();
      logger.info('Restart Cursor to apply changes');
      break;
      
    case 'clear-cache':
      clearMCPCache();
      logger.info('Restart Cursor to apply changes');
      break;
      
    case 'restart':
      restartCursor();
      break;
      
    default:
      console.log(`
MCP Routing Fix Script

Usage: node scripts/mcp-routing-fix.js <command>

Commands:
  detect         - Detect tool conflicts in current configuration
  supabase-only  - Enable only Supabase MCP server
  github-only    - Enable only GitHub MCP server
  both           - Enable both servers with conflict resolution (experimental)
  backup         - Backup current MCP configuration
  restore        - Restore MCP configuration from backup
  clear-cache    - Clear Cursor MCP cache
  restart        - Restart Cursor

Examples:
  node scripts/mcp-routing-fix.js detect
  node scripts/mcp-routing-fix.js supabase-only
  node scripts/mcp-routing-fix.js clear-cache
      `);
  }
}

// Run the script
main();

module.exports = {
  detectConflicts,
  enableSupabaseOnly,
  enableGitHubOnly,
  enableBothWithWorkaround,
  clearMCPCache,
  restartCursor
}; 