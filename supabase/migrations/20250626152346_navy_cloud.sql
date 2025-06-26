-- Seed file for creating test users and initial data
-- This file is automatically run when using `supabase db reset`

-- First, ensure we have the basic roles
INSERT INTO roles (name, description) VALUES
  ('admin', 'Administrator with full access'),
  ('therapist', 'Therapist with client management access'),
  ('user', 'Basic user access')
ON CONFLICT (name) DO NOTHING;

-- Create test users section
DO $$
DECLARE
  test_user_id uuid;
  admin_user_id uuid;
  admin_role_id uuid;
  user_role_id uuid;
BEGIN
  -- Get role IDs
  SELECT id INTO admin_role_id FROM roles WHERE name = 'admin';
  SELECT id INTO user_role_id FROM roles WHERE name = 'user';

  -- Log user creation attempt
  RAISE NOTICE 'Attempting to create test users (might fail if auth schema is restricted)';
  
  BEGIN
    -- Create test@example.com user
    -- Note: We'll use a deterministic UUID for consistency
    test_user_id := '00000000-0000-0000-0000-000000000001';
    
    -- Insert into auth.users (this requires elevated privileges)
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      recovery_sent_at,
      last_sign_in_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      test_user_id,
      'authenticated',
      'authenticated',
      'test@example.com',
      crypt('test123', gen_salt('bf')),
      NOW(),
      NOW(),
      NOW(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      NOW(),
      NOW(),
      '',
      '',
      '',
      ''
    ) ON CONFLICT (id) DO NOTHING;

    -- Create admin user j_eduardo622@yahoo.com
    admin_user_id := '00000000-0000-0000-0000-000000000002';
    
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      recovery_sent_at,
      last_sign_in_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      admin_user_id,
      'authenticated',
      'authenticated',
      'j_eduardo622@yahoo.com',
      crypt('admin123', gen_salt('bf')),
      NOW(),
      NOW(),
      NOW(),
      '{"provider":"email","providers":["email"]}',
      '{"is_admin":true}',
      NOW(),
      NOW(),
      '',
      '',
      '',
      ''
    ) ON CONFLICT (id) DO NOTHING;

    -- Insert into auth.identities for both users
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES 
      (
        test_user_id,
        test_user_id,
        format('{"sub":"%s","email":"%s"}', test_user_id, 'test@example.com')::jsonb,
        'email',
        NOW(),
        NOW(),
        NOW()
      ),
      (
        admin_user_id,
        admin_user_id,
        format('{"sub":"%s","email":"%s"}', admin_user_id, 'j_eduardo622@yahoo.com')::jsonb,
        'email',
        NOW(),
        NOW(),
        NOW()
      )
    ON CONFLICT (id) DO NOTHING;

    -- Assign roles to users
    INSERT INTO user_roles (user_id, role_id) VALUES
      (test_user_id, user_role_id),
      (admin_user_id, admin_role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;

    RAISE NOTICE 'Created test users successfully';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'Error creating users: %', SQLERRM;
      RAISE NOTICE 'This is normal if auth schema access is restricted';
      RAISE NOTICE 'Please create test users manually through Supabase dashboard or signup process';
  END;
END $$;

-- Create some sample data for testing

-- Insert company settings
INSERT INTO company_settings (
  company_name,
  legal_name,
  phone,
  email,
  address_line1,
  city,
  state,
  zip_code
) VALUES (
  'AllIncompassing Therapy Services',
  'AllIncompassing Therapy Services LLC',
  '(555) 123-4567',
  'contact@allincompassing.com',
  '123 Main Street',
  'Anytown',
  'CA',
  '12345'
) ON CONFLICT DO NOTHING;

-- Insert sample locations
INSERT INTO locations (name, type, address_line1, city, state, zip_code, phone) VALUES
  ('Main Office', 'clinic', '123 Main Street', 'Anytown', 'CA', '12345', '(555) 123-4567'),
  ('Satellite Office', 'clinic', '456 Oak Avenue', 'Other City', 'CA', '67890', '(555) 987-6543')
ON CONFLICT DO NOTHING;

-- Insert sample service lines
INSERT INTO service_lines (name, code, description, rate_per_hour, billable) VALUES
  ('ABA Therapy', 'ABA', 'Applied Behavior Analysis therapy services', 150.00, true),
  ('Speech Therapy', 'SPEECH', 'Speech and language therapy services', 120.00, true),
  ('Occupational Therapy', 'OT', 'Occupational therapy services', 130.00, true),
  ('Consultation', 'CONSULT', 'Professional consultation services', 200.00, true)
ON CONFLICT DO NOTHING;

-- Insert sample insurance providers
INSERT INTO insurance_providers (name, type, contact_phone) VALUES
  ('Blue Cross Blue Shield', 'private', '(800) 555-0001'),
  ('Aetna', 'private', '(800) 555-0002'),
  ('Medicaid', 'government', '(800) 555-0003'),
  ('Kaiser Permanente', 'private', '(800) 555-0004')
ON CONFLICT DO NOTHING;

-- Insert file cabinet categories
INSERT INTO file_cabinet_settings (category_name, description) VALUES
  ('Assessment Reports', 'Initial and ongoing assessment documentation'),
  ('Treatment Plans', 'Individualized treatment planning documents'),
  ('Progress Notes', 'Session notes and progress documentation'),
  ('Insurance Documentation', 'Authorization and billing related documents'),
  ('Legal Documents', 'Consent forms and legal documentation')
ON CONFLICT DO NOTHING;

-- Information about test accounts (placed in a comment since RAISE NOTICE can't be used outside of blocks)
-- 
-- Test Accounts:
-- 1. Regular User: test@example.com / test123
-- 2. Admin User: j_eduardo622@yahoo.com / admin123
--
-- If user creation failed due to auth schema restrictions,
-- please create these users manually through:
-- 1. Supabase Dashboard > Authentication > Users
-- 2. Or use the signup form in the application