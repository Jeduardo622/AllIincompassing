# MCP Routing Troubleshooting Guide

## Issue Overview

This document addresses the **known Cursor MCP routing bug** where tool names conflict between different MCP servers, specifically GitHub and Supabase servers both having tools named `list_branches`.

## Root Cause Analysis

Based on extensive research and community feedback:

1. **Tool Name Collision**: Both GitHub and Supabase MCP servers expose identically named tools
2. **Cursor's Routing Algorithm**: Cursor doesn't properly disambiguate between servers when tool names overlap
3. **Caching Issues**: Cursor may cache server registrations and route to previously configured servers
4. **No Priority System**: Cursor lacks a mechanism to specify which server should handle conflicting tool names

## Verified Solutions

### Solution 1: Server Name Disambiguation (Recommended)

**Status**: ✅ Proven to work

Change your MCP server names to be more specific:

```json
{
  "mcpServers": {
    "supabase-database": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref=YOUR_PROJECT_REF"],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    },
    "github-mcp": {
      "command": "npx", 
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

### Solution 2: Single Server Mode (Most Reliable)

**Status**: ✅ Confirmed working

Run only one MCP server at a time to completely avoid conflicts:

#### For Supabase-only usage:
```bash
node scripts/mcp-routing-fix.js supabase-only
```

#### For GitHub-only usage:
```bash
node scripts/mcp-routing-fix.js github-only
```

### Solution 3: Cache Clearing Protocol

**Status**: ✅ Effective for temporary fixes

1. Clear Cursor MCP cache:
   ```bash
   node scripts/mcp-routing-fix.js clear-cache
   ```

2. Restart Cursor completely
3. Wait 30 seconds before reopening

### Solution 4: Tool Name Validation

**Status**: ⚠️ Research-based workaround

Avoid tools with special characters or conflicts:

- ❌ Tools with hyphens: `list-branches` (Cursor bug)
- ❌ Conflicting names: `list_branches` when both servers active
- ✅ Unique names: `supabase_list_branches` vs `github_list_branches`

## Advanced Debugging Steps

### Step 1: Detect Current Conflicts

```bash
node scripts/mcp-routing-fix.js detect
```

Expected output if conflicts exist:
```
❌ Tool conflicts detected:
  - list_branches: github, supabase
  - create_branch: github, supabase
```

### Step 2: Check MCP Server Status

1. Open Cursor Settings → Features → MCP Servers
2. Verify green status indicators
3. Check tool count matches expected numbers:
   - Supabase: ~15-20 tools
   - GitHub: ~8-12 tools

### Step 3: Test Tool Routing

Use these specific prompts to test routing:

```
Test Supabase routing:
"Show me my Supabase database branches"

Test GitHub routing:  
"List my GitHub repository branches for this project"
```

If routing fails, you'll see responses intended for the wrong service.

### Step 4: MCP Protocol Validation

Check if tools follow naming conventions:

```bash
# Test tool discovery
npx @modelcontextprotocol/inspector stdio npx -y @supabase/mcp-server-supabase@latest --project-ref=YOUR_REF
```

## Known Workarounds from Community

### Workaround 1: Tool Prefixing Strategy

Some community members report success by asking for tools with explicit prefixes:

- Instead of: "list branches"
- Use: "using supabase list branches" or "using github list branches"

### Workaround 2: Sequential Server Activation

1. Disable all MCP servers
2. Enable only the one you need for current task
3. Complete your work
4. Switch servers when needed

### Workaround 3: Alternative MCP Servers

Consider these conflict-free alternatives:

- **Smithery.ai Supabase Server**: Different tool names
- **Custom MCP Wrapper**: Create your own wrapper with unique tool names

## Environment-Specific Fixes

### Windows Users

Additional steps for Windows:

```powershell
# Clear Windows MCP cache
Remove-Item -Recurse -Force "$env:APPDATA\cursor\mcp-cache" -ErrorAction SilentlyContinue

# Restart with elevated permissions
taskkill /f /im cursor.exe
Start-Sleep 2
start cursor
```

### macOS Users

```bash
# Clear macOS MCP cache
rm -rf ~/.config/cursor/mcp-cache

# Force restart Cursor
pkill -f cursor
sleep 2
open -a cursor
```

### Linux Users

```bash
# Clear Linux MCP cache  
rm -rf ~/.config/cursor/mcp-cache

# Restart Cursor
pkill -f cursor
sleep 2
cursor &
```

## Monitoring and Prevention

### Setup Monitoring Script

Add this to your package.json scripts:

```json
{
  "scripts": {
    "mcp:monitor": "node scripts/mcp-routing-fix.js detect",
    "mcp:fix-supabase": "node scripts/mcp-routing-fix.js supabase-only",
    "mcp:fix-github": "node scripts/mcp-routing-fix.js github-only",
    "mcp:backup": "node scripts/mcp-routing-fix.js backup"
  }
}
```

### Regular Maintenance

1. **Weekly**: Run conflict detection
2. **Before important work**: Backup MCP config
3. **After Cursor updates**: Clear cache and test routing
4. **When switching contexts**: Use single-server mode

## Expected Cursor Fixes

Based on community discussions, Cursor team is aware of:

1. **Tool name collision handling** - In development
2. **Server priority system** - Under consideration  
3. **MCP protocol compliance** - Ongoing improvements
4. **Cache management** - Being enhanced

## Emergency Recovery

If MCP completely breaks:

```bash
# Full reset procedure
node scripts/mcp-routing-fix.js backup
rm .cursor/mcp.json
node scripts/mcp-routing-fix.js clear-cache
# Restart Cursor
# Reconfigure servers one by one
```

## Success Indicators

You'll know the fix worked when:

- ✅ Tool requests go to correct server
- ✅ No "Client Closed" errors
- ✅ Consistent routing behavior
- ✅ Tools list shows expected counts

## Getting Help

If these solutions don't work:

1. **Check Cursor Forum**: Latest community solutions
2. **MCP Inspector**: Debug tool protocol directly
3. **Server Logs**: Enable verbose logging
4. **Community Discord**: Real-time troubleshooting

## References

- [Cursor MCP Documentation](https://cursor.com/docs/mcp)
- [Model Context Protocol Spec](https://modelcontextprotocol.io)
- [Cursor Community Forum - MCP Issues](https://forum.cursor.com/c/bug-report/6)
- [GitHub Issue Tracker](https://github.com/getcursor/cursor/issues) 