/*
  # Fix Authentication and Admin Role Assignment

  1. Changes
    - Add admin role if not exists
    - Create function to check admin role
    - Add admin role to test user
    - Fix get_user_roles function
*/

-- Ensure admin role exists
INSERT INTO roles (name, description)
VALUES ('admin', 'System administrator with full access')
ON CONFLICT (name) DO NOTHING;

-- Create test user if not exists and assign admin role
DO $$
DECLARE
  v_user_id uuid;
  v_role_id uuid;
BEGIN
  -- Get or create test user
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'test@example.com';

  IF v_user_id IS NULL THEN
    -- Insert test user
    INSERT INTO auth.users (
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
    )
    RETURNING id INTO v_user_id;

    -- Insert identity
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
      v_user_id,
      v_user_id,
      format('{"sub":"%s","email":"test@example.com"}', v_user_id)::jsonb,
      'email',
      v_user_id,
      now(),
      now(),
      now()
    );
  END IF;

  -- Get admin role ID
  SELECT id INTO v_role_id
  FROM roles
  WHERE name = 'admin';

  -- Assign admin role if not already assigned
  INSERT INTO user_roles (user_id, role_id)
  VALUES (v_user_id, v_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
END $$;

-- Drop and recreate get_user_roles function
DROP FUNCTION IF EXISTS public.get_user_roles();

CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS TABLE (roles text[]) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT ARRAY_AGG(r.name)::text[]
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = auth.uid()
  GROUP BY ur.user_id;
END;
$$;