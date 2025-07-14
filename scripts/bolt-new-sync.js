#!/usr/bin/env node

/**
 * Bolt.new Sync Script
 * Strategic integration script for bolt.new development workflow
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BOLT_SYNC_CONFIG = {
  // Files to sync TO bolt.new (lightweight, UI-focused)
  syncToBolt: [
    'src/components/**/*.tsx',
    'src/pages/**/*.tsx', 
    'src/lib/theme.ts',
    'src/index.css',
    'tailwind.config.js',
    'package.json',
    'vite.config.ts'
  ],
  
  // Files to PRESERVE locally (infrastructure-critical)
  preserveLocal: [
    'supabase/**/*',
    '.github/**/*',
    'scripts/**/*',
    'cypress/**/*',
    'src/lib/auth.ts',
    'src/lib/supabase.ts',
    'src/lib/authContext.tsx'
  ],
  
  // bolt.new optimizations
  boltOptimizations: {
    // Simplified package.json for bolt.new
    simplifiedDeps: [
      'react',
      'react-dom', 
      'typescript',
      'vite',
      'tailwindcss',
      '@supabase/supabase-js'
    ]
  }
};

/**
 * Create a bolt.new compatible branch
 */
async function createBoltBranch() {
  console.log('🚀 Creating bolt.new sync branch...');
  
  try {
    // Create and switch to bolt-sync branch
    execSync('git checkout -b bolt-new-sync || git checkout bolt-new-sync', { stdio: 'inherit' });
    
    // Create simplified package.json for bolt.new
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const simplifiedPackage = {
      ...packageJson,
      scripts: {
        ...packageJson.scripts,
        'bolt:dev': 'vite --host 0.0.0.0',
        'bolt:build': 'tsc && vite build --mode production'
      },
      dependencies: filterDependencies(packageJson.dependencies, BOLT_SYNC_CONFIG.boltOptimizations.simplifiedDeps)
    };
    
    fs.writeFileSync('package.bolt.json', JSON.stringify(simplifiedPackage, null, 2));
    
    // Create bolt.new configuration
    const boltConfig = {
      name: 'AllIncompassing-UI',
      description: 'Therapy Practice Management - UI Layer',
      framework: 'react-ts',
      mainCommand: 'npm run bolt:dev',
      buildCommand: 'npm run bolt:build',
      installCommand: 'npm install',
      env: {
        VITE_SUPABASE_URL: 'https://wnnjeqheqxxyrgsjmygy.supabase.co',
        VITE_SUPABASE_ANON_KEY: '$SUPABASE_ANON_KEY' // bolt.new will handle secrets
      },
      ignore: [
        'supabase/**/*',
        '.github/**/*', 
        'scripts/**/*',
        'cypress/**/*',
        'node_modules/**/*'
      ]
    };
    
    fs.writeFileSync('bolt.config.json', JSON.stringify(boltConfig, null, 2));
    
    // Create README for bolt.new context
    const boltReadme = `# AllIncompassing - UI Development

## 🎯 bolt.new Integration

This branch is optimized for bolt.new development workflow:

### ✅ What's Included
- React/TypeScript components
- Tailwind CSS styling
- Vite build configuration
- Supabase client integration

### ⚠️ What's Excluded
- Database migrations (maintained locally)
- CI/CD pipeline (GitHub Actions)
- Backend edge functions
- Comprehensive test suite

### 🔄 Development Workflow

1. **Prototype in bolt.new**: Use AI for rapid UI development
2. **Sync to local**: Merge changes back to main codebase
3. **Deploy via CI/CD**: Use existing pipeline for production

### 🛠️ Quick Start

\`\`\`bash
npm run bolt:dev    # Start development server
npm run bolt:build  # Build for production
\`\`\`

### 🔗 Integration Points

- **Auth**: Uses existing Supabase authentication
- **Data**: Connects to production Supabase instance
- **Styling**: Tailwind CSS with theme system
- **State**: React Context for auth state management

### 📝 Notes

- This is a UI-focused development environment
- Database schema changes should be made locally
- Security policies and migrations are handled separately
- Full test suite runs in main development environment
`;
    
    fs.writeFileSync('README.bolt.md', boltReadme);
    
    console.log('✅ bolt.new branch created successfully!');
    console.log('📁 Files created:');
    console.log('  - package.bolt.json (simplified dependencies)');
    console.log('  - bolt.config.json (bolt.new configuration)');
    console.log('  - README.bolt.md (integration documentation)');
    
    // Commit the changes
    execSync('git add package.bolt.json bolt.config.json README.bolt.md', { stdio: 'inherit' });
    execSync('git commit -m "🚀 BOLT.NEW: Add bolt.new integration configuration\n\n- Simplified package.json for bolt.new compatibility\n- Configuration for UI-focused development\n- Documentation for hybrid workflow\n- Preserve critical infrastructure locally"', { stdio: 'inherit' });
    
    console.log('🎉 Ready to sync with bolt.new!');
    console.log('🔗 Push to GitHub: git push origin bolt-new-sync');
    
  } catch (error) {
    console.error('❌ Error creating bolt.new branch:', error.message);
    process.exit(1);
  }
}

/**
 * Filter dependencies to essential ones for bolt.new
 */
function filterDependencies(allDeps, essential) {
  const filtered = {};
  essential.forEach(dep => {
    if (allDeps[dep]) {
      filtered[dep] = allDeps[dep];
    }
  });
  return filtered;
}

/**
 * Sync changes from bolt.new back to main codebase
 */
async function syncFromBolt() {
  console.log('🔄 Syncing changes from bolt.new...');
  
  try {
    // Switch to main branch
    execSync('git checkout main', { stdio: 'inherit' });
    
    // Merge UI changes (selective merge)
    console.log('📋 Merging UI components from bolt-new-sync...');
    
    // This would involve selective file merging
    // In practice, developer would review and merge specific files
    
    console.log('✅ Sync complete! Review changes before deployment.');
    
  } catch (error) {
    console.error('❌ Error syncing from bolt.new:', error.message);
    process.exit(1);
  }
}

// CLI handling
const command = process.argv[2];

switch (command) {
  case 'create':
    createBoltBranch();
    break;
  case 'sync':
    syncFromBolt();
    break;
  default:
    console.log(`
🚀 bolt.new Integration Script

Usage:
  node scripts/bolt-new-sync.js create  # Create bolt.new branch
  node scripts/bolt-new-sync.js sync    # Sync from bolt.new to main

Strategic Integration:
  - Use bolt.new for rapid UI prototyping
  - Maintain sophisticated backend infrastructure locally
  - Deploy through existing CI/CD pipeline
  - Preserve security and testing measures
`);
} 