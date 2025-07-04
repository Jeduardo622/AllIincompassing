-- Add missing indexes for foreign keys
CREATE INDEX IF NOT EXISTS idx_function_performance_logs_executed_by ON function_performance_logs (executed_by);
CREATE INDEX IF NOT EXISTS idx_user_therapist_links_therapist_id ON user_therapist_links (therapist_id);

-- Drop unused indexes (review before applying in production)
DROP INDEX IF EXISTS idx_clients_location_lat;
DROP INDEX IF EXISTS idx_clients_location_lon;
DROP INDEX IF EXISTS idx_therapists_location_lat;
DROP INDEX IF EXISTS idx_therapists_location_lon;
DROP INDEX IF EXISTS idx_chat_history_user_id;
DROP INDEX IF EXISTS idx_chat_history_conversation_id;
DROP INDEX IF EXISTS idx_chat_history_created_at;
DROP INDEX IF EXISTS idx_therapist_certifications_status;
DROP INDEX IF EXISTS idx_therapist_certifications_expiry_date;
DROP INDEX IF EXISTS idx_ai_cache_key;
DROP INDEX IF EXISTS idx_ai_cache_hash;
DROP INDEX IF EXISTS idx_ai_cache_expires;
DROP INDEX IF EXISTS idx_ai_cache_created;
DROP INDEX IF EXISTS idx_function_performance_logs_function_name;
DROP INDEX IF EXISTS idx_function_performance_logs_executed_at;
DROP INDEX IF EXISTS idx_alerts_unresolved;
DROP INDEX IF EXISTS idx_ai_metrics_cache_hit;
DROP INDEX IF EXISTS idx_db_metrics_slow;
DROP INDEX IF EXISTS sessions_start_time_idx;
DROP INDEX IF EXISTS billing_records_session_id_idx;
DROP INDEX IF EXISTS referring_providers_name_idx;
DROP INDEX IF EXISTS idx_user_roles_user_id;
DROP INDEX IF EXISTS idx_user_roles_role_id;
DROP INDEX IF EXISTS idx_therapists_email;
DROP INDEX IF EXISTS client_availability_client_id_idx;
DROP INDEX IF EXISTS client_availability_day_idx;
DROP INDEX IF EXISTS therapist_availability_day_idx;
DROP INDEX IF EXISTS idx_authorization_services_auth_id;
DROP INDEX IF EXISTS idx_authorization_services_status;
DROP INDEX IF EXISTS idx_clients_unscheduled_hours;
DROP INDEX IF EXISTS idx_clients_service_preference;
DROP INDEX IF EXISTS idx_clients_email;
DROP INDEX IF EXISTS idx_clients_client_id;
DROP INDEX IF EXISTS idx_therapists_service_type;
DROP INDEX IF EXISTS idx_therapists_specialties;
DROP INDEX IF EXISTS idx_therapists_status;
DROP INDEX IF EXISTS idx_sessions_location_type;
DROP INDEX IF EXISTS idx_sessions_session_type;
DROP INDEX IF EXISTS idx_authorizations_insurance_provider_id;

-- Add missing indexes for foreign keys flagged by Supabase linter
CREATE INDEX IF NOT EXISTS idx_authorization_services_authorization_id ON public.authorization_services(authorization_id);
CREATE INDEX IF NOT EXISTS idx_authorizations_insurance_provider_id ON public.authorizations(insurance_provider_id);
CREATE INDEX IF NOT EXISTS idx_billing_records_session_id ON public.billing_records(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON public.chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_client_availability_client_id ON public.client_availability(client_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON public.user_roles(role_id); 