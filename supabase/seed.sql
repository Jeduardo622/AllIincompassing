--
-- Development seed data for the AllIncompassing preview/CI environments.
-- These statements populate deterministic, non-sensitive fixtures that exercise
-- core scheduling flows without relying on manual dashboard setup.
--
-- The file is executed automatically by `supabase db reset` because
-- `supabase/config.toml` references it from `[db.seed].sql_paths`.
--

BEGIN;

-- ---------------------------------------------------------------------------
-- Ensure required roles exist with consistent permissions.
-- ---------------------------------------------------------------------------
INSERT INTO public.roles (name, description)
VALUES
  (
    'super_admin',
    'Super administrator with full access across organizations.'
  ),
  (
    'admin',
    'Administrator with elevated access to manage teams and settings.'
  ),
  (
    'therapist',
    'Therapist managing assigned caseload and schedule.'
  ),
  (
    'client',
    'Client accessing personal schedule and documentation.'
  ),
  (
    'receptionist',
    'Front desk staff coordinating schedules.'
  ),
  (
    'monitoring',
    'Read-only observability integration account.'
  )
ON CONFLICT (name) DO UPDATE
SET
  description = EXCLUDED.description;

-- ---------------------------------------------------------------------------
-- Create deterministic development accounts and related domain records.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  user_record RECORD;
  role_id UUID;
  user_id UUID;
  metadata JSONB;
BEGIN
  FOR user_record IN
    SELECT *
    FROM (
      VALUES
        ('client@test.com', 'password123', 'client', 'Casey', 'Client', '555-0100', false),
        ('therapist@test.com', 'password123', 'therapist', 'Taylor', 'Therapist', '555-0101', false),
        ('admin@test.com', 'password123', 'admin', 'Alex', 'Admin', '555-0102', false),
        ('superadmin@test.com', 'password123', 'super_admin', 'Sydney', 'Superadmin', '555-0103', true)
    ) AS seeds(email, raw_password, role_name, first_name, last_name, phone, is_super_admin)
  LOOP
    metadata := jsonb_build_object(
      'first_name', user_record.first_name,
      'last_name', user_record.last_name,
      'full_name', user_record.first_name || ' ' || user_record.last_name,
      'phone', user_record.phone,
      'role', user_record.role_name,
      'default_role', user_record.role_name
    );

    SELECT id INTO user_id
    FROM auth.users
    WHERE email = user_record.email;

    IF user_id IS NULL THEN
      user_id := gen_random_uuid();

      INSERT INTO auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        recovery_token,
        email_change_token_new,
        email_change_token_current,
        is_super_admin,
        is_sso_user
      ) VALUES (
        user_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        user_record.email,
        crypt(user_record.raw_password, gen_salt('bf')),
        NOW(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        metadata,
        NOW(),
        NOW(),
        '',
        '',
        '',
        '',
        user_record.is_super_admin,
        false
      );
    ELSE
      UPDATE auth.users
      SET
        encrypted_password = crypt(user_record.raw_password, gen_salt('bf')),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || metadata,
        is_super_admin = user_record.is_super_admin,
        updated_at = NOW(),
        email_confirmed_at = COALESCE(email_confirmed_at, NOW())
      WHERE id = user_id;
    END IF;

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
      user_id,
      user_id,
      jsonb_build_object('sub', user_id::text, 'email', user_record.email),
      'email',
      user_record.email,
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO UPDATE
    SET
      identity_data = EXCLUDED.identity_data,
      updated_at = NOW();

    SELECT id INTO role_id
    FROM public.roles
    WHERE name = user_record.role_name;

    IF role_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role_id)
      VALUES (user_id, role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
    END IF;

    INSERT INTO public.profiles (
      id,
      email,
      role,
      first_name,
      last_name,
      full_name,
      phone,
      is_active,
      created_at,
      updated_at
    ) VALUES (
      user_id,
      user_record.email,
      user_record.role_name::public.role_type,
      user_record.first_name,
      user_record.last_name,
      user_record.first_name || ' ' || user_record.last_name,
      user_record.phone,
      true,
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO UPDATE
    SET
      email = EXCLUDED.email,
      role = EXCLUDED.role,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone,
      is_active = true,
      updated_at = NOW();

    IF user_record.role_name = 'therapist' THEN
      INSERT INTO public.therapists (
        id,
        email,
        full_name,
        first_name,
        last_name,
        phone,
        status,
        availability_hours,
        specialties,
        service_type,
        preferred_areas,
        max_clients,
        avoid_rush_hour,
        max_daily_travel_minutes,
        service_radius_km,
        weekly_hours_min,
        weekly_hours_max,
        latitude,
        longitude,
        employee_type,
        facility,
        street,
        city,
        state,
        zip_code,
        time_zone,
        title,
        supervisor,
        npi_number,
        medicaid_id,
        bcba_number,
        rbt_number,
        practitioner_id,
        created_at
      ) VALUES (
        user_id,
        user_record.email,
        user_record.first_name || ' ' || user_record.last_name,
        user_record.first_name,
        user_record.last_name,
        user_record.phone,
        'active',
        jsonb_build_object(
          'monday', jsonb_build_object('start', '09:00', 'end', '17:00'),
          'tuesday', jsonb_build_object('start', '09:00', 'end', '17:00'),
          'wednesday', jsonb_build_object('start', '09:00', 'end', '17:00'),
          'thursday', jsonb_build_object('start', '09:00', 'end', '17:00'),
          'friday', jsonb_build_object('start', '09:00', 'end', '15:00')
        ),
        ARRAY['ABA', 'Speech Therapy'],
        ARRAY['aba', 'speech'],
        ARRAY['San Francisco', 'Oakland'],
        12,
        true,
        90,
        40,
        20,
        35,
        37.7749,
        -122.4194,
        'full_time',
        'Main Clinic',
        '456 Mission St',
        'San Francisco',
        'CA',
        '94105',
        'America/Los_Angeles',
        'Lead Therapist',
        'Alex Admin',
        '1234567890',
        'MED-THER-001',
        'BCBA-001',
        'RBT-001',
        'PRAC-100',
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
      SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        phone = EXCLUDED.phone,
        status = 'active',
        availability_hours = EXCLUDED.availability_hours,
        specialties = EXCLUDED.specialties,
        service_type = EXCLUDED.service_type,
        preferred_areas = EXCLUDED.preferred_areas,
        max_clients = EXCLUDED.max_clients,
        avoid_rush_hour = EXCLUDED.avoid_rush_hour,
        max_daily_travel_minutes = EXCLUDED.max_daily_travel_minutes,
        service_radius_km = EXCLUDED.service_radius_km,
        weekly_hours_min = EXCLUDED.weekly_hours_min,
        weekly_hours_max = EXCLUDED.weekly_hours_max,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        employee_type = EXCLUDED.employee_type,
        facility = EXCLUDED.facility,
        street = EXCLUDED.street,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip_code = EXCLUDED.zip_code,
        time_zone = EXCLUDED.time_zone,
        title = EXCLUDED.title,
        supervisor = EXCLUDED.supervisor,
        npi_number = EXCLUDED.npi_number,
        medicaid_id = EXCLUDED.medicaid_id,
        bcba_number = EXCLUDED.bcba_number,
        rbt_number = EXCLUDED.rbt_number,
        practitioner_id = EXCLUDED.practitioner_id;

      INSERT INTO public.user_therapist_links (user_id, therapist_id, created_at)
      VALUES (user_id, user_id, NOW())
      ON CONFLICT (user_id, therapist_id) DO NOTHING;
    ELSIF user_record.role_name = 'client' THEN
      INSERT INTO public.clients (
        id,
        email,
        full_name,
        first_name,
        last_name,
        status,
        phone,
        address_line1,
        city,
        state,
        zip_code,
        date_of_birth,
        gender,
        availability_hours,
        preferred_language,
        service_preference,
        preferred_session_time,
        preferred_radius_km,
        max_travel_minutes,
        in_home,
        in_clinic,
        in_school,
        parent1_first_name,
        parent1_last_name,
        parent1_email,
        parent1_phone,
        parent1_relationship,
        diagnosis,
        authorized_hours_per_month,
        hours_provided_per_month,
        unscheduled_hours,
        one_to_one_units,
        supervision_units,
        parent_consult_units,
        referral_source,
        insurance_info,
        client_id,
        notes,
        created_at
      ) VALUES (
        user_id,
        user_record.email,
        user_record.first_name || ' ' || user_record.last_name,
        user_record.first_name,
        user_record.last_name,
        'active',
        user_record.phone,
        '123 Market St',
        'San Francisco',
        'CA',
        '94103',
        '2015-04-12',
        'female',
        jsonb_build_object(
          'monday', jsonb_build_object('start', '09:00', 'end', '15:00'),
          'wednesday', jsonb_build_object('start', '10:00', 'end', '16:00'),
          'friday', jsonb_build_object('start', '09:00', 'end', '13:00')
        ),
        'English',
        ARRAY['in_home', 'telehealth'],
        ARRAY['morning', 'afternoon'],
        30,
        45,
        true,
        false,
        true,
        'Jamie',
        'Client',
        'jamie.client@example.com',
        '555-0199',
        'Parent',
        ARRAY['Autism Spectrum Disorder'],
        40,
        30,
        10,
        20,
        5,
        4,
        'Pediatrician Referral',
        '{"provider":"Blue Cross Blue Shield","policy_number":"BCBS-12345"}'::jsonb,
        'CLI-1001',
        'Seeded client for development previews.',
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
      SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        status = EXCLUDED.status,
        phone = EXCLUDED.phone,
        address_line1 = EXCLUDED.address_line1,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip_code = EXCLUDED.zip_code,
        date_of_birth = EXCLUDED.date_of_birth,
        gender = EXCLUDED.gender,
        availability_hours = EXCLUDED.availability_hours,
        preferred_language = EXCLUDED.preferred_language,
        service_preference = EXCLUDED.service_preference,
        preferred_session_time = EXCLUDED.preferred_session_time,
        preferred_radius_km = EXCLUDED.preferred_radius_km,
        max_travel_minutes = EXCLUDED.max_travel_minutes,
        in_home = EXCLUDED.in_home,
        in_clinic = EXCLUDED.in_clinic,
        in_school = EXCLUDED.in_school,
        parent1_first_name = EXCLUDED.parent1_first_name,
        parent1_last_name = EXCLUDED.parent1_last_name,
        parent1_email = EXCLUDED.parent1_email,
        parent1_phone = EXCLUDED.parent1_phone,
        parent1_relationship = EXCLUDED.parent1_relationship,
        diagnosis = EXCLUDED.diagnosis,
        authorized_hours_per_month = EXCLUDED.authorized_hours_per_month,
        hours_provided_per_month = EXCLUDED.hours_provided_per_month,
        unscheduled_hours = EXCLUDED.unscheduled_hours,
        one_to_one_units = EXCLUDED.one_to_one_units,
        supervision_units = EXCLUDED.supervision_units,
        parent_consult_units = EXCLUDED.parent_consult_units,
        referral_source = EXCLUDED.referral_source,
        insurance_info = EXCLUDED.insurance_info,
        client_id = EXCLUDED.client_id,
        notes = EXCLUDED.notes;
    END IF;
  END LOOP;

  -- Seed a representative session pairing the development client and therapist.
  INSERT INTO public.sessions (
    id,
    client_id,
    therapist_id,
    start_time,
    end_time,
    status,
    notes,
    has_transcription_consent,
    rate_per_hour,
    total_cost,
    session_type,
    duration_minutes,
    location_type,
    created_at
  )
  SELECT
    '00000000-0000-0000-0000-000000000101'::uuid,
    client_rec.id,
    therapist_rec.id,
    '2025-01-01T15:00:00Z',
    '2025-01-01T16:00:00Z',
    'scheduled',
    'Seeded preview session connecting therapist@test.com and client@test.com.',
    false,
    120,
    120,
    'aba',
    60,
    'in_home',
    NOW()
  FROM public.clients AS client_rec
  CROSS JOIN public.therapists AS therapist_rec
  WHERE client_rec.email = 'client@test.com'
    AND therapist_rec.email = 'therapist@test.com'
  ON CONFLICT (id) DO UPDATE
  SET
    client_id = EXCLUDED.client_id,
    therapist_id = EXCLUDED.therapist_id,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    status = EXCLUDED.status,
    notes = EXCLUDED.notes,
    has_transcription_consent = EXCLUDED.has_transcription_consent,
    rate_per_hour = EXCLUDED.rate_per_hour,
    total_cost = EXCLUDED.total_cost,
    session_type = EXCLUDED.session_type,
    duration_minutes = EXCLUDED.duration_minutes,
    location_type = EXCLUDED.location_type;
END $$;

COMMIT;
