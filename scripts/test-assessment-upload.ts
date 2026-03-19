#!/usr/bin/env tsx
/**
 * Test script to upload an assessment document and trigger AI extraction.
 * 
 * Usage:
 *   npx tsx scripts/test-assessment-upload.ts <client-id> <file-path> [template-type]
 * 
 * Example:
 *   npx tsx scripts/test-assessment-upload.ts d33c28d7-6edd-4c0c-bff1-a73c4275c031 "./7.21.2025_RoVa_CalOptima_FBA_FINAL (1).Redacted.docx.pdf" caloptima_fba
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { basename } from 'path';

const resolveRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
};

const resolveSupabaseUrl = (): string => process.env.VITE_SUPABASE_URL || resolveRequiredEnv('SUPABASE_URL');
const resolveSupabaseAnonKey = (): string =>
  process.env.VITE_SUPABASE_ANON_KEY || resolveRequiredEnv('SUPABASE_ANON_KEY');

type AssessmentTemplateType = 'caloptima_fba' | 'iehp_fba';

async function main() {
  const [clientId, filePath, templateType = 'caloptima_fba'] = process.argv.slice(2);

  if (!clientId || !filePath) {
    console.error('Usage: npx tsx scripts/test-assessment-upload.ts <client-id> <file-path> [template-type]');
    console.error(
      'Required env vars: TEST_USER_EMAIL, TEST_USER_PASSWORD and either VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY or SUPABASE_URL/SUPABASE_ANON_KEY.',
    );
    process.exit(1);
  }

  const testUserEmail = resolveRequiredEnv('TEST_USER_EMAIL');
  const testUserPassword = resolveRequiredEnv('TEST_USER_PASSWORD');
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseAnonKey = resolveSupabaseAnonKey();

  console.log('=== Assessment Upload Test ===');
  console.log(`Client ID: ${clientId}`);
  console.log(`File: ${filePath}`);
  console.log(`Template: ${templateType}`);
  console.log();

  // Create Supabase client
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // Sign in
  console.log(`[1/5] Signing in as ${testUserEmail}...`);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: testUserEmail,
    password: testUserPassword,
  });

  if (authError || !authData.session) {
    console.error('❌ Authentication failed:', authError?.message);
    process.exit(1);
  }

  console.log('✓ Signed in successfully');
  console.log(`  User ID: ${authData.user.id}`);
  console.log(`  Access Token: ${authData.session.access_token.substring(0, 20)}...`);
  console.log();

  // Read file
  console.log('[2/5] Reading file...');
  let fileBuffer: Buffer;
  let fileName: string;
  try {
    fileBuffer = readFileSync(filePath);
    fileName = basename(filePath);
    console.log('✓ File read successfully');
    console.log(`  File name: ${fileName}`);
    console.log(`  File size: ${fileBuffer.length} bytes`);
  } catch (error) {
    console.error('❌ Failed to read file:', error);
    process.exit(1);
  }
  console.log();

  // Upload to storage
  console.log('[3/5] Uploading file to Supabase Storage...');
  const objectPath = `clients/${clientId}/assessments/${Date.now()}-${fileName.replace(/\s+/g, '-')}`;
  const { error: uploadError } = await supabase.storage
    .from('client-documents')
    .upload(objectPath, fileBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (uploadError) {
    console.error('❌ File upload failed:', uploadError.message);
    process.exit(1);
  }

  console.log('✓ File uploaded to storage');
  console.log(`  Bucket: client-documents`);
  console.log(`  Path: ${objectPath}`);
  console.log();

  // Register assessment document
  console.log('[4/5] Registering assessment document...');
  const apiBaseUrl = 'https://app.allincompassing.ai';
  const response = await fetch(`${apiBaseUrl}/api/assessment-documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authData.session.access_token}`,
    },
    body: JSON.stringify({
      client_id: clientId,
      file_name: fileName,
      mime_type: 'application/pdf',
      file_size: fileBuffer.length,
      bucket_id: 'client-documents',
      object_path: objectPath,
      template_type: templateType as AssessmentTemplateType,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Failed to register assessment document');
    console.error(`  Status: ${response.status}`);
    console.error(`  Response: ${errorText}`);
    process.exit(1);
  }

  const createdDoc = await response.json();
  console.log('✓ Assessment document registered');
  console.log(`  Document ID: ${createdDoc.id}`);
  console.log(`  Status: ${createdDoc.status}`);
  console.log();

  // Check extraction status
  console.log('[5/5] Checking extraction status...');
  console.log('Waiting for extraction to complete (checking every 2 seconds)...');
  
  let attempts = 0;
  const maxAttempts = 30; // 60 seconds max

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    attempts++;

    const statusResponse = await fetch(
      `${apiBaseUrl}/api/assessment-documents?assessment_document_id=${createdDoc.id}`,
      {
        headers: {
          'Authorization': `Bearer ${authData.session.access_token}`,
        },
      }
    );

    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      console.log(`  [${attempts}] Status: ${statusData.status}`);

      if (statusData.status === 'extracted' || statusData.status === 'drafted') {
        console.log('✓ Extraction completed successfully');
        console.log(`  Final status: ${statusData.status}`);
        
        // Check for draft programs and goals
        const draftsResponse = await fetch(
          `${apiBaseUrl}/api/assessment-drafts?assessment_document_id=${createdDoc.id}`,
          {
            headers: {
              'Authorization': `Bearer ${authData.session.access_token}`,
            },
          }
        );

        if (draftsResponse.ok) {
          const drafts = await draftsResponse.json();
          console.log(`  Draft programs: ${drafts.programs?.length ?? 0}`);
          console.log(`  Draft goals: ${drafts.goals?.length ?? 0}`);
        }
        
        process.exit(0);
      } else if (statusData.status === 'failed') {
        console.error('❌ Extraction failed');
        console.error(`  Error: ${statusData.extraction_error || 'Unknown error'}`);
        process.exit(1);
      }
    }
  }

  console.warn('⚠ Extraction did not complete within 60 seconds');
  console.log('You may need to check the status manually in the UI');
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
