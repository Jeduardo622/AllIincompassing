/*
  # Create test user if not exists
  
  Creates a test user account for development purposes if it doesn't already exist.
  
  1. Changes
    - Adds a test user (test@example.com) if not already present
    - Adds corresponding identity for email authentication
  
  2. Security
    - Uses secure password hashing
    - Sets up proper authentication metadata
*/

DO $$
BEGIN
  -- Only insert the user if they don't already exist
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE email = 'test@example.com'
  ) THEN
    -- Insert the user
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      role,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change_token_current,
      aud,
      is_super_admin,
      is_sso_user
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000',
      'test@example.com',
      crypt('test123', gen_salt('bf')),
      now(),
      'authenticated',
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(),
      now(),
      '',
      '',
      '',
      '',
      'authenticated',
      false,
      false
    );

    -- Insert the corresponding identity
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000',
      '{"sub":"00000000-0000-0000-0000-000000000000","email":"test@example.com"}',
      'email',
      '00000000-0000-0000-0000-000000000000',
      now(),
      now(),
      now()
    );
  END IF;
END $$;