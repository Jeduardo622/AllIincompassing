import React from 'react';

export interface Location {
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
}

export interface ServiceArea {
  id: string;
  name: string;
  center_latitude: number;
  center_longitude: number;
  radius_km: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SchedulingPreferences {
  id: string;
  user_id: string;
  min_break_minutes: number;
  max_consecutive_sessions: number;
  preferred_break_minutes: number;
  max_daily_hours: number;
  start_location: string | null;
  end_location: string | null;
  avoid_highways: boolean;
  created_at: string;
  updated_at: string;
}

export interface Therapist {
  id: string;
  email: string;
  full_name: string;
  specialties: string[];
  max_clients: number;
  service_type: string[];
  weekly_hours_min: number;
  weekly_hours_max: number;
  availability_hours: {
    [key: string]: {
      start: string | null;
      end: string | null;
    };
  };
  created_at: string;
  latitude?: number;
  longitude?: number;
  service_radius_km?: number;
  max_daily_travel_minutes?: number;
  preferred_areas?: string[];
  avoid_rush_hour?: boolean;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  title?: string;
  facility?: string;
  employee_type?: string;
  staff_id?: string;
  supervisor?: string;
  status?: string;
  npi_number?: string;
  medicaid_id?: string;
  practitioner_id?: string;
  taxonomy_code?: string;
  time_zone?: string;
  phone?: string;
  street?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  rbt_number?: string;
  bcba_number?: string;
}

// Update the Client interface
export interface Client {
  id: string;
  email: string;
  full_name: string;
  date_of_birth: string;
  insurance_info: Record<string, any>;
  service_preference: string[];
  one_to_one_units: number;
  supervision_units: number;
  parent_consult_units: number;
  availability_hours: {
    [key: string]: {
      start: string | null;
      end: string | null;
    };
  };
  created_at: string;
  latitude?: number;
  longitude?: number;
  preferred_radius_km?: number;
  max_travel_minutes?: number;
  preferred_session_time?: string[];
  avoid_rush_hour?: boolean;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  gender?: string;
  client_id?: string;
  cin_number?: string;
  phone?: string;
  in_clinic?: boolean;
  in_home?: boolean;
  in_school?: boolean;
  daycare_after_school?: boolean;
  authorized_hours_per_month?: number;
  hours_provided_per_month?: number;
  unscheduled_hours?: number;
  // Parent/Guardian information
  parent1_first_name?: string;
  parent1_last_name?: string;
  parent1_phone?: string;
  parent1_email?: string;
  parent1_relationship?: string;
  parent2_first_name?: string;
  parent2_last_name?: string;
  parent2_phone?: string;
  parent2_email?: string;
  parent2_relationship?: string;
  // Address information
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  diagnosis?: string[];
  preferred_language?: string;
  address?: string;
  notes?: string;
  // Note: status field removed as it doesn't exist in current database schema
}

export interface Session {
  id: string;
  client_id: string;
  therapist_id: string;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no-show';
  notes: string;
  created_at: string;
  therapist?: { id: string; full_name: string };
  client?: { id: string; full_name: string };
}

export interface BillingRecord {
  id: string;
  session_id: string;
  amount: number;
  status: 'pending' | 'submitted' | 'paid' | 'rejected';
  claim_number?: string;
  submitted_at?: string;
  created_at: string;
}

export interface Authorization {
  id: string;
  authorization_number: string;
  client_id: string;
  provider_id: string;
  insurance_provider_id: string;
  diagnosis_code: string;
  diagnosis_description: string;
  start_date: string;
  end_date: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  created_at: string;
  updated_at: string;
  client?: Client;
  provider?: Therapist;
  services?: AuthorizationService[];
}

export interface AuthorizationService {
  id: string;
  authorization_id: string;
  service_code: string;
  service_description: string;
  from_date: string;
  to_date: string;
  requested_units: number;
  approved_units: number | null;
  unit_type: string;
  decision_status: 'pending' | 'approved' | 'denied';
  created_at: string;
  updated_at: string;
}

export interface InsuranceProvider {
  id: string;
  name: string;
  type: string;
  contact_phone: string | null;
  fax: string | null;
  website: string | null;
  created_at: string;
  updated_at: string;
}

// New interfaces for notes
export interface Note {
  id: string;
  content: string;
  author: string;
  created_at: string;
  is_visible_to_therapist?: boolean;
  is_visible_to_parent?: boolean;
  status: 'resolved' | 'open' | 'follow-up';
}

export interface SessionNote {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  service_code: string;
  therapist_name: string;
  therapist_id?: string;
  goals_addressed: string[];
  narrative: string;
  is_locked: boolean;
  client_id?: string;
}

export interface Issue {
  id: string;
  category: 'Certification' | 'Scheduling' | 'Training' | 'Performance' | 'Other' | 'Authorization' | 'Clinical' | 'Billing';
  description: string;
  status: 'Open' | 'In Progress' | 'Resolved';
  priority: 'Low' | 'Medium' | 'High';
  date_opened: string;
  last_action: string;
}

// Database Performance Monitoring Types
export interface DatabaseMetric {
  id: string;
  timestamp: string;
  query_type: string;
  execution_time_ms: number;
  rows_affected: number;
  cache_hit: boolean;
  table_name?: string;
  slow_query: boolean;
}

export interface SlowQuery {
  id: string;
  table_name?: string;
  execution_time_ms: number;
  query: string;
  timestamp: string;
}

export interface Alert {
  id: string;
  alert_type: string;
  metric_name: string;
  current_value: number;
  threshold_value: number;
  message: string;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
  escalated: boolean;
}