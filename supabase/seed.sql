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
  v_role_id UUID;
  v_user_id UUID;
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

    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = user_record.email;

    IF v_user_id IS NULL THEN
      v_user_id := gen_random_uuid();

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
        v_user_id,
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
      WHERE id = v_user_id;
    END IF;

    INSERT INTO auth.identities (
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', user_record.email),
      'email',
      user_record.email,
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT (provider, provider_id) DO UPDATE
    SET
      user_id = EXCLUDED.user_id,
      identity_data = EXCLUDED.identity_data,
      last_sign_in_at = EXCLUDED.last_sign_in_at,
      updated_at = NOW();

    SELECT id INTO v_role_id
    FROM public.roles
    WHERE name = user_record.role_name;

    IF v_role_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role_id)
      VALUES (v_user_id, v_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
    END IF;

    INSERT INTO public.profiles (
      id,
      email,
      role,
      first_name,
      last_name,
      phone,
      is_active,
      created_at,
      updated_at
    ) VALUES (
      v_user_id,
      user_record.email,
      user_record.role_name::public.role_type,
      user_record.first_name,
      user_record.last_name,
      user_record.phone,
      true,
      NOW(),
      NOW()
    )
    -- On conflict, skip role/is_active: enforce_profile_authz_field_immutability blocks updates without super-admin.
    ON CONFLICT (id) DO UPDATE
    SET
      email = EXCLUDED.email,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      phone = EXCLUDED.phone,
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
        v_user_id,
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
      VALUES (v_user_id, v_user_id, NOW())
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
        one_to_one_units,
        supervision_units,
        parent_consult_units,
        assessment_units,
        referral_source,
        insurance_info,
        client_id,
        notes,
        created_at
      ) VALUES (
        v_user_id,
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
        20,
        5,
        6,
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
        one_to_one_units = EXCLUDED.one_to_one_units,
        supervision_units = EXCLUDED.supervision_units,
        parent_consult_units = EXCLUDED.parent_consult_units,
        assessment_units = EXCLUDED.assessment_units,
        referral_source = EXCLUDED.referral_source,
        insurance_info = EXCLUDED.insurance_info,
        client_id = EXCLUDED.client_id,
        notes = EXCLUDED.notes;
    END IF;
  END LOOP;

  -- Deterministic org/program/goal so sessions satisfy NOT NULL program_id/goal_id (see 20260204193000_programs_goals_bank.sql).
  INSERT INTO public.organizations (id, name, slug)
  VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Seed Preview Org',
    'seed-preview-org'
  )
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.therapists
  SET organization_id = '00000000-0000-0000-0000-000000000001'::uuid
  WHERE email = 'therapist@test.com';

  UPDATE public.clients
  SET organization_id = '00000000-0000-0000-0000-000000000001'::uuid
  WHERE email = 'client@test.com';

  INSERT INTO public.programs (id, organization_id, client_id, name, description, status, created_at, updated_at)
  SELECT
    '00000000-0000-0000-0000-000000000201'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    c.id,
    'Seed Program',
    'Preview seed program.',
    'active',
    NOW(),
    NOW()
  FROM public.clients c
  WHERE c.email = 'client@test.com'
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    client_id = EXCLUDED.client_id,
    updated_at = NOW();

  INSERT INTO public.goals (
    id,
    organization_id,
    client_id,
    program_id,
    title,
    description,
    original_text,
    status,
    created_at,
    updated_at
  )
  SELECT
    '00000000-0000-0000-0000-000000000202'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    c.id,
    '00000000-0000-0000-0000-000000000201'::uuid,
    'Seed Goal',
    'Preview goal for seeded session.',
    'seed',
    'active',
    NOW(),
    NOW()
  FROM public.clients c
  WHERE c.email = 'client@test.com'
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    client_id = EXCLUDED.client_id,
    program_id = EXCLUDED.program_id,
    updated_at = NOW();

  -- Seed a representative session pairing the development client and therapist.
  INSERT INTO public.sessions (
    id,
    organization_id,
    client_id,
    therapist_id,
    program_id,
    goal_id,
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
    '00000000-0000-0000-0000-000000000001'::uuid,
    client_rec.id,
    therapist_rec.id,
    '00000000-0000-0000-0000-000000000201'::uuid,
    '00000000-0000-0000-0000-000000000202'::uuid,
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
    organization_id = EXCLUDED.organization_id,
    client_id = EXCLUDED.client_id,
    therapist_id = EXCLUDED.therapist_id,
    program_id = EXCLUDED.program_id,
    goal_id = EXCLUDED.goal_id,
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

  -- Seed a month of linked completed sessions with trial data so the
  -- Client Details > Session Trends tab has graphable preview data.
  INSERT INTO public.authorizations (
    id,
    authorization_number,
    client_id,
    provider_id,
    diagnosis_code,
    diagnosis_description,
    start_date,
    end_date,
    status,
    organization_id,
    created_by
  )
  SELECT
    '00000000-0000-0000-0000-000000000203'::uuid,
    'SEED-AUTH-SESSION-TRENDS',
    client_rec.id,
    therapist_rec.id,
    'F84.0',
    'Autism spectrum disorder',
    CURRENT_DATE - INTERVAL '45 days',
    CURRENT_DATE + INTERVAL '45 days',
    'approved',
    '00000000-0000-0000-0000-000000000001'::uuid,
    therapist_rec.id
  FROM public.clients AS client_rec
  CROSS JOIN public.therapists AS therapist_rec
  WHERE client_rec.email = 'client@test.com'
    AND therapist_rec.email = 'therapist@test.com'
  ON CONFLICT (id) DO UPDATE
  SET
    authorization_number = EXCLUDED.authorization_number,
    client_id = EXCLUDED.client_id,
    provider_id = EXCLUDED.provider_id,
    diagnosis_code = EXCLUDED.diagnosis_code,
    diagnosis_description = EXCLUDED.diagnosis_description,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    status = EXCLUDED.status,
    organization_id = EXCLUDED.organization_id,
    created_by = EXCLUDED.created_by;

  INSERT INTO public.authorization_services (
    id,
    authorization_id,
    service_code,
    service_description,
    from_date,
    to_date,
    requested_units,
    approved_units,
    unit_type,
    decision_status,
    organization_id,
    created_by
  )
  SELECT
    '00000000-0000-0000-0000-000000000204'::uuid,
    '00000000-0000-0000-0000-000000000203'::uuid,
    '97153',
    'Adaptive behavior treatment by protocol',
    CURRENT_DATE - INTERVAL '45 days',
    CURRENT_DATE + INTERVAL '45 days',
    160,
    160,
    '15-minute units',
    'approved',
    '00000000-0000-0000-0000-000000000001'::uuid,
    therapist_rec.id
  FROM public.therapists AS therapist_rec
  WHERE therapist_rec.email = 'therapist@test.com'
  ON CONFLICT (id) DO UPDATE
  SET
    authorization_id = EXCLUDED.authorization_id,
    service_code = EXCLUDED.service_code,
    service_description = EXCLUDED.service_description,
    from_date = EXCLUDED.from_date,
    to_date = EXCLUDED.to_date,
    requested_units = EXCLUDED.requested_units,
    approved_units = EXCLUDED.approved_units,
    unit_type = EXCLUDED.unit_type,
    decision_status = EXCLUDED.decision_status,
    organization_id = EXCLUDED.organization_id,
    created_by = EXCLUDED.created_by;

  WITH trend_seed(idx, session_id, note_id, correct_trials) AS (
    VALUES
      (0, '00000000-0000-0000-0000-000000000301'::uuid, '00000000-0000-0000-0000-000000000401'::uuid, 5),
      (1, '00000000-0000-0000-0000-000000000302'::uuid, '00000000-0000-0000-0000-000000000402'::uuid, 6),
      (2, '00000000-0000-0000-0000-000000000303'::uuid, '00000000-0000-0000-0000-000000000403'::uuid, 7),
      (3, '00000000-0000-0000-0000-000000000304'::uuid, '00000000-0000-0000-0000-000000000404'::uuid, 7),
      (4, '00000000-0000-0000-0000-000000000305'::uuid, '00000000-0000-0000-0000-000000000405'::uuid, 8),
      (5, '00000000-0000-0000-0000-000000000306'::uuid, '00000000-0000-0000-0000-000000000406'::uuid, 8),
      (6, '00000000-0000-0000-0000-000000000307'::uuid, '00000000-0000-0000-0000-000000000407'::uuid, 9),
      (7, '00000000-0000-0000-0000-000000000308'::uuid, '00000000-0000-0000-0000-000000000408'::uuid, 9),
      (8, '00000000-0000-0000-0000-000000000309'::uuid, '00000000-0000-0000-0000-000000000409'::uuid, 10),
      (9, '00000000-0000-0000-0000-000000000310'::uuid, '00000000-0000-0000-0000-000000000410'::uuid, 10),
      (10, '00000000-0000-0000-0000-000000000311'::uuid, '00000000-0000-0000-0000-000000000411'::uuid, 11),
      (11, '00000000-0000-0000-0000-000000000312'::uuid, '00000000-0000-0000-0000-000000000412'::uuid, 11)
  ),
  trend_rows AS (
    SELECT
      trend_seed.*,
      (CURRENT_DATE - INTERVAL '27 days' + (trend_seed.idx * INTERVAL '2 days'))::date AS session_date
    FROM trend_seed
  )
  INSERT INTO public.sessions (
    id,
    organization_id,
    client_id,
    therapist_id,
    program_id,
    goal_id,
    session_date,
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
    trend_rows.session_id,
    '00000000-0000-0000-0000-000000000001'::uuid,
    client_rec.id,
    therapist_rec.id,
    '00000000-0000-0000-0000-000000000201'::uuid,
    '00000000-0000-0000-0000-000000000202'::uuid,
    trend_rows.session_date,
    ((trend_rows.session_date + TIME '15:00') AT TIME ZONE 'UTC'),
    ((trend_rows.session_date + TIME '16:00') AT TIME ZONE 'UTC'),
    'completed',
    'Seeded session trend data for client@test.com.',
    false,
    120,
    120,
    'aba',
    60,
    'in_home',
    NOW()
  FROM trend_rows
  CROSS JOIN public.clients AS client_rec
  CROSS JOIN public.therapists AS therapist_rec
  WHERE client_rec.email = 'client@test.com'
    AND therapist_rec.email = 'therapist@test.com'
  ON CONFLICT (id) DO UPDATE
  SET
    organization_id = EXCLUDED.organization_id,
    client_id = EXCLUDED.client_id,
    therapist_id = EXCLUDED.therapist_id,
    program_id = EXCLUDED.program_id,
    goal_id = EXCLUDED.goal_id,
    session_date = EXCLUDED.session_date,
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

  WITH trend_seed(idx, session_id, note_id, correct_trials) AS (
    VALUES
      (0, '00000000-0000-0000-0000-000000000301'::uuid, '00000000-0000-0000-0000-000000000401'::uuid, 5),
      (1, '00000000-0000-0000-0000-000000000302'::uuid, '00000000-0000-0000-0000-000000000402'::uuid, 6),
      (2, '00000000-0000-0000-0000-000000000303'::uuid, '00000000-0000-0000-0000-000000000403'::uuid, 7),
      (3, '00000000-0000-0000-0000-000000000304'::uuid, '00000000-0000-0000-0000-000000000404'::uuid, 7),
      (4, '00000000-0000-0000-0000-000000000305'::uuid, '00000000-0000-0000-0000-000000000405'::uuid, 8),
      (5, '00000000-0000-0000-0000-000000000306'::uuid, '00000000-0000-0000-0000-000000000406'::uuid, 8),
      (6, '00000000-0000-0000-0000-000000000307'::uuid, '00000000-0000-0000-0000-000000000407'::uuid, 9),
      (7, '00000000-0000-0000-0000-000000000308'::uuid, '00000000-0000-0000-0000-000000000408'::uuid, 9),
      (8, '00000000-0000-0000-0000-000000000309'::uuid, '00000000-0000-0000-0000-000000000409'::uuid, 10),
      (9, '00000000-0000-0000-0000-000000000310'::uuid, '00000000-0000-0000-0000-000000000410'::uuid, 10),
      (10, '00000000-0000-0000-0000-000000000311'::uuid, '00000000-0000-0000-0000-000000000411'::uuid, 11),
      (11, '00000000-0000-0000-0000-000000000312'::uuid, '00000000-0000-0000-0000-000000000412'::uuid, 11)
  ),
  trend_rows AS (
    SELECT
      trend_seed.*,
      (CURRENT_DATE - INTERVAL '27 days' + (trend_seed.idx * INTERVAL '2 days'))::date AS session_date,
      12 - trend_seed.correct_trials AS incorrect_trials
    FROM trend_seed
  )
  INSERT INTO public.client_session_notes (
    id,
    client_id,
    authorization_id,
    therapist_id,
    created_by,
    organization_id,
    session_id,
    service_code,
    session_date,
    start_time,
    end_time,
    session_duration,
    goals_addressed,
    goal_ids,
    goal_notes,
    goal_measurements,
    narrative,
    is_locked,
    signed_at,
    created_at,
    updated_at
  )
  SELECT
    trend_rows.note_id,
    client_rec.id,
    '00000000-0000-0000-0000-000000000203'::uuid,
    therapist_rec.id,
    therapist_rec.id,
    '00000000-0000-0000-0000-000000000001'::uuid,
    trend_rows.session_id,
    '97153',
    trend_rows.session_date,
    TIME '15:00',
    TIME '16:00',
    60,
    ARRAY['Seed Goal'],
    ARRAY['00000000-0000-0000-0000-000000000202'],
    jsonb_build_object(
      '00000000-0000-0000-0000-000000000202',
      'Practiced functional communication requests with seeded trial opportunities.'
    ),
    jsonb_build_object(
      '00000000-0000-0000-0000-000000000202',
      jsonb_build_object(
        'version',
        1,
        'data',
        jsonb_build_object(
          'measurement_type',
          'trial_count',
          'metric_label',
          'Independent correct responses',
          'metric_unit',
          'opportunities',
          'metric_value',
          trend_rows.correct_trials,
          'incorrect_trials',
          trend_rows.incorrect_trials,
          'opportunities',
          12,
          'target',
          'Functional communication request',
          'targets',
          jsonb_build_array('Functional communication request'),
          'target_trials',
          jsonb_build_array(
            jsonb_build_object(
              'target',
              'Functional communication request',
              'metric_value',
              trend_rows.correct_trials,
              'incorrect_trials',
              trend_rows.incorrect_trials,
              'opportunities',
              12
            )
          )
        )
      )
    ),
    format(
      'Seeded session trend note: %s of 12 independent responses.',
      trend_rows.correct_trials
    ),
    true,
    ((trend_rows.session_date + TIME '16:05') AT TIME ZONE 'UTC'),
    ((trend_rows.session_date + TIME '16:05') AT TIME ZONE 'UTC'),
    NOW()
  FROM trend_rows
  CROSS JOIN public.clients AS client_rec
  CROSS JOIN public.therapists AS therapist_rec
  WHERE client_rec.email = 'client@test.com'
    AND therapist_rec.email = 'therapist@test.com'
  ON CONFLICT (id) DO UPDATE
  SET
    client_id = EXCLUDED.client_id,
    authorization_id = EXCLUDED.authorization_id,
    therapist_id = EXCLUDED.therapist_id,
    created_by = EXCLUDED.created_by,
    organization_id = EXCLUDED.organization_id,
    session_id = EXCLUDED.session_id,
    service_code = EXCLUDED.service_code,
    session_date = EXCLUDED.session_date,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    session_duration = EXCLUDED.session_duration,
    goals_addressed = EXCLUDED.goals_addressed,
    goal_ids = EXCLUDED.goal_ids,
    goal_notes = EXCLUDED.goal_notes,
    goal_measurements = EXCLUDED.goal_measurements,
    narrative = EXCLUDED.narrative,
    is_locked = EXCLUDED.is_locked,
    signed_at = EXCLUDED.signed_at,
    updated_at = NOW();
END $$;

COMMIT;
