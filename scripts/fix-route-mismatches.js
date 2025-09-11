#!/usr/bin/env node

/**
 * Fix Route Mismatches Script
 * 
 * This script automatically fixes common route mismatches by:
 * 1. Creating stub Supabase functions for missing backends
 * 2. Fixing typos in route paths
 * 3. Updating API endpoint URLs
 * 4. Creating missing RPC functions
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Missing functions that need to be created
const MISSING_FUNCTIONS = [
  'get_schedule_data_batch',
  'get_sessions_optimized', 
  'get_dropdown_data',
  'get_session_metrics',
  'get_dashboard_data',
  'get_ai_cache_metrics',
  'get_admin_users',
  'assign_admin_role',
  'reset_user_password',
  'manage_admin_users',
  'get_user_roles',
  'get_user_roles_comprehensive'
];

// Stub function template
const createStubFunction = (functionName, description) => `
-- Function: ${functionName}
-- Description: ${description}
-- Status: STUB - needs implementation

CREATE OR REPLACE FUNCTION ${functionName}(
  -- Add parameters as needed
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- TODO: Implement function logic
  RETURN JSON_BUILD_OBJECT(
    'success', true,
    'message', 'Function ${functionName} is not yet implemented',
    'data', NULL
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION ${functionName} TO authenticated;
`;

// Edge function template
const createEdgeFunctionTemplate = (functionName) => `
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { data, error } = await supabase
      .from('your_table')
      .select('*')
      .limit(1)

    if (error) {
      throw error
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Function ${functionName} is not yet implemented',
        data: null 
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        },
        status: 500
      }
    )
  }
})
`;

class RouteFixer {
  constructor() {
    this.fixes = [];
  }

  async createMissingRpcFunctions() {
    console.log('🔧 Creating missing RPC functions...');
    
    const migrationFile = `-- Migration: Add missing RPC functions
-- Generated: ${new Date().toISOString()}

${MISSING_FUNCTIONS.map(func => createStubFunction(func, `Auto-generated stub for ${func}`)).join('\n')}
`;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const migrationPath = `temp_migrations/route_fix_${timestamp}.sql`;
    
    await fs.writeFile(migrationPath, migrationFile);
    
    console.log(`✅ Created migration: ${migrationPath}`);
    this.fixes.push({
      type: 'rpc_functions',
      description: 'Created stub RPC functions',
      file: migrationPath,
      functions: MISSING_FUNCTIONS
    });
  }

  async createMissingEdgeFunctions() {
    console.log('🔧 Creating missing edge functions...');
    
    const edgeFunctions = [
      'get_schedule_data_batch',
      'get_sessions_optimized',
      'get_dropdown_data',
      'get_session_metrics',
      'get_dashboard_data'
    ];

    for (const functionName of edgeFunctions) {
      const functionDir = `supabase/functions/${functionName.replace(/_/g, '-')}`;
      const functionFile = `${functionDir}/index.ts`;
      
      try {
        await fs.access(functionFile);
        console.log(`✅ Function exists: ${functionName}`);
      } catch (error) {
        console.log(`🔧 Creating function: ${functionName}`);
        
        // Create directory
        await fs.mkdir(functionDir, { recursive: true });
        
        // Create function file
        await fs.writeFile(functionFile, createEdgeFunctionTemplate(functionName));
        
        this.fixes.push({
          type: 'edge_function',
          description: `Created stub edge function: ${functionName}`,
          file: functionFile
        });
      }
    }
  }

  async fixRoutePathTypos() {
    console.log('🔧 Checking for route path typos...');
    
    // Check App.tsx for common typos
    const appFile = 'src/App.tsx';
    const appContent = await fs.readFile(appFile, 'utf-8');
    
    const fixes = [
      // Common typos that might occur
      { from: '/therapist/', to: '/therapists/' },
      { from: '/client/', to: '/clients/' },
      { from: '/authorization/', to: '/authorizations/' },
    ];
    
    let hasChanges = false;
    let newContent = appContent;
    
    for (const fix of fixes) {
      if (newContent.includes(fix.from)) {
        newContent = newContent.replace(new RegExp(fix.from, 'g'), fix.to);
        hasChanges = true;
        
        this.fixes.push({
          type: 'route_typo',
          description: `Fixed route typo: ${fix.from} → ${fix.to}`,
          file: appFile
        });
      }
    }
    
    if (hasChanges) {
      await fs.writeFile(appFile, newContent);
      console.log('✅ Fixed route path typos');
    } else {
      console.log('✅ No route path typos found');
    }
  }

  async updateApiEndpoints() {
    console.log('🔧 Updating API endpoint URLs...');
    
    // Check common files for API endpoint issues
    const files = [
      'src/lib/supabase.ts',
      'src/lib/optimizedQueries.ts',
      'src/lib/authContext.tsx'
    ];
    
    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        let newContent = content;
        let hasChanges = false;
        
        // Fix common API endpoint issues
        const fixes = [
          { from: '/api/v1/', to: '/functions/v1/' },
          { from: '/rest/v1/', to: '/rest/v1/' }, // Ensure correct format
          { from: '.rpc(\'', to: '.rpc(\'' }, // Ensure consistent quote style
        ];
        
        for (const fix of fixes) {
          if (newContent.includes(fix.from) && fix.from !== fix.to) {
            newContent = newContent.replace(new RegExp(fix.from, 'g'), fix.to);
            hasChanges = true;
            
            this.fixes.push({
              type: 'api_endpoint',
              description: `Fixed API endpoint: ${fix.from} → ${fix.to}`,
              file: file
            });
          }
        }
        
        if (hasChanges) {
          await fs.writeFile(file, newContent);
          console.log(`✅ Updated API endpoints in ${file}`);
        }
      } catch (error) {
        console.log(`⚠️  Could not read ${file}: ${error.message}`);
      }
    }
  }

  async createMissingTestData() {
    console.log('🔧 Creating missing test data...');
    
    const testDataFile = 'cypress/fixtures/test-users.json';
    const testData = {
      client: {
        email: 'client@test.com',
        password: 'testpass123',
        role: 'client',
        profile: {
          first_name: 'Test',
          last_name: 'Client',
          phone: '555-0101'
        }
      },
      therapist: {
        email: 'therapist@test.com',
        password: 'testpass123',
        role: 'therapist',
        profile: {
          first_name: 'Test',
          last_name: 'Therapist',
          phone: '555-0102'
        }
      },
      admin: {
        email: 'admin@test.com',
        password: 'testpass123',
        role: 'admin',
        profile: {
          first_name: 'Test',
          last_name: 'Admin',
          phone: '555-0103'
        }
      },
      super_admin: {
        email: 'superadmin@test.com',
        password: 'testpass123',
        role: 'super_admin',
        profile: {
          first_name: 'Test',
          last_name: 'SuperAdmin',
          phone: '555-0104'
        }
      }
    };
    
    await fs.writeFile(testDataFile, JSON.stringify(testData, null, 2));
    
    this.fixes.push({
      type: 'test_data',
      description: 'Created test user data for all roles',
      file: testDataFile
    });
    
    console.log(`✅ Created test data: ${testDataFile}`);
  }

  async addErrorBoundaryDataTestIds() {
    console.log('🔧 Adding error boundary test IDs...');
    
    const errorBoundaryFile = 'src/components/ErrorBoundary.tsx';
    
    try {
      const content = await fs.readFile(errorBoundaryFile, 'utf-8');
      
      // Add data-testid if not present
      if (!content.includes('data-testid="error-boundary"')) {
        const newContent = content.replace(
          '<div className="error-boundary"',
          '<div className="error-boundary" data-testid="error-boundary"'
        );
        
        if (newContent !== content) {
          await fs.writeFile(errorBoundaryFile, newContent);
          
          this.fixes.push({
            type: 'test_ids',
            description: 'Added error boundary test ID',
            file: errorBoundaryFile
          });
          
          console.log('✅ Added error boundary test ID');
        }
      }
    } catch (error) {
      console.log(`⚠️  Could not update ErrorBoundary: ${error.message}`);
    }
  }

  async generateReport() {
    const timestamp = new Date().toISOString();
    const reportPath = `route-fix-report-${timestamp.replace(/[:.]/g, '-')}.json`;
    
    const report = {
      timestamp,
      summary: {
        totalFixes: this.fixes.length,
        fixTypes: {
          rpc_functions: this.fixes.filter(f => f.type === 'rpc_functions').length,
          edge_functions: this.fixes.filter(f => f.type === 'edge_function').length,
          route_typos: this.fixes.filter(f => f.type === 'route_typo').length,
          api_endpoints: this.fixes.filter(f => f.type === 'api_endpoint').length,
          test_data: this.fixes.filter(f => f.type === 'test_data').length,
          test_ids: this.fixes.filter(f => f.type === 'test_ids').length
        }
      },
      fixes: this.fixes,
      nextSteps: [
        'Run `supabase db push` to apply database migrations',
        'Deploy edge functions with `supabase functions deploy`',
        'Run route integrity tests with `npm run cypress:run`',
        'Review and implement stub functions with actual logic'
      ]
    };
    
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`📊 Report generated: ${reportPath}`);
    
    return report;
  }

  async run() {
    try {
      console.log('🚀 Starting route mismatch fixes...');
      
      // Create temp_migrations directory if it doesn't exist
      await fs.mkdir('temp_migrations', { recursive: true });
      
      // Run all fixes
      await this.createMissingRpcFunctions();
      await this.createMissingEdgeFunctions();
      await this.fixRoutePathTypos();
      await this.updateApiEndpoints();
      await this.createMissingTestData();
      await this.addErrorBoundaryDataTestIds();
      
      // Generate report
      const report = await this.generateReport();
      
      console.log('\n📊 Fix Summary:');
      console.log(`✅ Total fixes applied: ${report.summary.totalFixes}`);
      console.log(`🔧 RPC functions created: ${report.summary.fixTypes.rpc_functions}`);
      console.log(`🌐 Edge functions created: ${report.summary.fixTypes.edge_functions}`);
      console.log(`🔤 Route typos fixed: ${report.summary.fixTypes.route_typos}`);
      console.log(`🔗 API endpoints updated: ${report.summary.fixTypes.api_endpoints}`);
      
      console.log('\n📋 Next Steps:');
      report.nextSteps.forEach(step => console.log(`  • ${step}`));
      
      return report;
      
    } catch (error) {
      console.error('❌ Fix process failed:', error);
      throw error;
    }
  }
}

// Run fixes if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const fixer = new RouteFixer();
  fixer.run()
    .then(report => {
      console.log('\n🎉 Route fixes completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Route fixes failed:', error);
      process.exit(1);
    });
}

export default RouteFixer;