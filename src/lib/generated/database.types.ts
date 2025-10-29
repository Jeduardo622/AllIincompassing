export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action_details: Json | null
          action_type: string
          admin_user_id: string | null
          created_at: string | null
          id: string
          organization_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action_details?: Json | null
          action_type: string
          admin_user_id?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action_details?: Json | null
          action_type?: string
          admin_user_id?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      admin_invite_tokens: {
        Row: {
          created_at: string
          created_by: string
          email: string
          expires_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["role_type"]
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by: string
          email: string
          expires_at: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["role_type"]
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string
          email?: string
          expires_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["role_type"]
          token_hash?: string
        }
        Relationships: []
      }
      ai_cache: {
        Row: {
          created_at: string | null
          expires_at: string | null
          function_name: string
          hit_count: number | null
          id: string
          input_hash: string
          last_accessed: string | null
          response_data: Json
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          function_name: string
          hit_count?: number | null
          id?: string
          input_hash: string
          last_accessed?: string | null
          response_data: Json
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          function_name?: string
          hit_count?: number | null
          id?: string
          input_hash?: string
          last_accessed?: string | null
          response_data?: Json
        }
        Relationships: []
      }
      ai_performance_metrics: {
        Row: {
          cache_hit: boolean | null
          conversation_id: string | null
          cost_usd: number | null
          error_occurred: boolean | null
          function_called: string | null
          id: string
          response_time_ms: number
          timestamp: string | null
          token_usage: Json | null
          user_id: string | null
        }
        Insert: {
          cache_hit?: boolean | null
          conversation_id?: string | null
          cost_usd?: number | null
          error_occurred?: boolean | null
          function_called?: string | null
          id?: string
          response_time_ms: number
          timestamp?: string | null
          token_usage?: Json | null
          user_id?: string | null
        }
        Update: {
          cache_hit?: boolean | null
          conversation_id?: string | null
          cost_usd?: number | null
          error_occurred?: boolean | null
          function_called?: string | null
          id?: string
          response_time_ms?: number
          timestamp?: string | null
          token_usage?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_processing_logs: {
        Row: {
          api_provider: string | null
          confidence_score: number | null
          created_at: string | null
          error_message: string | null
          id: string
          input_data_size: number | null
          model_version: string | null
          processing_time_ms: number | null
          processing_type: string
          session_id: string
        }
        Insert: {
          api_provider?: string | null
          confidence_score?: number | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          input_data_size?: number | null
          model_version?: string | null
          processing_time_ms?: number | null
          processing_type: string
          session_id: string
        }
        Update: {
          api_provider?: string | null
          confidence_score?: number | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          input_data_size?: number | null
          model_version?: string | null
          processing_time_ms?: number | null
          processing_type?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_processing_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_response_cache: {
        Row: {
          cache_key: string
          created_at: string | null
          expires_at: string
          hit_count: number | null
          id: string
          last_hit_at: string | null
          metadata: Json | null
          query_hash: string | null
          query_text: string
          response_text: string
          updated_at: string | null
        }
        Insert: {
          cache_key: string
          created_at?: string | null
          expires_at: string
          hit_count?: number | null
          id?: string
          last_hit_at?: string | null
          metadata?: Json | null
          query_hash?: string | null
          query_text: string
          response_text: string
          updated_at?: string | null
        }
        Update: {
          cache_key?: string
          created_at?: string | null
          expires_at?: string
          hit_count?: number | null
          id?: string
          last_hit_at?: string | null
          metadata?: Json | null
          query_hash?: string | null
          query_text?: string
          response_text?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_session_notes: {
        Row: {
          ai_confidence_score: number | null
          ai_generated_summary: string | null
          behavioral_observations: Json | null
          california_compliant: boolean | null
          client_id: string
          client_responses: Json | null
          created_at: string | null
          current_clinical_status: string | null
          data_collection_summary: Json | null
          end_time: string
          id: string
          insurance_ready: boolean | null
          interventions_used: Json | null
          location: string | null
          manual_edits: string[] | null
          participants: string[] | null
          progress_toward_goals: Json | null
          recommendations: string[] | null
          session_date: string
          session_duration: number
          session_id: string
          signature: string | null
          signed_at: string | null
          start_time: string
          targeted_goals: Json | null
          therapist_id: string
          updated_at: string | null
        }
        Insert: {
          ai_confidence_score?: number | null
          ai_generated_summary?: string | null
          behavioral_observations?: Json | null
          california_compliant?: boolean | null
          client_id: string
          client_responses?: Json | null
          created_at?: string | null
          current_clinical_status?: string | null
          data_collection_summary?: Json | null
          end_time: string
          id?: string
          insurance_ready?: boolean | null
          interventions_used?: Json | null
          location?: string | null
          manual_edits?: string[] | null
          participants?: string[] | null
          progress_toward_goals?: Json | null
          recommendations?: string[] | null
          session_date: string
          session_duration: number
          session_id: string
          signature?: string | null
          signed_at?: string | null
          start_time: string
          targeted_goals?: Json | null
          therapist_id: string
          updated_at?: string | null
        }
        Update: {
          ai_confidence_score?: number | null
          ai_generated_summary?: string | null
          behavioral_observations?: Json | null
          california_compliant?: boolean | null
          client_id?: string
          client_responses?: Json | null
          created_at?: string | null
          current_clinical_status?: string | null
          data_collection_summary?: Json | null
          end_time?: string
          id?: string
          insurance_ready?: boolean | null
          interventions_used?: Json | null
          location?: string | null
          manual_edits?: string[] | null
          participants?: string[] | null
          progress_toward_goals?: Json | null
          recommendations?: string[] | null
          session_date?: string
          session_duration?: number
          session_id?: string
          signature?: string | null
          signed_at?: string | null
          start_time?: string
          targeted_goals?: Json | null
          therapist_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_session_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_session_notes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_session_notes_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      /* ... truncated: full types content generated by Supabase CLI ... */
    }
    Views: {
      app_users_safe: {
        Row: {
          created_at: string | null
          email: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      // See full function signatures in the generated source of this file
    }
    Enums: {
      role_type:
        | "client"
        | "therapist"
        | "staff"
        | "supervisor"
        | "admin"
        | "super_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      role_type: [
        "client",
        "therapist",
        "staff",
        "supervisor",
        "admin",
        "super_admin",
      ],
    },
  },
} as const

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action_details: Json | null
          action_type: string
          admin_user_id: string | null
          created_at: string | null
          id: string
          organization_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action_details?: Json | null
          action_type: string
          admin_user_id?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action_details?: Json | null
          action_type?: string
          admin_user_id?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      admin_invite_tokens: {
        Row: {
          created_at: string
          created_by: string
          email: string
          expires_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["role_type"]
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by: string
          email: string
          expires_at: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["role_type"]
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string
          email?: string
          expires_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["role_type"]
          token_hash?: string
        }
        Relationships: []
      }
      ai_cache: {
        Row: {
          created_at: string | null
          expires_at: string | null
          function_name: string
          hit_count: number | null
          id: string
          input_hash: string
          last_accessed: string | null
          response_data: Json
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          function_name: string
          hit_count?: number | null
          id?: string
          input_hash: string
          last_accessed?: string | null
          response_data: Json
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          function_name?: string
          hit_count?: number | null
          id?: string
          input_hash?: string
          last_accessed?: string | null
          response_data?: Json
        }
        Relationships: []
      }
      ai_performance_metrics: {
        Row: {
          cache_hit: boolean | null
          conversation_id: string | null
          cost_usd: number | null
          error_occurred: boolean | null
          function_called: string | null
          id: string
          response_time_ms: number
          timestamp: string | null
          token_usage: Json | null
          user_id: string | null
        }
        Insert: {
          cache_hit?: boolean | null
          conversation_id?: string | null
          cost_usd?: number | null
          error_occurred?: boolean | null
          function_called?: string | null
          id?: string
          response_time_ms: number
          timestamp?: string | null
          token_usage?: Json | null
          user_id?: string | null
        }
        Update: {
          cache_hit?: boolean | null
          conversation_id?: string | null
          cost_usd?: number | null
          error_occurred?: boolean | null
          function_called?: string | null
          id?: string
          response_time_ms?: number
          timestamp?: string | null
          token_usage?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_processing_logs: {
        Row: {
          api_provider: string | null
          confidence_score: number | null
          created_at: string | null
          error_message: string | null
          id: string
          input_data_size: number | null
          model_version: string | null
          processing_time_ms: number | null
          processing_type: string
          session_id: string
        }
        Insert: {
          api_provider?: string | null
          confidence_score?: number | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          input_data_size?: number | null
          model_version?: string | null
          processing_time_ms?: number | null
          processing_type: string
          session_id: string
        }
        Update: {
          api_provider?: string | null
          confidence_score?: number | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          input_data_size?: number | null
          model_version?: string | null
          processing_time_ms?: number | null
          processing_type?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_processing_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_response_cache: {
        Row: {
          cache_key: string
          created_at: string | null
          expires_at: string
          hit_count: number | null
          id: string
          last_hit_at: string | null
          metadata: Json | null
          query_hash: string | null
          query_text: string
          response_text: string
          updated_at: string | null
        }
        Insert: {
          cache_key: string
          created_at?: string | null
          expires_at: string
          hit_count?: number | null
          id?: string
          last_hit_at?: string | null
          metadata?: Json | null
          query_hash?: string | null
          query_text: string
          response_text: string
          updated_at?: string | null
        }
        Update: {
          cache_key?: string
          created_at?: string | null
          expires_at?: string
          hit_count?: number | null
          id?: string
          last_hit_at?: string | null
          metadata?: Json | null
          query_hash?: string | null
          query_text?: string
          response_text?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_session_notes: {
        Row: {
          ai_confidence_score: number | null
          ai_generated_summary: string | null
          behavioral_observations: Json | null
          california_compliant: boolean | null
          client_id: string
          client_responses: Json | null
          created_at: string | null
          current_clinical_status: string | null
          data_collection_summary: Json | null
          end_time: string
          id: string
          insurance_ready: boolean | null
          interventions_used: Json | null
          location: string | null
          manual_edits: string[] | null
          participants: string[] | null
          progress_toward_goals: Json | null
          recommendations: string[] | null
          session_date: string
          session_duration: number
          session_id: string
          signature: string | null
          signed_at: string | null
          start_time: string
          targeted_goals: Json | null
          therapist_id: string
          updated_at: string | null
        }
        Insert: {
          ai_confidence_score?: number | null
          ai_generated_summary?: string | null
          behavioral_observations?: Json | null
          california_compliant?: boolean | null
          client_id: string
          client_responses?: Json | null
          created_at?: string | null
          current_clinical_status?: string | null
          data_collection_summary?: Json | null
          end_time: string
          id?: string
          insurance_ready?: boolean | null
          interventions_used?: Json | null
          location?: string | null
          manual_edits?: string[] | null
          participants?: string[] | null
          progress_toward_goals?: Json | null
          recommendations?: string[] | null
          session_date: string
          session_duration: number
          session_id: string
          signature?: string | null
          signed_at?: string | null
          start_time: string
          targeted_goals?: Json | null
          therapist_id: string
          updated_at?: string | null
        }
        Update: {
          ai_confidence_score?: number | null
          ai_generated_summary?: string | null
          behavioral_observations?: Json | null
          california_compliant?: boolean | null
          client_id?: string
          client_responses?: Json | null
          created_at?: string | null
          current_clinical_status?: string | null
          data_collection_summary?: Json | null
          end_time?: string
          id?: string
          insurance_ready?: boolean | null
          interventions_used?: Json | null
          location?: string | null
          manual_edits?: string[] | null
          participants?: string[] | null
          progress_toward_goals?: Json | null
          recommendations?: string[] | null
          session_date?: string
          session_duration?: number
          session_id?: string
          signature?: string | null
          signed_at?: string | null
          start_time?: string
          targeted_goals?: Json | null
          therapist_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_session_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_session_notes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_session_notes_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      authorization_services: {
        Row: {
          approved_units: number | null
          authorization_id: string
          created_at: string | null
          decision_status: string
          from_date: string
          id: string
          requested_units: number
          service_code: string
          service_description: string
          to_date: string
          unit_type: string
          updated_at: string | null
        }
        Insert: {
          approved_units?: number | null
          authorization_id: string
          created_at?: string | null
          decision_status?: string
          from_date: string
          id?: string
          requested_units: number
          service_code: string
          service_description: string
          to_date: string
          unit_type: string
          updated_at?: string | null
        }
        Update: {
          approved_units?: number | null
          authorization_id?: string
          created_at?: string | null
          decision_status?: string
          from_date?: string
          id?: string
          requested_units?: number
          service_code?: string
          service_description?: string
          to_date?: string
          unit_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "authorization_services_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      authorizations: {
        Row: {
          authorization_number: string
          client_id: string
          created_at: string | null
          diagnosis_code: string
          diagnosis_description: string | null
          end_date: string
          id: string
          insurance_provider_id: string | null
          provider_id: string
          start_date: string
          status: string
          updated_at: string | null
        }
        Insert: {
          authorization_number: string
          client_id: string
          created_at?: string | null
          diagnosis_code: string
          diagnosis_description?: string | null
          end_date: string
          id?: string
          insurance_provider_id?: string | null
          provider_id: string
          start_date: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          authorization_number?: string
          client_id?: string
          created_at?: string | null
          diagnosis_code?: string
          diagnosis_description?: string | null
          end_date?: string
          id?: string
          insurance_provider_id?: string | null
          provider_id?: string
          start_date?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "authorizations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authorizations_insurance_provider_id_fkey"
            columns: ["insurance_provider_id"]
            isOneToOne: false
            referencedRelation: "insurance_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authorizations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      behavioral_patterns: {
        Row: {
          aba_terminology: string | null
          confidence_weight: number | null
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          organization_id: string | null
          pattern_name: string
          pattern_type: string
          regex_pattern: string
          updated_at: string | null
        }
        Insert: {
          aba_terminology?: string | null
          confidence_weight?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          pattern_name: string
          pattern_type: string
          regex_pattern: string
          updated_at?: string | null
        }
        Update: {
          aba_terminology?: string | null
          confidence_weight?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          pattern_name?: string
          pattern_type?: string
          regex_pattern?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      billing_modifiers: {
        Row: {
          billing_note: string | null
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          billing_note?: string | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          billing_note?: string | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      billing_records: {
        Row: {
          amount: number
          claim_number: string | null
          created_at: string | null
          id: string
          organization_id: string
          session_id: string
          status: string
          submitted_at: string | null
        }
        Insert: {
          amount: number
          claim_number?: string | null
          created_at?: string | null
          id?: string
          organization_id: string
          session_id: string
          status?: string
          submitted_at?: string | null
        }
        Update: {
          amount?: number
          claim_number?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string
          session_id?: string
          status?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_history: {
        Row: {
          action_data: Json | null
          action_type: string | null
          content: string
          context: Json | null
          conversation_id: string
          created_at: string | null
          id: string
          role: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          action_data?: Json | null
          action_type?: string | null
          content: string
          context?: Json | null
          conversation_id?: string
          created_at?: string | null
          id?: string
          role: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          action_data?: Json | null
          action_type?: string | null
          content?: string
          context?: Json | null
          conversation_id?: string
          created_at?: string | null
          id?: string
          role?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      client_availability: {
        Row: {
          client_id: string
          created_at: string | null
          day_of_week: string
          end_time: string
          id: string
          is_recurring: boolean | null
          location_preference: string[] | null
          start_time: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          day_of_week: string
          end_time: string
          id?: string
          is_recurring?: boolean | null
          location_preference?: string[] | null
          start_time: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          day_of_week?: string
          end_time?: string
          id?: string
          is_recurring?: boolean | null
          location_preference?: string[] | null
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_availability_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_guardians: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          guardian_id: string
          id: string
          is_primary: boolean
          metadata: Json
          organization_id: string
          relationship: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          guardian_id: string
          id?: string
          is_primary?: boolean
          metadata?: Json
          organization_id: string
          relationship?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          guardian_id?: string
          id?: string
          is_primary?: boolean
          metadata?: Json
          organization_id?: string
          relationship?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_guardians_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_guardians_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          authorized_hours_per_month: number | null
          availability_hours: Json | null
          avoid_rush_hour: boolean | null
          cin_number: string | null
          city: string | null
          client_id: string | null
          created_at: string | null
          created_by: string | null
          date_of_birth: string | null
          daycare_after_school: boolean | null
          deleted_at: string | null
          deleted_by: string | null
          diagnosis: string[] | null
          documents: Json | null
          email: string | null
          first_name: string | null
          full_name: string
          gender: string | null
          hours_provided_per_month: number | null
          id: string
          in_clinic: boolean | null
          in_home: boolean | null
          in_school: boolean | null
          insurance_info: Json | null
          last_name: string | null
          latitude: number | null
          longitude: number | null
          max_travel_minutes: number | null
          middle_name: string | null
          notes: string | null
          one_to_one_units: number | null
          organization_id: string
          parent_consult_units: number | null
          parent1_email: string | null
          parent1_first_name: string | null
          parent1_last_name: string | null
          parent1_phone: string | null
          parent1_relationship: string | null
          parent2_email: string | null
          parent2_first_name: string | null
          parent2_last_name: string | null
          parent2_phone: string | null
          parent2_relationship: string | null
          phone: string | null
          preferred_language: string | null
          preferred_radius_km: number | null
          preferred_session_time: string[] | null
          referral_source: string | null
          service_preference: string[] | null
          state: string | null
          status: string
          supervision_units: number | null
          unscheduled_hours: number | null
          updated_at: string
          updated_by: string | null
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          authorized_hours_per_month?: number | null
          availability_hours?: Json | null
          avoid_rush_hour?: boolean | null
          cin_number?: string | null
          city?: string | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_birth?: string | null
          daycare_after_school?: boolean | null
          deleted_at?: string | null
          deleted_by?: string | null
          diagnosis?: string[] | null
          documents?: Json | null
          email?: string | null
          first_name?: string | null
          full_name: string
          gender?: string | null
          hours_provided_per_month?: number | null
          id?: string
          in_clinic?: boolean | null
          in_home?: boolean | null
          in_school?: boolean | null
          insurance_info?: Json | null
          last_name?: string | null
          latitude?: number | null
          longitude?: number | null
          max_travel_minutes?: number | null
          middle_name?: string | null
          notes?: string | null
          one_to_one_units?: number | null
          organization_id: string
          parent_consult_units?: number | null
          parent1_email?: string | null
          parent1_first_name?: string | null
          parent1_last_name?: string | null
          parent1_phone?: string | null
          parent1_relationship?: string | null
          parent2_email?: string | null
          parent2_first_name?: string | null
          parent2_last_name?: string | null
          parent2_phone?: string | null
          parent2_relationship?: string | null
          phone?: string | null
          preferred_language?: string | null
          preferred_radius_km?: number | null
          preferred_session_time?: string[] | null
          referral_source?: string | null
          service_preference?: string[] | null
          state?: string | null
          status?: string
          supervision_units?: number | null
          unscheduled_hours?: number | null
          updated_at?: string
          updated_by?: string | null
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          authorized_hours_per_month?: number | null
          availability_hours?: Json | null
          avoid_rush_hour?: boolean | null
          cin_number?: string | null
          city?: string | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_birth?: string | null
          daycare_after_school?: boolean | null
          deleted_at?: string | null
          deleted_by?: string | null
          diagnosis?: string[] | null
          documents?: Json | null
          email?: string | null
          first_name?: string | null
          full_name?: string
          gender?: string | null
          hours_provided_per_month?: number | null
          id?: string
          in_clinic?: boolean | null
          in_home?: boolean | null
          in_school?: boolean | null
          insurance_info?: Json | null
          last_name?: string | null
          latitude?: number | null
          longitude?: number | null
          max_travel_minutes?: number | null
          middle_name?: string | null
          notes?: string | null
          one_to_one_units?: number | null
          organization_id?: string
          parent_consult_units?: number | null
          parent1_email?: string | null
          parent1_first_name?: string | null
          parent1_last_name?: string | null
          parent1_phone?: string | null
          parent1_relationship?: string | null
          parent2_email?: string | null
          parent2_first_name?: string | null
          parent2_last_name?: string | null
          parent2_phone?: string | null
          parent2_relationship?: string | null
          phone?: string | null
          preferred_language?: string | null
          preferred_radius_km?: number | null
          preferred_session_time?: string[] | null
          referral_source?: string | null
          service_preference?: string[] | null
          state?: string | null
          status?: string
          supervision_units?: number | null
          unscheduled_hours?: number | null
          updated_at?: string
          updated_by?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      company_settings: {
        Row: {
          accent_color: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          company_name: string
          created_at: string | null
          date_format: string | null
          default_currency: string | null
          email: string | null
          fax: string | null
          id: string
          legal_name: string | null
          logo_url: string | null
          medicaid_provider_id: string | null
          npi_number: string | null
          phone: string | null
          primary_color: string | null
          session_duration_default: number | null
          state: string | null
          tax_id: string | null
          time_format: string | null
          time_zone: string | null
          updated_at: string | null
          website: string | null
          zip_code: string | null
        }
        Insert: {
          accent_color?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          company_name: string
          created_at?: string | null
          date_format?: string | null
          default_currency?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          legal_name?: string | null
          logo_url?: string | null
          medicaid_provider_id?: string | null
          npi_number?: string | null
          phone?: string | null
          primary_color?: string | null
          session_duration_default?: number | null
          state?: string | null
          tax_id?: string | null
          time_format?: string | null
          time_zone?: string | null
          updated_at?: string | null
          website?: string | null
          zip_code?: string | null
        }
        Update: {
          accent_color?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          company_name?: string
          created_at?: string | null
          date_format?: string | null
          default_currency?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          legal_name?: string | null
          logo_url?: string | null
          medicaid_provider_id?: string | null
          npi_number?: string | null
          phone?: string | null
          primary_color?: string | null
          session_duration_default?: number | null
          state?: string | null
          tax_id?: string | null
          time_format?: string | null
          time_zone?: string | null
          updated_at?: string | null
          website?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          title: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      cpt_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          long_description: string | null
          service_setting: string | null
          short_description: string
          typical_duration_minutes: number | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          long_description?: string | null
          service_setting?: string | null
          short_description: string
          typical_duration_minutes?: number | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          long_description?: string | null
          service_setting?: string | null
          short_description?: string
          typical_duration_minutes?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      db_performance_metrics: {
        Row: {
          cache_hit: boolean | null
          execution_time_ms: number
          id: string
          query_type: string
          rows_affected: number | null
          slow_query: boolean | null
          table_name: string | null
          timestamp: string | null
        }
        Insert: {
          cache_hit?: boolean | null
          execution_time_ms: number
          id?: string
          query_type: string
          rows_affected?: number | null
          slow_query?: boolean | null
          table_name?: string | null
          timestamp?: string | null
        }
        Update: {
          cache_hit?: boolean | null
          execution_time_ms?: number
          id?: string
          query_type?: string
          rows_affected?: number | null
          slow_query?: boolean | null
          table_name?: string | null
          timestamp?: string | null
        }
        Relationships: []
      }
      error_logs: {
        Row: {
          context: Json | null
          created_at: string | null
          details: Json | null
          error_type: string
          id: string
          message: string
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          session_id: string | null
          severity: string | null
          stack_trace: string | null
          updated_at: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string | null
          details?: Json | null
          error_type: string
          id?: string
          message: string
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string | null
          severity?: string | null
          stack_trace?: string | null
          updated_at?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string | null
          details?: Json | null
          error_type?: string
          id?: string
          message?: string
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string | null
          severity?: string | null
          stack_trace?: string | null
          updated_at?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      feature_flag_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          feature_flag_id: string | null
          id: string
          new_state: Json | null
          organization_id: string | null
          plan_code: string | null
          previous_state: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          feature_flag_id?: string | null
          id?: string
          new_state?: Json | null
          organization_id?: string | null
          plan_code?: string | null
          previous_state?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          feature_flag_id?: string | null
          id?: string
          new_state?: Json | null
          organization_id?: string | null
          plan_code?: string | null
          previous_state?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flag_audit_logs_feature_flag_id_fkey"
            columns: ["feature_flag_id"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flag_audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flag_audit_logs_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          created_by: string | null
          default_enabled: boolean
          description: string | null
          flag_key: string
          id: string
          metadata: Json | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_enabled?: boolean
          description?: string | null
          flag_key: string
          id?: string
          metadata?: Json | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_enabled?: boolean
          description?: string | null
          flag_key?: string
          id?: string
          metadata?: Json | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      file_cabinet_settings: {
        Row: {
          allowed_file_types: string[] | null
          category_name: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          max_file_size_mb: number | null
          requires_signature: boolean | null
          retention_period_days: number | null
          updated_at: string | null
        }
        Insert: {
          allowed_file_types?: string[] | null
          category_name: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_file_size_mb?: number | null
          requires_signature?: boolean | null
          retention_period_days?: number | null
          updated_at?: string | null
        }
        Update: {
          allowed_file_types?: string[] | null
          category_name?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_file_size_mb?: number | null
          requires_signature?: boolean | null
          retention_period_days?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      function_performance_logs: {
        Row: {
          executed_at: string | null
          executed_by: string | null
          execution_time_ms: number
          function_name: string
          id: string
          parameters: Json | null
          result_size: number | null
        }
        Insert: {
          executed_at?: string | null
          executed_by?: string | null
          execution_time_ms: number
          function_name: string
          id?: string
          parameters?: Json | null
          result_size?: number | null
        }
        Update: {
          executed_at?: string | null
          executed_by?: string | null
          execution_time_ms?: number
          function_name?: string
          id?: string
          parameters?: Json | null
          result_size?: number | null
        }
        Relationships: []
      }
      impersonation_audit: {
        Row: {
          actor_ip: unknown
          actor_organization_id: string
          actor_user_agent: string | null
          actor_user_id: string
          created_at: string
          expires_at: string
          id: string
          issued_at: string
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          target_organization_id: string
          target_user_id: string
          token_jti: string
        }
        Insert: {
          actor_ip?: unknown
          actor_organization_id: string
          actor_user_agent?: string | null
          actor_user_id: string
          created_at?: string
          expires_at: string
          id?: string
          issued_at?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          target_organization_id: string
          target_user_id: string
          token_jti: string
        }
        Update: {
          actor_ip?: unknown
          actor_organization_id?: string
          actor_user_agent?: string | null
          actor_user_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          issued_at?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          target_organization_id?: string
          target_user_id?: string
          token_jti?: string
        }
        Relationships: []
      }
      impersonation_revocation_queue: {
        Row: {
          audit_id: string
          created_at: string
          error: string | null
          id: string
          processed_at: string | null
          token_jti: string
        }
        Insert: {
          audit_id: string
          created_at?: string
          error?: string | null
          id?: string
          processed_at?: string | null
          token_jti: string
        }
        Update: {
          audit_id?: string
          created_at?: string
          error?: string | null
          id?: string
          processed_at?: string | null
          token_jti?: string
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_revocation_queue_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "impersonation_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_providers: {
        Row: {
          contact_phone: string | null
          created_at: string | null
          fax: string | null
          id: string
          name: string
          type: string
          updated_at: string | null
          website: string | null
        }
        Insert: {
          contact_phone?: string | null
          created_at?: string | null
          fax?: string | null
          id?: string
          name: string
          type: string
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          contact_phone?: string | null
          created_at?: string | null
          fax?: string | null
          id?: string
          name?: string
          type?: string
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      locations: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          created_at: string | null
          email: string | null
          fax: string | null
          id: string
          is_active: boolean | null
          name: string
          operating_hours: Json | null
          phone: string | null
          state: string | null
          type: string
          updated_at: string | null
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          operating_hours?: Json | null
          phone?: string | null
          state?: string | null
          type: string
          updated_at?: string | null
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          operating_hours?: Json | null
          phone?: string | null
          state?: string | null
          type?: string
          updated_at?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      organization_feature_flags: {
        Row: {
          created_at: string
          created_by: string | null
          feature_flag_id: string
          id: string
          is_enabled: boolean
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          feature_flag_id: string
          id?: string
          is_enabled?: boolean
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          feature_flag_id?: string
          id?: string
          is_enabled?: boolean
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_feature_flags_feature_flag_id_fkey"
            columns: ["feature_flag_id"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_feature_flags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_plans: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          notes: string | null
          organization_id: string
          plan_code: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          notes?: string | null
          organization_id: string
          plan_code: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          notes?: string | null
          organization_id?: string
          plan_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_plans_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          metadata: Json | null
          name: string | null
          slug: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id: string
          metadata?: Json | null
          name?: string | null
          slug?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          slug?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      performance_alerts: {
        Row: {
          alert_type: string
          created_at: string | null
          current_value: number
          escalated: boolean | null
          id: string
          message: string
          metric_name: string
          resolved: boolean | null
          resolved_at: string | null
          threshold_value: number
        }
        Insert: {
          alert_type: string
          created_at?: string | null
          current_value: number
          escalated?: boolean | null
          id?: string
          message: string
          metric_name: string
          resolved?: boolean | null
          resolved_at?: string | null
          threshold_value: number
        }
        Update: {
          alert_type?: string
          created_at?: string | null
          current_value?: number
          escalated?: boolean | null
          id?: string
          message?: string
          metric_name?: string
          resolved?: boolean | null
          resolved_at?: string | null
          threshold_value?: number
        }
        Relationships: []
      }
      performance_baselines: {
        Row: {
          baseline_value: number
          confidence_level: number
          created_at: string
          critical_threshold: number
          id: string
          is_active: boolean | null
          measured_at: string
          metric_name: string
          sample_size: number
          updated_at: string
          warning_threshold: number
        }
        Insert: {
          baseline_value: number
          confidence_level: number
          created_at?: string
          critical_threshold: number
          id: string
          is_active?: boolean | null
          measured_at: string
          metric_name: string
          sample_size: number
          updated_at?: string
          warning_threshold: number
        }
        Update: {
          baseline_value?: number
          confidence_level?: number
          created_at?: string
          critical_threshold?: number
          id?: string
          is_active?: boolean | null
          measured_at?: string
          metric_name?: string
          sample_size?: number
          updated_at?: string
          warning_threshold?: number
        }
        Relationships: []
      }
      plans: {
        Row: {
          code: string
          created_at: string
          description: string | null
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          first_name: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          last_login_at: string | null
          last_name: string | null
          phone: string | null
          preferences: Json | null
          role: Database["public"]["Enums"]["role_type"]
          time_zone: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          first_name?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          phone?: string | null
          preferences?: Json | null
          role?: Database["public"]["Enums"]["role_type"]
          time_zone?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          phone?: string | null
          preferences?: Json | null
          role?: Database["public"]["Enums"]["role_type"]
          time_zone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      referring_providers: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          created_at: string | null
          credentials: string[] | null
          email: string | null
          facility_name: string | null
          fax: string | null
          first_name: string
          id: string
          is_active: boolean | null
          last_name: string
          npi_number: string | null
          phone: string | null
          specialty: string | null
          state: string | null
          updated_at: string | null
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string | null
          credentials?: string[] | null
          email?: string | null
          facility_name?: string | null
          fax?: string | null
          first_name: string
          id?: string
          is_active?: boolean | null
          last_name: string
          npi_number?: string | null
          phone?: string | null
          specialty?: string | null
          state?: string | null
          updated_at?: string | null
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string | null
          credentials?: string[] | null
          email?: string | null
          facility_name?: string | null
          fax?: string | null
          first_name?: string
          id?: string
          is_active?: boolean | null
          last_name?: string
          npi_number?: string | null
          phone?: string | null
          specialty?: string | null
          state?: string | null
          updated_at?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      roles: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_system_role: boolean | null
          name: string
          permissions: Json | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_system_role?: boolean | null
          name: string
          permissions?: Json | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_system_role?: boolean | null
          name?: string
          permissions?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      scheduling_preferences: {
        Row: {
          avoid_highways: boolean | null
          created_at: string | null
          end_location: string | null
          id: string
          max_consecutive_sessions: number | null
          max_daily_hours: number | null
          min_break_minutes: number | null
          preferred_break_minutes: number | null
          start_location: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          avoid_highways?: boolean | null
          created_at?: string | null
          end_location?: string | null
          id?: string
          max_consecutive_sessions?: number | null
          max_daily_hours?: number | null
          min_break_minutes?: number | null
          preferred_break_minutes?: number | null
          start_location?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          avoid_highways?: boolean | null
          created_at?: string | null
          end_location?: string | null
          id?: string
          max_consecutive_sessions?: number | null
          max_daily_hours?: number | null
          min_break_minutes?: number | null
          preferred_break_minutes?: number | null
          start_location?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      service_areas: {
        Row: {
          center_latitude: number
          center_longitude: number
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          radius_km: number
          updated_at: string | null
        }
        Insert: {
          center_latitude: number
          center_longitude: number
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          radius_km: number
          updated_at?: string | null
        }
        Update: {
          center_latitude?: number
          center_longitude?: number
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          radius_km?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      service_lines: {
        Row: {
          available_locations: string[] | null
          billable: boolean | null
          code: string | null
          created_at: string | null
          description: string | null
          documentation_required: boolean | null
          id: string
          is_active: boolean | null
          name: string
          rate_per_hour: number | null
          requires_authorization: boolean | null
          updated_at: string | null
        }
        Insert: {
          available_locations?: string[] | null
          billable?: boolean | null
          code?: string | null
          created_at?: string | null
          description?: string | null
          documentation_required?: boolean | null
          id?: string
          is_active?: boolean | null
          name: string
          rate_per_hour?: number | null
          requires_authorization?: boolean | null
          updated_at?: string | null
        }
        Update: {
          available_locations?: string[] | null
          billable?: boolean | null
          code?: string | null
          created_at?: string | null
          description?: string | null
          documentation_required?: boolean | null
          id?: string
          is_active?: boolean | null
          name?: string
          rate_per_hour?: number | null
          requires_authorization?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      session_cpt_entries: {
        Row: {
          billed_minutes: number | null
          cpt_code_id: string
          created_at: string
          id: string
          is_primary: boolean
          line_number: number
          notes: string | null
          organization_id: string | null
          rate: number | null
          session_id: string
          units: number
          updated_at: string
        }
        Insert: {
          billed_minutes?: number | null
          cpt_code_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          line_number?: number
          notes?: string | null
          organization_id?: string | null
          rate?: number | null
          session_id: string
          units?: number
          updated_at?: string
        }
        Update: {
          billed_minutes?: number | null
          cpt_code_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          line_number?: number
          notes?: string | null
          organization_id?: string | null
          rate?: number | null
          session_id?: string
          units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_cpt_entries_cpt_code_id_fkey"
            columns: ["cpt_code_id"]
            isOneToOne: false
            referencedRelation: "cpt_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_cpt_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_cpt_modifiers: {
        Row: {
          id: number
          modifier_id: string
          position: number
          session_cpt_entry_id: string
        }
        Insert: {
          id?: never
          modifier_id: string
          position: number
          session_cpt_entry_id: string
        }
        Update: {
          id?: never
          modifier_id?: string
          position?: number
          session_cpt_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_cpt_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "billing_modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_cpt_modifiers_session_cpt_entry_id_fkey"
            columns: ["session_cpt_entry_id"]
            isOneToOne: false
            referencedRelation: "session_cpt_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      session_holds: {
        Row: {
          client_id: string
          created_at: string
          end_time: string
          expires_at: string
          hold_key: string
          id: string
          session_id: string | null
          start_time: string
          therapist_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          end_time: string
          expires_at?: string
          hold_key: string
          id?: string
          session_id?: string | null
          start_time: string
          therapist_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          end_time?: string
          expires_at?: string
          hold_key?: string
          id?: string
          session_id?: string | null
          start_time?: string
          therapist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_holds_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_holds_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_holds_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      session_note_templates: {
        Row: {
          compliance_requirements: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_california_compliant: boolean | null
          organization_id: string | null
          template_name: string
          template_structure: Json
          template_type: string
          updated_at: string | null
        }
        Insert: {
          compliance_requirements?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_california_compliant?: boolean | null
          organization_id?: string | null
          template_name: string
          template_structure: Json
          template_type: string
          updated_at?: string | null
        }
        Update: {
          compliance_requirements?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_california_compliant?: boolean | null
          organization_id?: string | null
          template_name?: string
          template_structure?: Json
          template_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      session_transcript_segments: {
        Row: {
          behavioral_markers: Json | null
          confidence: number | null
          created_at: string | null
          end_time: number
          id: string
          organization_id: string | null
          session_id: string
          speaker: string
          start_time: number
          text: string
        }
        Insert: {
          behavioral_markers?: Json | null
          confidence?: number | null
          created_at?: string | null
          end_time: number
          id?: string
          organization_id?: string | null
          session_id: string
          speaker: string
          start_time: number
          text: string
        }
        Update: {
          behavioral_markers?: Json | null
          confidence?: number | null
          created_at?: string | null
          end_time?: number
          id?: string
          organization_id?: string | null
          session_id?: string
          speaker?: string
          start_time?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_transcript_segments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_transcripts: {
        Row: {
          confidence_score: number | null
          created_at: string | null
          id: string
          organization_id: string | null
          processed_transcript: string
          raw_transcript: string
          session_id: string
          updated_at: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          processed_transcript: string
          raw_transcript: string
          session_id: string
          updated_at?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          processed_transcript?: string
          raw_transcript?: string
          session_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_transcripts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          client_id: string
          created_at: string | null
          duration_minutes: number | null
          end_time: string
          has_transcription_consent: boolean
          id: string
          location_type: string | null
          notes: string | null
          organization_id: string
          rate_per_hour: number | null
          session_type: string | null
          start_time: string
          status: string
          therapist_id: string
          total_cost: number | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          duration_minutes?: number | null
          end_time: string
          has_transcription_consent?: boolean
          id?: string
          location_type?: string | null
          notes?: string | null
          organization_id: string
          rate_per_hour?: number | null
          session_type?: string | null
          start_time: string
          status?: string
          therapist_id: string
          total_cost?: number | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          duration_minutes?: number | null
          end_time?: string
          has_transcription_consent?: boolean
          id?: string
          location_type?: string | null
          notes?: string | null
          organization_id?: string
          rate_per_hour?: number | null
          session_type?: string | null
          start_time?: string
          status?: string
          therapist_id?: string
          total_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      system_performance_metrics: {
        Row: {
          id: string
          metric_type: string
          threshold_breached: boolean | null
          timestamp: string | null
          unit: string
          value: number
        }
        Insert: {
          id?: string
          metric_type: string
          threshold_breached?: boolean | null
          timestamp?: string | null
          unit: string
          value: number
        }
        Update: {
          id?: string
          metric_type?: string
          threshold_breached?: boolean | null
          timestamp?: string | null
          unit?: string
          value?: number
        }
        Relationships: []
      }
      therapist_availability: {
        Row: {
          created_at: string | null
          day_of_week: string
          end_time: string
          id: string
          is_recurring: boolean | null
          service_types: string[] | null
          start_time: string
          therapist_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: string
          end_time: string
          id?: string
          is_recurring?: boolean | null
          service_types?: string[] | null
          start_time: string
          therapist_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: string
          end_time?: string
          id?: string
          is_recurring?: boolean | null
          service_types?: string[] | null
          start_time?: string
          therapist_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "therapist_availability_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      therapist_certifications: {
        Row: {
          created_at: string | null
          expiry_date: string | null
          file_name: string
          file_size: number
          file_type: string
          file_url: string
          id: string
          issue_date: string
          name: string
          notes: string | null
          status: string
          therapist_id: string
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          expiry_date?: string | null
          file_name: string
          file_size: number
          file_type: string
          file_url: string
          id?: string
          issue_date: string
          name: string
          notes?: string | null
          status?: string
          therapist_id: string
          type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          expiry_date?: string | null
          file_name?: string
          file_size?: number
          file_type?: string
          file_url?: string
          id?: string
          issue_date?: string
          name?: string
          notes?: string | null
          status?: string
          therapist_id?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "therapist_certifications_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      therapists: {
        Row: {
          availability_hours: Json | null
          avoid_rush_hour: boolean | null
          bcba_number: string | null
          city: string | null
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          email: string
          employee_type: string | null
          facility: string | null
          first_name: string | null
          full_name: string
          id: string
          last_name: string | null
          latitude: number | null
          longitude: number | null
          max_clients: number | null
          max_daily_travel_minutes: number | null
          medicaid_id: string | null
          middle_name: string | null
          npi_number: string | null
          organization_id: string
          phone: string | null
          practitioner_id: string | null
          preferred_areas: string[] | null
          rbt_number: string | null
          service_radius_km: number | null
          service_type: string[] | null
          specialties: string[] | null
          staff_id: string | null
          state: string | null
          status: string | null
          street: string | null
          supervisor: string | null
          taxonomy_code: string | null
          time_zone: string | null
          title: string | null
          weekly_hours_max: number | null
          weekly_hours_min: number | null
          zip_code: string | null
        }
        Insert: {
          availability_hours?: Json | null
          avoid_rush_hour?: boolean | null
          bcba_number?: string | null
          city?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email: string
          employee_type?: string | null
          facility?: string | null
          first_name?: string | null
          full_name: string
          id?: string
          last_name?: string | null
          latitude?: number | null
          longitude?: number | null
          max_clients?: number | null
          max_daily_travel_minutes?: number | null
          medicaid_id?: string | null
          middle_name?: string | null
          npi_number?: string | null
          organization_id: string
          phone?: string | null
          practitioner_id?: string | null
          preferred_areas?: string[] | null
          rbt_number?: string | null
          service_radius_km?: number | null
          service_type?: string[] | null
          specialties?: string[] | null
          staff_id?: string | null
          state?: string | null
          status?: string | null
          street?: string | null
          supervisor?: string | null
          taxonomy_code?: string | null
          time_zone?: string | null
          title?: string | null
          weekly_hours_max?: number | null
          weekly_hours_min?: number | null
          zip_code?: string | null
        }
        Update: {
          availability_hours?: Json | null
          avoid_rush_hour?: boolean | null
          bcba_number?: string | null
          city?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string
          employee_type?: string | null
          facility?: string | null
          first_name?: string | null
          full_name?: string
          id?: string
          last_name?: string | null
          latitude?: number | null
          longitude?: number | null
          max_clients?: number | null
          max_daily_travel_minutes?: number | null
          medicaid_id?: string | null
          middle_name?: string | null
          npi_number?: string | null
          organization_id?: string
          phone?: string | null
          practitioner_id?: string | null
          preferred_areas?: string[] | null
          rbt_number?: string | null
          service_radius_km?: number | null
          service_type?: string[] | null
          specialties?: string[] | null
          staff_id?: string | null
          state?: string | null
          status?: string | null
          street?: string | null
          supervisor?: string | null
          taxonomy_code?: string | null
          time_zone?: string | null
          title?: string | null
          weekly_hours_max?: number | null
          weekly_hours_min?: number | null
          zip_code?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          first_name: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          last_login_at: string | null
          last_name: string | null
          phone: string | null
          preferences: Json | null
          time_zone: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          first_name?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          phone?: string | null
          preferences?: Json | null
          time_zone?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          phone?: string | null
          preferences?: Json | null
          time_zone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          expires_at: string | null
          granted_at: string | null
          granted_by: string | null
          id: string
          is_active: boolean | null
          role_id: string
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean | null
          role_id: string
          user_id: string
        }
        Update: {
          expires_at?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          ip_address: unknown
          is_active: boolean | null
          last_activity: string | null
          session_token: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          ip_address?: unknown
          is_active?: boolean | null
          last_activity?: string | null
          session_token: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          ip_address?: unknown
          is_active?: boolean | null
          last_activity?: string | null
          session_token?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_therapist_links: {
        Row: {
          created_at: string
          id: string
          therapist_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          therapist_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          therapist_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_therapist_links_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      app_users_safe: {
        Row: {
          created_at: string | null
          email: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _is_admin: { Args: { uid: string }; Returns: boolean }
      _is_therapist: { Args: { uid: string }; Returns: boolean }
      acquire_session_hold: {
        Args: {
          p_actor_id?: string
          p_client_id: string
          p_end_time: string
          p_hold_seconds?: number
          p_session_id?: string
          p_start_time: string
          p_therapist_id: string
        }
        Returns: Json
      }
      admin_reset_user_password: {
        Args: {
          create_if_not_exists?: boolean
          new_password: string
          user_email: string
        }
        Returns: Json
      }
      analyze_therapist_workload: {
        Args: { p_analysis_period?: number; p_therapist_id?: string }
        Returns: {
          efficiency_score: number
          recommendations: Json
          target_hours: number
          therapist_id: string
          therapist_name: string
          total_hours: number
          utilization_rate: number
          workload_distribution: Json
        }[]
      }
      assign_admin_role: {
        Args: { organization_id: string; reason?: string; user_email: string }
        Returns: undefined
      }
      assign_therapist_role:
        | { Args: { user_id: string }; Returns: undefined }
        | {
            Args: { therapist_id: string; user_email: string }
            Returns: undefined
          }
      assign_user_role: {
        Args: {
          expires_at_param?: string
          granted_by_uuid?: string
          role_name: string
          user_uuid: string
        }
        Returns: boolean
      }
      cache_ai_response: {
        Args: {
          p_cache_key: string
          p_expires_at?: string
          p_metadata?: Json
          p_query_text: string
          p_response_text: string
        }
        Returns: undefined
      }
      calculate_therapist_client_compatibility: {
        Args: { p_client_id: string; p_therapist_id: string }
        Returns: number
      }
      calculate_time_slot_score: {
        Args: {
          p_client_id: string
          p_client_prefs: Json
          p_day_of_week: number
          p_hour_of_day: number
          p_slot_time: string
          p_therapist_id: string
          p_therapist_prefs: Json
        }
        Returns: number
      }
      can_access_client_documents: {
        Args: { client_id: string }
        Returns: boolean
      }
      check_migration_status: {
        Args: never
        Returns: {
          applied_at: string
          is_applied: boolean
          migration_name: string
        }[]
      }
      check_performance_thresholds: {
        Args: { p_current_value: number; p_metric_name: string }
        Returns: {
          current_value: number
          metric: string
          severity: string
          status: string
          threshold: number
        }[]
      }
      cleanup_ai_cache: { Args: never; Returns: number }
      cleanup_expired_ai_cache: { Args: never; Returns: number }
      cleanup_performance_data: { Args: never; Returns: number }
      confirm_session_hold: {
        Args: { p_actor_id?: string; p_hold_key: string; p_session: Json }
        Returns: Json
      }
      create_admin_invite: {
        Args: {
          p_email: string
          p_role?: Database["public"]["Enums"]["role_type"]
        }
        Returns: {
          expires_at: string
          token: string
        }[]
      }
      create_super_admin: { Args: { user_email: string }; Returns: undefined }
      current_user_is_super_admin: { Args: never; Returns: boolean }
      detect_scheduling_conflicts: {
        Args: {
          p_end_date: string
          p_include_suggestions?: boolean
          p_start_date: string
        }
        Returns: {
          affected_sessions: Json
          conflict_id: string
          conflict_type: string
          severity: number
          suggested_resolutions: Json
        }[]
      }
      enqueue_impersonation_revocation:
        | {
            Args: { p_audit_id: string; p_token_jti: string }
            Returns: undefined
          }
        | {
            Args: { p_audit_id: string; p_token_jti: string }
            Returns: undefined
          }
      ensure_admin_role:
        | { Args: { user_email: string }; Returns: undefined }
        | { Args: never; Returns: undefined }
      ensure_all_users_admin: { Args: never; Returns: undefined }
      ensure_user_has_admin_role:
        | { Args: { p_user_id: string }; Returns: undefined }
        | { Args: never; Returns: undefined }
      generate_semantic_cache_key: {
        Args: { p_context_hash?: string; p_query_text: string }
        Returns: string
      }
      generate_workload_recommendations: {
        Args: {
          p_actual_hours: number
          p_session_count: number
          p_target_hours: number
          p_therapist_id: string
        }
        Returns: Json
      }
      get_admin_users: { Args: never; Returns: Json }
      get_ai_cache_metrics: { Args: never; Returns: Json }
      get_alternative_therapists: {
        Args: { p_client_id: string; p_end_time: string; p_start_time: string }
        Returns: Json
      }
      get_alternative_times: {
        Args: {
          p_client_id: string
          p_original_time: string
          p_therapist_id: string
        }
        Returns: Json
      }
      get_authorization_metrics:
        | {
            Args: { p_end_date: string; p_start_date: string }
            Returns: {
              approval_rate: number
              approval_ratio: number
              approved_authorizations: number
              denied_authorizations: number
              expired_authorizations: number
              pending_authorizations: number
              total_approved_units: number
              total_authorizations: number
              total_requested_units: number
            }[]
          }
        | {
            Args: { p_end_date: string; p_start_date: string }
            Returns: {
              approved_authorizations: number
              denied_authorizations: number
              expired_authorizations: number
              pending_authorizations: number
              total_approved_units: number
              total_authorizations: number
              total_requested_units: number
              units_by_service_code: Json
            }[]
          }
      get_billing_metrics:
        | {
            Args: { p_end_date: string; p_start_date: string }
            Returns: {
              amount_by_client: Json
              collection_rate: number
              paid_amount: number
              pending_amount: number
              records_by_status: Json
              rejected_amount: number
              total_billed: number
            }[]
          }
        | {
            Args: { p_end_date: string; p_start_date: string }
            Returns: {
              amount_by_client: Json
              amount_by_status: Json
              paid_amount: number
              pending_amount: number
              rejected_amount: number
              total_billed: number
            }[]
          }
      get_cached_ai_response: {
        Args: { p_cache_key: string }
        Returns: {
          metadata: Json
          response_text: string
        }[]
      }
      get_client_documents: { Args: { p_client_id: string }; Returns: Json }
      get_client_metrics:
        | {
            Args: { p_end_date: string; p_start_date: string }
            Returns: {
              active_clients: number
              activity_rate: number
              clients_by_age: Json
              clients_by_gender: Json
              clients_by_service_preference: Json
              inactive_clients: number
              total_clients: number
            }[]
          }
        | {
            Args: { p_end_date: string; p_start_date: string }
            Returns: {
              active_clients: number
              inactive_clients: number
              new_clients: number
              service_preferences: Json
              sessions_per_client: Json
              total_clients: number
            }[]
          }
        | {
            Args: never
            Returns: {
              active_clients: number
              new_clients_this_month: number
              total_clients: number
            }[]
          }
      get_dashboard_data: { Args: never; Returns: Json }
      get_db_version: { Args: never; Returns: string }
      get_dropdown_data: { Args: never; Returns: Json }
      get_guardian_client_portal: {
        Args: { p_client_id?: string }
        Returns: {
          client_date_of_birth: string
          client_email: string
          client_full_name: string
          client_id: string
          client_phone: string
          client_status: string
          guardian_is_primary: boolean
          guardian_notes: Json
          guardian_relationship: string
          upcoming_sessions: Json
        }[]
      }
      get_optimal_time_slots: {
        Args: {
          p_client_preferences: Json
          p_date_range?: Json
          p_duration?: number
          p_therapist_preferences: Json
        }
        Returns: {
          availability_data: Json
          optimality_score: number
          reasoning: Json
          suggested_time: string
        }[]
      }
      get_organization_id_from_metadata: {
        Args: { p_metadata: Json }
        Returns: string
      }
      get_performance_metrics: {
        Args: { p_time_range?: string }
        Returns: Json
      }
      get_performance_recommendations: {
        Args: never
        Returns: {
          category: string
          difficulty: string
          estimated_improvement: string
          impact: string
          recommendation: string
        }[]
      }
      get_recent_chat_history:
        | {
            Args: { p_conversation_id: string; p_limit?: number }
            Returns: {
              action_data: Json
              action_type: string
              content: string
              context: Json
              conversation_id: string
              created_at: string
              id: string
              role: string
            }[]
          }
        | {
            Args: { p_conversation_id: string; p_limit?: number }
            Returns: {
              action_data: Json
              action_type: string
              content: string
              context: Json
              conversation_id: string
              created_at: string
              id: string
              role: string
            }[]
          }
      get_schedule_data_batch: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: Json
      }
      get_session_metrics:
        | {
            Args: {
              p_client_id?: string
              p_end_date: string
              p_start_date: string
              p_therapist_id?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_client_id?: string
              p_end_date: string
              p_start_date: string
              p_therapist_id?: string
            }
            Returns: Json
          }
      get_session_notes_with_compliance: {
        Args: { p_client_id: string; p_limit?: number }
        Returns: {
          ai_confidence_score: number
          california_compliant: boolean
          created_at: string
          insurance_ready: boolean
          note_id: string
          session_date: string
          signed_at: string
          therapist_name: string
        }[]
      }
      get_sessions_optimized: {
        Args: {
          p_client_id?: string
          p_end_date: string
          p_start_date: string
          p_therapist_id?: string
        }
        Returns: {
          session_data: Json
        }[]
      }
      get_sessions_report:
        | {
            Args: {
              p_client_id?: string
              p_end_date: string
              p_start_date: string
              p_status?: string
              p_therapist_id?: string
            }
            Returns: {
              client_id: string
              client_name: string
              end_time: string
              id: string
              notes: string
              start_time: string
              status: string
              therapist_id: string
              therapist_name: string
            }[]
          }
        | {
            Args: {
              p_client_id?: string
              p_end_date: string
              p_start_date: string
              p_status?: string
              p_therapist_id?: string
            }
            Returns: {
              client_id: string
              client_name: string
              created_at: string
              end_time: string
              id: string
              notes: string
              start_time: string
              status: string
              therapist_id: string
              therapist_name: string
            }[]
          }
        | {
            Args: { end_date?: string; start_date?: string }
            Returns: {
              client_name: string
              session_date: string
              session_id: string
              session_type: string
              status: string
              therapist_name: string
            }[]
          }
      get_system_alerts: {
        Args: { p_limit?: number }
        Returns: {
          alert_type: string
          created_at: string
          current_value: number
          id: string
          message: string
          metric_name: string
          resolved: boolean
          threshold_value: number
        }[]
      }
      get_therapist_metrics:
        | {
            Args: { p_end_date: string; p_start_date: string }
            Returns: {
              active_therapists: number
              avg_sessions_per_therapist: number
              therapists_by_service_type: Json
              therapists_by_specialty: Json
              total_therapists: number
              utilization_rate: number
            }[]
          }
        | {
            Args: { p_end_date: string; p_start_date: string }
            Returns: {
              active_therapists: number
              inactive_therapists: number
              service_types: Json
              sessions_per_therapist: Json
              specialties: Json
              total_therapists: number
            }[]
          }
      get_user_role_from_junction: {
        Args: { p_user_id: string }
        Returns: Database["public"]["Enums"]["role_type"]
      }
      get_user_roles: { Args: { p_user_id?: string }; Returns: Json }
      get_user_therapist_id: { Args: never; Returns: string }
      insert_session_with_billing: {
        Args: {
          p_cpt_code: string
          p_modifiers?: string[]
          p_session: Json
          p_session_id?: string
        }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_valid_email: { Args: { email: string }; Returns: boolean }
      is_valid_url: { Args: { url: string }; Returns: boolean }
      log_ai_performance:
        | {
            Args: {
              p_cache_hit?: boolean
              p_conversation_id?: string
              p_error_occurred?: boolean
              p_function_called?: string
              p_response_time_ms: number
              p_token_usage?: Json
              p_user_id?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              function_name: string
              parameters: Json
              response_time: unknown
              token_count: number
            }
            Returns: undefined
          }
        | {
            Args: {
              p_cache_hit?: boolean
              p_conversation_id?: string
              p_error_occurred?: boolean
              p_function_called?: string
              p_response_time_ms: number
              p_token_usage?: Json
              p_user_id?: string
            }
            Returns: undefined
          }
      log_db_performance:
        | {
            Args: {
              p_cache_hit?: boolean
              p_execution_time_ms: number
              p_query_type: string
              p_rows_affected?: number
              p_table_name?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              execution_time: unknown
              query_name: string
              query_text: string
            }
            Returns: undefined
          }
      log_error_event: { Args: { payload: Json }; Returns: undefined }
      log_function_performance:
        | {
            Args: {
              p_execution_time_ms: number
              p_function_name: string
              p_parameters?: Json
              p_result_size?: number
            }
            Returns: undefined
          }
        | {
            Args: {
              p_duration_ms: number
              p_function_name: string
              p_result_size_kb?: number
            }
            Returns: undefined
          }
      manage_admin_users: {
        Args: {
          caller_organization_id: string
          operation: string
          target_user_id: string
        }
        Returns: undefined
      }
      process_client_document: {
        Args: {
          p_client_id: string
          p_document_type: string
          p_file_name: string
          p_file_path: string
          p_file_size: number
          p_file_type: string
        }
        Returns: Json
      }
      prune_admin_actions: {
        Args: { retention_days?: number }
        Returns: number
      }
      prune_session_transcripts: {
        Args: { retention_days?: number }
        Returns: {
          deleted_segments: number
          deleted_transcripts: number
        }[]
      }
      remove_user_role: {
        Args: { removed_by_uuid?: string; role_name: string; user_uuid: string }
        Returns: boolean
      }
      resolve_performance_alert: {
        Args: { p_alert_id: string; p_resolution_note?: string }
        Returns: boolean
      }
      temp_validate_time: { Args: never; Returns: undefined }
      update_client_documents: {
        Args: { p_client_id: string; p_documents: Json }
        Returns: undefined
      }
      user_has_any_role: {
        Args: { role_names: string[]; user_uuid?: string }
        Returns: boolean
      }
      user_has_role:
        | { Args: { role_name: string; user_uuid?: string }; Returns: boolean }
        | { Args: { role_name: string }; Returns: boolean }
      validate_feature_flag_metadata: { Args: { obj: Json }; Returns: boolean }
      validate_organization_metadata: { Args: { obj: Json }; Returns: boolean }
      validate_performance_improvements: { Args: never; Returns: Json }
      validate_session_note_compliance: {
        Args: { p_note_id: string }
        Returns: Json
      }
      validate_time_interval_new: { Args: { t: string }; Returns: boolean }
    }
    Enums: {
      role_type:
        | "client"
        | "therapist"
        | "staff"
        | "supervisor"
        | "admin"
        | "super_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      role_type: [
        "client",
        "therapist",
        "staff",
        "supervisor",
        "admin",
        "super_admin",
      ],
    },
  },
} as const

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action_details: Json | null
          action_type: string
          admin_user_id: string | null
          created_at: string | null
          id: string
          organization_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action_details?: Json | null
          action_type: string
          admin_user_id?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action_details?: Json | null
          action_type?: string
          admin_user_id?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      admin_invite_tokens: {
        Row: {
          created_at: string
          created_by: string
          email: string
          expires_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["role_type"]
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by: string
          email: string
          expires_at: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["role_type"]
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string
          email?: string
          expires_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["role_type"]
          token_hash?: string
        }
        Relationships: []
      }
      ai_cache: {
        Row: {
          created_at: string | null
          expires_at: string | null
          function_name: string
          hit_count: number | null
          id: string
          input_hash: string
          last_accessed: string | null
          response_data: Json
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          function_name: string
          hit_count?: number | null
          id?: string
          input_hash: string
          last_accessed?: string | null
          response_data: Json
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          function_name?: string
          hit_count?: number | null
          id?: string
          input_hash?: string
          last_accessed?: string | null
          response_data?: Json
        }
        Relationships: []
      }
      ai_performance_metrics: {
        Row: {
          cache_hit: boolean | null
          conversation_id: string | null
          cost_usd: number | null
          error_occurred: boolean | null
          function_called: string | null
          id: string
          response_time_ms: number
          timestamp: string | null
          token_usage: Json | null
          user_id: string | null
        }
        Insert: {
          cache_hit?: boolean | null
          conversation_id?: string | null
          cost_usd?: number | null
          error_occurred?: boolean | null
          function_called?: string | null
          id?: string
          response_time_ms: number
          timestamp?: string | null
          token_usage?: Json | null
          user_id?: string | null
        }
        Update: {
          cache_hit?: boolean | null
          conversation_id?: string | null
          cost_usd?: number | null
          error_occurred?: boolean | null
          function_called?: string | null
          id?: string
          response_time_ms?: number
          timestamp?: string | null
          token_usage?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_processing_logs: {
        Row: {
          api_provider: string | null
          confidence_score: number | null
          created_at: string | null
          error_message: string | null
          id: string
          input_data_size: number | null
          model_version: string | null
          processing_time_ms: number | null
          processing_type: string
          session_id: string
        }
        Insert: {
          api_provider?: string | null
          confidence_score?: number | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          input_data_size?: number | null
          model_version?: string | null
          processing_time_ms?: number | null
          processing_type: string
          session_id: string
        }
        Update: {
          api_provider?: string | null
          confidence_score?: number | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          input_data_size?: number | null
          model_version?: string | null
          processing_time_ms?: number | null
          processing_type?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_processing_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_response_cache: {
        Row: {
          cache_key: string
          created_at: string | null
          expires_at: string
          hit_count: number | null
          id: string
          last_hit_at: string | null
          metadata: Json | null
          query_hash: string | null
          query_text: string
          response_text: string
          updated_at: string | null
        }
        Insert: {
          cache_key: string
          created_at?: string | null
          expires_at: string
          hit_count?: number | null
          id?: string
          last_hit_at?: string | null
          metadata?: Json | null
          query_hash?: string | null
          query_text: string
          response_text: string
          updated_at?: string | null
        }
        Update: {
          cache_key?: string
          created_at?: string | null
          expires_at?: string
          hit_count?: number | null
          id?: string
          last_hit_at?: string | null
          metadata?: Json | null
          query_hash?: string | null
          query_text?: string
          response_text?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_session_notes: {
        Row: {
          ai_confidence_score: number | null
          ai_generated_summary: string | null
          behavioral_observations: Json | null
          california_compliant: boolean | null
          client_id: string
          client_responses: Json | null
          created_at: string | null
          current_clinical_status: string | null
          data_collection_summary: Json | null
          end_time: string
          id: string
          insurance_ready: boolean | null
          interventions_used: Json | null
          location: string | null
          manual_edits: string[] | null
          participants: string[] | null
          progress_toward_goals: Json | null
          recommendations: string[] | null
          session_date: string
          session_duration: number
          session_id: string
          signature: string | null
          signed_at: string | null
          start_time: string
          targeted_goals: Json | null
          therapist_id: string
          updated_at: string | null
        }
        Insert: {
          ai_confidence_score?: number | null
          ai_generated_summary?: string | null
          behavioral_observations?: Json | null
          california_compliant?: boolean | null
          client_id: string
          client_responses?: Json | null
          created_at?: string | null
          current_clinical_status?: string | null
          data_collection_summary?: Json | null
          end_time: string
          id?: string
          insurance_ready?: boolean | null
          interventions_used?: Json | null
          location?: string | null
          manual_edits?: string[] | null
          participants?: string[] | null
          progress_toward_goals?: Json | null
          recommendations?: string[] | null
          session_date: string
          session_duration: number
          session_id: string
          signature?: string | null
          signed_at?: string | null
          start_time: string
          targeted_goals?: Json | null
          therapist_id: string
          updated_at?: string | null
        }
        Update: {
          ai_confidence_score?: number | null
          ai_generated_summary?: string | null
          behavioral_observations?: Json | null
          california_compliant?: boolean | null
          client_id?: string
          client_responses?: Json | null
          created_at?: string | null
          current_clinical_status?: string | null
          data_collection_summary?: Json | null
          end_time?: string
          id?: string
          insurance_ready?: boolean | null
          interventions_used?: Json | null
          location?: string | null
          manual_edits?: string[] | null
          participants?: string[] | null
          progress_toward_goals?: Json | null
          recommendations?: string[] | null
          session_date?: string
          session_duration?: number
          session_id?: string
          signature?: string | null
          signed_at?: string | null
          start_time?: string
          targeted_goals?: Json | null
          therapist_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_session_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_session_notes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_session_notes_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      authorization_services: {
        Row: {
          approved_units: number | null
          authorization_id: string
          created_at: string | null
          decision_status: string
          from_date: string
          id: string
          requested_units: number
          service_code: string
          service_description: string
          to_date: string
          unit_type: string
          updated_at: string | null
        }
        Insert: {
          approved_units?: number | null
          authorization_id: string
          created_at?: string | null
          decision_status?: string
          from_date: string
          id?: string
          requested_units: number
          service_code: string
          service_description: string
          to_date: string
          unit_type: string
          updated_at?: string | null
        }
        Update: {
          approved_units?: number | null
          authorization_id?: string
          created_at?: string | null
          decision_status?: string
          from_date?: string
          id?: string
          requested_units?: number
          service_code?: string
          service_description?: string
          to_date?: string
          unit_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "authorization_services_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      authorizations: {
        Row: {
          authorization_number: string
          client_id: string
          created_at: string | null
          diagnosis_code: string
          diagnosis_description: string | null
          end_date: string
          id: string
          insurance_provider_id: string | null
          provider_id: string
          start_date: string
          status: string
          updated_at: string | null
        }
        Insert: {
          authorization_number: string
          client_id: string
          created_at?: string | null
          diagnosis_code: string
          diagnosis_description?: string | null
          end_date: string
          id?: string
          insurance_provider_id?: string | null
          provider_id: string
          start_date: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          authorization_number?: string
          client_id?: string
          created_at?: string | null
          diagnosis_code?: string
          diagnosis_description?: string | null
          end_date?: string
          id?: string
          insurance_provider_id?: string | null
          provider_id?: string
          start_date?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "authorizations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authorizations_insurance_provider_id_fkey"
            columns: ["insurance_provider_id"]
            isOneToOne: false
            referencedRelation: "insurance_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authorizations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      behavioral_patterns: {
        Row: {
          aba_terminology: string | null
          confidence_weight: number | null
          created_at: string | null
          confidence_weight: number | null
          id: string
          is_active: boolean | null
          organization_id: string | null
          pattern_name: string
          pattern_type: string
          regex_pattern: string
          updated_at: string | null
        }
        Insert: {
          aba_terminology?: string | null
          confidence_weight?: number | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          pattern_name: string
          pattern_type: string
          regex_pattern: string
          updated_at?: string | null
        }
        Update: {
          aba_terminology?: string | null
          confidence_weight?: number | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          pattern_name?: string
          pattern_type?: string
          regex_pattern?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      billing_modifiers: {
        Row: {
          billing_note: string | null
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          billing_note?: string | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          billing_note?: string | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      billing_records: {
        Row: {
          amount: number
          claim_number: string | null
          created_at: string | null
          id: string
          organization_id: string | null
          session_id: string
          status: string
          submitted_at: string | null
        }
        Insert: {
          amount: number
          claim_number?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          session_id: string
          status?: string
          submitted_at?: string | null
        }
        Update: {
          amount?: number
          claim_number?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          session_id?: string
          status?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_history: {
        Row: {
          action_data: Json | null
          action_type: string | null
          content: string
          context: Json | null
          conversation_id: string
          created_at: string | null
          id: string
          role: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          action_data?: Json | null
          action_type?: string | null
          content: string
          context?: Json | null
          conversation_id?: string
          created_at?: string | null
          id?: string
          role: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          action_data?: Json | null
          action_type?: string | null
          content?: string
          context?: Json | null
          conversation_id?: string
          created_at?: string | null
          id?: string
          role?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      client_availability: {
        Row: {
          client_id: string
          created_at: string | null
          day_of_week: string
          end_time: string
          id: string
          is_recurring: boolean | null
          location_preference: string[] | null
          start_time: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          day_of_week: string
          end_time: string
          id?: string
          is_recurring?: boolean | null
          location_preference?: string[] | null
          start_time: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          day_of_week?: string
          end_time?: string
          id?: string
          is_recurring?: boolean | null
          location_preference?: string[] | null
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_availability_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          authorized_hours_per_month: number | null
          availability_hours: Json | null
          avoid_rush_hour: boolean | null
          cin_number: string | null
          city: string | null
          client_id: string | null
          created_at: string | null
          created_by: string | null
          date_of_birth: string | null
          daycare_after_school: boolean | null
          deleted_at: string | null
          deleted_by: string | null
          diagnosis: string[] | null
          documents: Json | null
          email: string | null
          first_name: string | null
          full_name: string
          gender: string | null
          hours_provided_per_month: number | null
          id: string
          in_clinic: boolean | null
          in_home: boolean | null
          in_school: boolean | null
          insurance_info: Json | null
          last_name: string | null
          latitude: number | null
          longitude: number | null
          max_travel_minutes: number | null
          middle_name: string | null
          notes: string | null
          one_to_one_units: number | null
          organization_id: string | null
          parent_consult_units: number | null
          parent1_email: string | null
          parent1_first_name: string | null
          parent1_last_name: string | null
          parent1_phone: string | null
          parent1_relationship: string | null
          parent2_email: string | null
          parent2_first_name: string | null
          parent2_last_name: string | null
          parent2_phone: string | null
          parent2_relationship: string | null
          phone: string | null
          preferred_language: string | null
          preferred_radius_km: number | null
          preferred_session_time: string[] | null
          referral_source: string | null
          service_preference: string[] | null
          state: string | null
          status: string
          supervision_units: number | null
          unscheduled_hours: number | null
          updated_at: string
          updated_by: string | null
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          authorized_hours_per_month?: number | null
          availability_hours?: Json | null
          avoid_rush_hour?: boolean | null
          cin_number?: string | null
          city?: string | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_birth?: string | null
          daycare_after_school?: boolean | null
          deleted_at?: string | null
          deleted_by?: string | null
          diagnosis?: string[] | null
          documents?: Json | null
          email?: string | null
          first_name?: string | null
          full_name: string
          gender?: string | null
          hours_provided_per_month?: number | null
          id?: string
          in_clinic?: boolean | null
          in_home?: boolean | null
          in_school?: boolean | null
          insurance_info?: Json | null
          last_name?: string | null
          latitude?: number | null
          longitude?: number | null
          max_travel_minutes?: number | null
          middle_name?: string | null
          notes?: string | null
          one_to_one_units?: number | null
          organization_id?: string | null
          parent_consult_units?: number | null
          parent1_email?: string | null
          parent1_first_name?: string | null
          parent1_last_name?: string | null
          parent1_phone?: string | null
          parent1_relationship?: string | null
          parent2_email?: string | null
          parent2_first_name?: string | null
          parent2_last_name?: string | null
          parent2_phone?: string | null
          parent2_relationship?: string | null
          phone?: string | null
          preferred_language?: string | null
          preferred_radius_km?: number | null
          preferred_session_time?: string[] | null
          referral_source?: string | null
          service_preference?: string[] | null
          state?: string | null
          status?: string
          supervision_units?: number | null
          unscheduled_hours?: number | null
          updated_at?: string
          updated_by?: string | null
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          authorized_hours_per_month?: number | null
          availability_hours?: Json | null
          avoid_rush_hour?: boolean | null
          cin_number?: string | null
          city?: string | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_birth?: string | null
          daycare_after_school?: boolean | null
          deleted_at?: string | null
          deleted_by?: string | null
          diagnosis?: string[] | null
          documents?: Json | null
          email?: string | null
          first_name?: string | null
          full_name?: string
          gender?: string | null
          hours_provided_per_month?: number | null
          id?: string
          in_clinic?: boolean | null
          in_home?: boolean | null
          in_school?: boolean | null
          insurance_info?: Json | null
          last_name?: string | null
          latitude?: number | null
          longitude?: number | null
          max_travel_minutes?: number | null
          middle_name?: string | null
          notes?: string | null
          one_to_one_units?: number | null
          organization_id?: string | null
          parent_consult_units?: number | null
          parent1_email?: string | null
          parent1_first_name?: string | null
          parent1_last_name?: string | null
          parent1_phone?: string | null
          parent1_relationship?: string | null
          parent2_email?: string | null
          parent2_first_name?: string | null
          parent2_last_name?: string | null
          parent2_phone?: string | null
          parent2_relationship?: string | null
          phone?: string | null
          preferred_language?: string | null
          preferred_radius_km?: number | null
          preferred_session_time?: string[] | null
          referral_source?: string | null
          service_preference?: string[] | null
          state?: string | null
          status?: string
          supervision_units?: number | null
          unscheduled_hours?: number | null
          updated_at?: string
          updated_by?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "clients_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "clients_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      company_settings: {
        Row: {
          accent_color: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          company_name: string
          created_at: string | null
          date_format: string | null
          default_currency: string | null
          email: string | null
          fax: string | null
          id: string
          legal_name: string | null
          logo_url: string | null
          medicaid_provider_id: string | null
          npi_number: string | null
          phone: string | null
          primary_color: string | null
          session_duration_default: number | null
          state: string | null
          tax_id: string | null
          time_format: string | null
          time_zone: string | null
          updated_at: string | null
          website: string | null
          zip_code: string | null
        }
        Insert: {
          accent_color?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          company_name: string
          created_at?: string | null
          date_format?: string | null
          default_currency?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          legal_name?: string | null
          logo_url?: string | null
          medicaid_provider_id?: string | null
          npi_number?: string | null
          phone?: string | null
          primary_color?: string | null
          session_duration_default?: number | null
          state?: string | null
          tax_id?: string | null
          time_format?: string | null
          time_zone?: string | null
          updated_at?: string | null
          website?: string | null
          zip_code?: string | null
        }
        Update: {
          accent_color?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          company_name?: string
          created_at?: string | null
          date_format?: string | null
          default_currency?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          legal_name?: string | null
          logo_url?: string | null
          medicaid_provider_id?: string | null
          npi_number?: string | null
          phone?: string | null
          primary_color?: string | null
          session_duration_default?: number | null
          state?: string | null
          tax_id?: string | null
          time_format?: string | null
          time_zone?: string | null
          updated_at?: string | null
          website?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          title: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      cpt_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          long_description: string | null
          service_setting: string | null
          short_description: string
          typical_duration_minutes: number | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          long_description?: string | null
          service_setting?: string | null
          short_description: string
          typical_duration_minutes?: number | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          long_description?: string | null
          service_setting?: string | null
          short_description?: string
          typical_duration_minutes?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      db_performance_metrics: {
        Row: {
          cache_hit: boolean | null
          execution_time_ms: number
          id: string
          query_type: string
          rows_affected: number | null
          slow_query: boolean | null
          table_name: string | null
          timestamp: string | null
        }
        Insert: {
          cache_hit?: boolean | null
          execution_time_ms: number
          id?: string
          query_type: string
          rows_affected?: number | null
          slow_query?: boolean | null
          table_name?: string | null
          timestamp?: string | null
        }
        Update: {
          cache_hit?: boolean | null
          execution_time_ms?: number
          id?: string
          query_type?: string
          rows_affected?: number | null
          slow_query?: boolean | null
          table_name?: string | null
          timestamp?: string | null
        }
        Relationships: []
      }
      error_logs: {
        Row: {
          context: Json | null
          created_at: string | null
          details: Json | null
          error_type: string
          id: string
          message: string
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          session_id: string | null
          severity: string | null
          stack_trace: string | null
          updated_at: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string | null
          details?: Json | null
          error_type: string
          id?: string
          message: string
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string | null
          severity?: string | null
          stack_trace?: string | null
          updated_at?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string | null
          details?: Json | null
          error_type?: string
          id?: string
          message?: string
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string | null
          severity?: string | null
          stack_trace?: string | null
          updated_at?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_logs_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_logs_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "error_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      feature_flag_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          feature_flag_id: string | null
          id: string
          new_state: Json | null
          organization_id: string | null
          plan_code: string | null
          previous_state: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          feature_flag_id?: string | null
          id?: string
          new_state?: Json | null
          organization_id?: string | null
          plan_code?: string | null
          previous_state?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          feature_flag_id?: string | null
          id?: string
          new_state?: Json | null
          organization_id?: string | null
          plan_code?: string | null
          previous_state?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flag_audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flag_audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "feature_flag_audit_logs_feature_flag_id_fkey"
            columns: ["feature_flag_id"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flag_audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flag_audit_logs_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          created_by: string | null
          default_enabled: boolean
          description: string | null
          flag_key: string
          id: string
          metadata: Json | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_enabled?: boolean
          description?: string | null
          flag_key: string
          id?: string
          metadata?: Json | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_enabled?: boolean
          description?: string | null
          flag_key?: string
          id?: string
          metadata?: Json | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "feature_flags_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flags_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      file_cabinet_settings: {
        Row: {
          allowed_file_types: string[] | null
          category_name: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          max_file_size_mb: number | null
          requires_signature: boolean | null
          retention_period_days: number | null
          updated_at: string | null
        }
        Insert: {
          allowed_file_types?: string[] | null
          category_name: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_file_size_mb?: number | null
          requires_signature?: boolean | null
          retention_period_days?: number | null
          updated_at?: string | null
        }
        Update: {
          allowed_file_types?: string[] | null
          category_name?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_file_size_mb?: number | null
          requires_signature?: boolean | null
          retention_period_days?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      function_performance_logs: {
        Row: {
          executed_at: string | null
          executed_by: string | null
          execution_time_ms: number
          function_name: string
          id: string
          parameters: Json | null
          result_size: number | null
        }
        Insert: {
          executed_at?: string | null
          executed_by?: string | null
          execution_time_ms: number
          function_name: string
          id?: string
          parameters?: Json | null
          result_size?: number | null
        }
        Update: {
          executed_at?: string | null
          executed_by?: string | null
          execution_time_ms?: number
          function_name?: string
          id?: string
          parameters?: Json | null
          result_size?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "function_performance_logs_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "function_performance_logs_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      guardian_link_queue: {
        Row: {
          approved_client_ids: string[] | null
          created_at: string
          created_by: string | null
          guardian_email: string
          guardian_id: string
          id: string
          invite_token: string | null
          metadata: Json
          organization_id: string | null
          processed_at: string | null
          processed_by: string | null
          requested_client_ids: string[] | null
          resolution_notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_client_ids?: string[] | null
          created_at?: string
          created_by?: string | null
          guardian_email: string
          guardian_id: string
          id?: string
          invite_token?: string | null
          metadata?: Json
          organization_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          requested_client_ids?: string[] | null
          resolution_notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_client_ids?: string[] | null
          created_at?: string
          created_by?: string | null
          guardian_email?: string
          guardian_id?: string
          id?: string
          invite_token?: string | null
          metadata?: Json
          organization_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          requested_client_ids?: string[] | null
          resolution_notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_link_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      impersonation_audit: {
        Row: {
          actor_ip: unknown | null
          actor_organization_id: string
          actor_user_agent: string | null
          actor_user_id: string
          created_at: string
          expires_at: string
          id: string
          issued_at: string
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          target_organization_id: string
          target_user_id: string
          token_jti: string
        }
        Insert: {
          actor_ip?: unknown | null
          actor_organization_id: string
          actor_user_agent?: string | null
          actor_user_id: string
          created_at?: string
          expires_at: string
          id?: string
          issued_at?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          target_organization_id: string
          target_user_id: string
          token_jti: string
        }
        Update: {
          actor_ip?: unknown | null
          actor_organization_id?: string
          actor_user_agent?: string | null
          actor_user_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          issued_at?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          target_organization_id?: string
          target_user_id?: string
          token_jti?: string
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_audit_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_audit_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "impersonation_audit_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_audit_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "impersonation_audit_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_audit_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      impersonation_revocation_queue: {
        Row: {
          audit_id: string
          created_at: string
          error: string | null
          id: string
          processed_at: string | null
          token_jti: string
        }
        Insert: {
          audit_id: string
          created_at?: string
          error?: string | null
          id?: string
          processed_at?: string | null
          token_jti: string
        }
        Update: {
          audit_id?: string
          created_at?: string
          error?: string | null
          id?: string
          processed_at?: string | null
          token_jti?: string
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_revocation_queue_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "impersonation_audit"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_providers: {
        Row: {
          contact_phone: string | null
          created_at: string | null
          fax: string | null
          id: string
          name: string
          type: string
          updated_at: string | null
          website: string | null
        }
        Insert: {
          contact_phone?: string | null
          created_at?: string | null
          fax?: string | null
          id?: string
          name: string
          type: string
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          contact_phone?: string | null
          created_at?: string | null
          fax?: string | null
          id?: string
          name?: string
          type?: string
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      locations: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          created_at: string | null
          email: string | null
          fax: string | null
          id: string
          is_active: boolean | null
          name: string
          operating_hours: Json | null
          phone: string | null
          state: string | null
          type: string
          updated_at: string | null
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          operating_hours?: Json | null
          phone?: string | null
          state?: string | null
          type: string
          updated_at?: string | null
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          operating_hours?: Json | null
          phone?: string | null
          state?: string | null
          type?: string
          updated_at?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      organization_feature_flags: {
        Row: {
          created_at: string
          created_by: string | null
          feature_flag_id: string
          id: string
          is_enabled: boolean
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          feature_flag_id: string
          id?: string
          is_enabled?: boolean
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          feature_flag_id?: string
          id?: string
          is_enabled?: boolean
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_feature_flags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_feature_flags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "organization_feature_flags_feature_flag_id_fkey"
            columns: ["feature_flag_id"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_feature_flags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_feature_flags_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_feature_flags_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      organization_plans: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          notes: string | null
          organization_id: string
          plan_code: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          notes?: string | null
          organization_id: string
          plan_code: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          notes?: string | null
          organization_id?: string
          plan_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_plans_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_plans_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "organization_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_plans_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          metadata: Json | null
          name: string | null
          slug: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id: string
          metadata?: Json | null
          name?: string | null
          slug?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          slug?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "organizations_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      performance_alerts: {
        Row: {
          alert_type: string
          created_at: string | null
          current_value: number
          escalated: boolean | null
          id: string
          message: string
          metric_name: string
          resolved: boolean | null
          resolved_at: string | null
          threshold_value: number
        }
        Insert: {
          alert_type: string
          created_at?: string | null
          current_value: number
          escalated?: boolean | null
          id?: string
          message: string
          metric_name: string
          resolved?: boolean | null
          resolved_at?: string | null
          threshold_value: number
        }
        Update: {
          alert_type?: string
          created_at?: string | null
          current_value?: number
          escalated?: boolean | null
          id?: string
          message?: string
          metric_name?: string
          resolved?: boolean | null
          resolved_at?: string | null
          threshold_value?: number
        }
        Relationships: []
      }
      performance_baselines: {
        Row: {
          baseline_value: number
          confidence_level: number
          created_at: string
          critical_threshold: number
          id: string
          is_active: boolean | null
          measured_at: string
          metric_name: string
          sample_size: number
          updated_at: string
          warning_threshold: number
        }
        Insert: {
          baseline_value: number
          confidence_level: number
          created_at?: string
          critical_threshold: number
          id: string
          is_active?: boolean | null
          measured_at: string
          metric_name: string
          sample_size: number
          updated_at?: string
          warning_threshold: number
        }
        Update: {
          baseline_value?: number
          confidence_level?: number
          created_at?: string
          critical_threshold?: number
          id?: string
          is_active?: boolean | null
          measured_at?: string
          metric_name?: string
          sample_size?: number
          updated_at?: string
          warning_threshold?: number
        }
        Relationships: []
      }
      plans: {
        Row: {
          code: string
          created_at: string
          description: string | null
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          first_name: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          last_login_at: string | null
          last_name: string | null
          phone: string | null
          preferences: Json | null
          role: Database["public"]["Enums"]["role_type"]
          time_zone: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          first_name?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          phone?: string | null
          preferences?: Json | null
          role?: Database["public"]["Enums"]["role_type"]
          time_zone?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          phone?: string | null
          preferences?: Json | null
          role?: Database["public"]["Enums"]["role_type"]
          time_zone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      referring_providers: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          created_at: string | null
          credentials: string[] | null
          email: string | null
          facility_name: string | null
          fax: string | null
          first_name: string
          id: string
          is_active: boolean | null
          last_name: string
          npi_number: string | null
          phone: string | null
          specialty: string | null
          state: string | null
          updated_at: string | null
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string | null
          credentials?: string[] | null
          email?: string | null
          facility_name?: string | null
          fax?: string | null
          first_name: string
          id?: string
          is_active?: boolean | null
          last_name: string
          npi_number?: string | null
          phone?: string | null
          specialty?: string | null
          state?: string | null
          updated_at?: string | null
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string | null
          credentials?: string[] | null
          email?: string | null
          facility_name?: string | null
          fax?: string | null
          first_name?: string
          id?: string
          is_active?: boolean | null
          last_name?: string
          npi_number?: string | null
          phone?: string | null
          specialty?: string | null
          state?: string | null
          updated_at?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      roles: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_system_role: boolean | null
          name: string
          permissions: Json | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_system_role?: boolean | null
          name: string
          permissions?: Json | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_system_role?: boolean | null
          name?: string
          permissions?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      scheduling_preferences: {
        Row: {
          avoid_highways: boolean | null
          created_at: string | null
          end_location: string | null
          id: string
          max_consecutive_sessions: number | null
          max_daily_hours: number | null
          min_break_minutes: number | null
          preferred_break_minutes: number | null
          start_location: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          avoid_highways?: boolean | null
          created_at?: string | null
          end_location?: string | null
          id?: string
          max_consecutive_sessions?: number | null
          max_daily_hours?: number | null
          min_break_minutes?: number | null
          preferred_break_minutes?: number | null
          start_location?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          avoid_highways?: boolean | null
          created_at?: string | null
          end_location?: string | null
          id?: string
          max_consecutive_sessions?: number | null
          max_daily_hours?: number | null
          min_break_minutes?: number | null
          preferred_break_minutes?: number | null
          start_location?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      service_areas: {
        Row: {
          center_latitude: number
          center_longitude: number
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          radius_km: number
          updated_at: string | null
        }
        Insert: {
          center_latitude: number
          center_longitude: number
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          radius_km: number
          updated_at?: string | null
        }
        Update: {
          center_latitude?: number
          center_longitude?: number
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          radius_km?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      service_lines: {
        Row: {
          available_locations: string[] | null
          billable: boolean | null
          code: string | null
          created_at: string | null
          description: string | null
          documentation_required: boolean | null
          id: string
          is_active: boolean | null
          name: string
          rate_per_hour: number | null
          requires_authorization: boolean | null
          updated_at: string | null
        }
        Insert: {
          available_locations?: string[] | null
          billable?: boolean | null
          code?: string | null
          created_at?: string | null
          description?: string | null
          documentation_required?: boolean | null
          id?: string
          is_active?: boolean | null
          name: string
          rate_per_hour?: number | null
          requires_authorization?: boolean | null
          updated_at?: string | null
        }
        Update: {
          available_locations?: string[] | null
          billable?: boolean | null
          code?: string | null
          created_at?: string | null
          description?: string | null
          documentation_required?: boolean | null
          id?: string
          is_active?: boolean | null
          name?: string
          rate_per_hour?: number | null
          requires_authorization?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      session_cpt_entries: {
        Row: {
          billed_minutes: number | null
          cpt_code_id: string
          created_at: string
          id: string
          is_primary: boolean
          line_number: number
          notes: string | null
          organization_id: string | null
          rate: number | null
          session_id: string
          units: number
          updated_at: string
        }
        Insert: {
          billed_minutes?: number | null
          cpt_code_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          line_number?: number
          notes?: string | null
          organization_id?: string | null
          rate?: number | null
          session_id: string
          units?: number
          updated_at?: string
        }
        Update: {
          billed_minutes?: number | null
          cpt_code_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          line_number?: number
          notes?: string | null
          organization_id?: string | null
          rate?: number | null
          session_id?: string
          units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_cpt_entries_cpt_code_id_fkey"
            columns: ["cpt_code_id"]
            isOneToOne: false
            referencedRelation: "cpt_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_cpt_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_cpt_modifiers: {
        Row: {
          modifier_id: string
          position: number
          session_cpt_entry_id: string
        }
        Insert: {
          modifier_id: string
          position: number
          session_cpt_entry_id: string
        }
        Update: {
          modifier_id?: string
          position?: number
          session_cpt_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_cpt_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "billing_modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_cpt_modifiers_session_cpt_entry_id_fkey"
            columns: ["session_cpt_entry_id"]
            isOneToOne: false
            referencedRelation: "session_cpt_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      session_holds: {
        Row: {
          client_id: string
          created_at: string
          end_time: string
          expires_at: string
          hold_key: string
          id: string
          organization_id: string
          session_id: string | null
          start_time: string
          therapist_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          end_time: string
          expires_at?: string
          hold_key: string
          id?: string
          organization_id?: string
          session_id?: string | null
          start_time: string
          therapist_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          end_time?: string
          expires_at?: string
          hold_key?: string
          id?: string
          organization_id?: string
          session_id?: string | null
          start_time?: string
          therapist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_holds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_holds_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_holds_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_holds_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      session_note_templates: {
        Row: {
          compliance_requirements: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_california_compliant: boolean | null
          organization_id: string | null
          template_name: string
          template_structure: Json
          template_type: string
          updated_at: string | null
        }
        Insert: {
          compliance_requirements?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_california_compliant?: boolean | null
          organization_id?: string | null
          template_name: string
          template_structure: Json
          template_type: string
          updated_at?: string | null
        }
        Update: {
          compliance_requirements?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_california_compliant?: boolean | null
          organization_id?: string | null
          template_name?: string
          template_structure?: Json
          template_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      session_transcript_segments: {
        Row: {
          behavioral_markers: Json | null
          confidence: number | null
          created_at: string | null
          end_time: number
          id: string
          organization_id: string | null
          session_id: string
          speaker: string
          start_time: number
          text: string
        }
        Insert: {
          behavioral_markers?: Json | null
          confidence?: number | null
          created_at?: string | null
          end_time: number
          id?: string
          organization_id?: string | null
          session_id: string
          speaker: string
          start_time: number
          text: string
        }
        Update: {
          behavioral_markers?: Json | null
          confidence?: number | null
          created_at?: string | null
          end_time?: number
          id?: string
          organization_id?: string | null
          session_id?: string
          speaker?: string
          start_time?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_transcript_segments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_transcripts: {
        Row: {
          confidence_score: number | null
          created_at: string | null
          id: string
          organization_id: string | null
          processed_transcript: string
          raw_transcript: string
          session_id: string
          updated_at: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          processed_transcript: string
          raw_transcript: string
          session_id: string
          updated_at?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          processed_transcript?: string
          raw_transcript?: string
          session_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_transcripts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          client_id: string
          created_at: string | null
          duration_minutes: number | null
          end_time: string
          has_transcription_consent: boolean
          id: string
          location_type: string | null
          notes: string | null
          organization_id: string | null
          rate_per_hour: number | null
          session_type: string | null
          start_time: string
          status: string
          therapist_id: string
          total_cost: number | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          duration_minutes?: number | null
          end_time: string
          has_transcription_consent?: boolean
          id?: string
          location_type?: string | null
          notes?: string | null
          organization_id?: string | null
          rate_per_hour?: number | null
          session_type?: string | null
          start_time: string
          status?: string
          therapist_id: string
          total_cost?: number | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          duration_minutes?: number | null
          end_time?: string
          has_transcription_consent?: boolean
          id?: string
          location_type?: string | null
          notes?: string | null
          organization_id?: string | null
          rate_per_hour?: number | null
          session_type?: string | null
          start_time?: string
          status?: string
          therapist_id?: string
          total_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      system_performance_metrics: {
        Row: {
          id: string
          metric_type: string
          threshold_breached: boolean | null
          timestamp: string | null
          unit: string
          value: number
        }
        Insert: {
          id?: string
          metric_type: string
          threshold_breached?: boolean | null
          timestamp?: string | null
          unit: string
          value: number
        }
        Update: {
          id?: string
          metric_type?: string
          threshold_breached?: boolean | null
          timestamp?: string | null
          unit?: string
          value?: number
        }
        Relationships: []
      }
      therapist_availability: {
        Row: {
          created_at: string | null
          day_of_week: string
          end_time: string
          id: string
          is_recurring: boolean | null
          organization_id: string
          service_types: string[] | null
          start_time: string
          therapist_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: string
          end_time: string
          id?: string
          is_recurring?: boolean | null
          organization_id: string
          service_types?: string[] | null
          start_time: string
          therapist_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: string
          end_time?: string
          id?: string
          is_recurring?: boolean | null
          organization_id?: string
          service_types?: string[] | null
          start_time?: string
          therapist_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "therapist_availability_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      therapist_certifications: {
        Row: {
          created_at: string | null
          expiry_date: string | null
          file_name: string
          file_size: number
          file_type: string
          file_url: string
          id: string
          issue_date: string
          name: string
          notes: string | null
          organization_id: string
          status: string
          therapist_id: string
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          expiry_date?: string | null
          file_name: string
          file_size: number
          file_type: string
          file_url: string
          id?: string
          issue_date: string
          name: string
          notes?: string | null
          organization_id: string
          status?: string
          therapist_id: string
          type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          expiry_date?: string | null
          file_name?: string
          file_size?: number
          file_type?: string
          file_url?: string
          id?: string
          issue_date?: string
          name?: string
          notes?: string | null
          organization_id?: string
          status?: string
          therapist_id?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "therapist_certifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "therapist_certifications_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      therapists: {
        Row: {
          availability_hours: Json | null
          avoid_rush_hour: boolean | null
          bcba_number: string | null
          city: string | null
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          email: string
          employee_type: string | null
          facility: string | null
          first_name: string | null
          full_name: string
          id: string
          last_name: string | null
          latitude: number | null
          longitude: number | null
          max_clients: number | null
          max_daily_travel_minutes: number | null
          medicaid_id: string | null
          middle_name: string | null
          npi_number: string | null
          organization_id: string | null
          phone: string | null
          practitioner_id: string | null
          preferred_areas: string[] | null
          rbt_number: string | null
          service_radius_km: number | null
          service_type: string[] | null
          specialties: string[] | null
          staff_id: string | null
          state: string | null
          status: string | null
          street: string | null
          supervisor: string | null
          taxonomy_code: string | null
          time_zone: string | null
          title: string | null
          weekly_hours_max: number | null
          weekly_hours_min: number | null
          zip_code: string | null
        }
        Insert: {
          availability_hours?: Json | null
          avoid_rush_hour?: boolean | null
          bcba_number?: string | null
          city?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email: string
          employee_type?: string | null
          facility?: string | null
          first_name?: string | null
          full_name: string
          id?: string
          last_name?: string | null
          latitude?: number | null
          longitude?: number | null
          max_clients?: number | null
          max_daily_travel_minutes?: number | null
          medicaid_id?: string | null
          middle_name?: string | null
          npi_number?: string | null
          organization_id?: string | null
          phone?: string | null
          practitioner_id?: string | null
          preferred_areas?: string[] | null
          rbt_number?: string | null
          service_radius_km?: number | null
          service_type?: string[] | null
          specialties?: string[] | null
          staff_id?: string | null
          state?: string | null
          status?: string | null
          street?: string | null
          supervisor?: string | null
          taxonomy_code?: string | null
          time_zone?: string | null
          title?: string | null
          weekly_hours_max?: number | null
          weekly_hours_min?: number | null
          zip_code?: string | null
        }
        Update: {
          availability_hours?: Json | null
          avoid_rush_hour?: boolean | null
          bcba_number?: string | null
          city?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string
          employee_type?: string | null
          facility?: string | null
          first_name?: string | null
          full_name?: string
          id?: string
          last_name?: string | null
          latitude?: number | null
          longitude?: number | null
          max_clients?: number | null
          max_daily_travel_minutes?: number | null
          medicaid_id?: string | null
          middle_name?: string | null
          npi_number?: string | null
          organization_id?: string | null
          phone?: string | null
          practitioner_id?: string | null
          preferred_areas?: string[] | null
          rbt_number?: string | null
          service_radius_km?: number | null
          service_type?: string[] | null
          specialties?: string[] | null
          staff_id?: string | null
          state?: string | null
          status?: string | null
          street?: string | null
          supervisor?: string | null
          taxonomy_code?: string | null
          time_zone?: string | null
          title?: string | null
          weekly_hours_max?: number | null
          weekly_hours_min?: number | null
          zip_code?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          first_name: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          last_login_at: string | null
          last_name: string | null
          phone: string | null
          preferences: Json | null
          time_zone: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          first_name?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          phone?: string | null
          preferences?: Json | null
          time_zone?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          phone?: string | null
          preferences?: Json | null
          time_zone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          expires_at: string | null
          granted_at: string | null
          granted_by: string | null
          id: string
          is_active: boolean | null
          role_id: string
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean | null
          role_id: string
          user_id: string
        }
        Update: {
          expires_at?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          ip_address: unknown | null
          is_active: boolean | null
          last_activity: string | null
          session_token: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          ip_address?: unknown | null
          is_active?: boolean | null
          last_activity?: string | null
          session_token: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          ip_address?: unknown | null
          is_active?: boolean | null
          last_activity?: string | null
          session_token?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_therapist_links: {
        Row: {
          created_at: string
          id: string
          therapist_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          therapist_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          therapist_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_therapist_links_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      admin_users: {
        Row: {
          created_at: string | null
          email: string | null
          id: string | null
          raw_user_meta_data: Json | null
          user_id: string | null
          user_role_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _is_admin: {
        Args: { uid: string }
        Returns: boolean
      }
      ,
      enqueue_impersonation_revocation: {
        Args: { p_audit_id: string; p_token_jti: string }
        Returns: undefined
      }
      ,
      prune_admin_actions: {
        Args: { retention_days?: number }
        Returns: number
      }
      ,
      validate_organization_metadata: {
        Args: { obj: Json }
        Returns: boolean
      }
      ,
      validate_feature_flag_metadata: {
        Args: { obj: Json }
        Returns: boolean
      }
      _is_therapist: {
        Args: { uid: string }
        Returns: boolean
      }
      acquire_session_hold: {
        Args: {
          p_actor_id?: string
          p_client_id: string
          p_end_time: string
          p_hold_seconds?: number
          p_session_id?: string
          p_start_time: string
          p_therapist_id: string
        }
        Returns: Json
      }
      admin_reset_user_password: {
        Args: {
          create_if_not_exists?: boolean
          new_password: string
          user_email: string
        }
        Returns: Json
      }
      analyze_therapist_workload: {
        Args: { p_analysis_period?: number; p_therapist_id?: string }
        Returns: {
          efficiency_score: number
          recommendations: Json
          target_hours: number
          therapist_id: string
          therapist_name: string
          total_hours: number
          utilization_rate: number
          workload_distribution: Json
        }[]
      }
      approve_guardian_request: {
        Args: {
          p_request_id: string
          p_client_ids?: string[] | null
          p_relationship?: string | null
          p_resolution_notes?: string | null
        }
        Returns: {
          approved_client_ids: string[] | null
          guardian_id: string
        }[]
      }
      assign_admin_role: {
        Args: { organization_id: string; reason?: string; user_email: string }
        Returns: undefined
      }
      assign_therapist_role: {
        Args: { therapist_id: string; user_email: string } | { user_id: string }
        Returns: undefined
      }
      assign_user_role: {
        Args: {
          expires_at_param?: string
          granted_by_uuid?: string
          role_name: string
          user_uuid: string
        }
        Returns: boolean
      }
      cache_ai_response: {
        Args: {
          p_cache_key: string
          p_expires_at?: string
          p_metadata?: Json
          p_query_text: string
          p_response_text: string
        }
        Returns: undefined
      }
      calculate_therapist_client_compatibility: {
        Args: { p_client_id: string; p_therapist_id: string }
        Returns: number
      }
      calculate_time_slot_score: {
        Args: {
          p_client_id: string
          p_client_prefs: Json
          p_day_of_week: number
          p_hour_of_day: number
          p_slot_time: string
          p_therapist_id: string
          p_therapist_prefs: Json
        }
        Returns: number
      }
      can_access_client_documents: {
        Args: { client_id: string }
        Returns: boolean
      }
      check_migration_status: {
        Args: Record<PropertyKey, never>
        Returns: {
          applied_at: string
          is_applied: boolean
          migration_name: string
        }[]
      }
      check_performance_thresholds: {
        Args: { p_current_value: number; p_metric_name: string }
        Returns: {
          current_value: number
          metric: string
          severity: string
          status: string
          threshold: number
        }[]
      }
      cleanup_ai_cache: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      cleanup_expired_ai_cache: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      cleanup_performance_data: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      confirm_session_hold: {
        Args: { p_actor_id?: string; p_hold_key: string; p_session: Json }
        Returns: Json
      }
      create_super_admin: {
        Args: { user_email: string }
        Returns: undefined
      }
      detect_scheduling_conflicts: {
        Args: {
          p_end_date: string
          p_include_suggestions?: boolean
          p_start_date: string
        }
        Returns: {
          affected_sessions: Json
          conflict_id: string
          conflict_type: string
          severity: number
          suggested_resolutions: Json
        }[]
      }
      ensure_admin_role: {
        Args: Record<PropertyKey, never> | { user_email: string }
        Returns: undefined
      }
      ensure_all_users_admin: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      ensure_user_has_admin_role: {
        Args: Record<PropertyKey, never> | { p_user_id: string }
        Returns: undefined
      }
      gbt_bit_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_bool_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_bool_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_bpchar_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_bytea_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_cash_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_cash_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_date_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_date_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_decompress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_enum_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_enum_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_float4_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_float4_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_float8_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_float8_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_inet_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_int2_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_int2_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_int4_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_int4_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_int8_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_int8_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_intv_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_intv_decompress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_intv_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_macad_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_macad_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_macad8_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_macad8_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_numeric_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_oid_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_oid_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_text_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_time_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_time_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_timetz_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_ts_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_ts_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_tstz_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_uuid_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_uuid_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_var_decompress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_var_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey_var_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey_var_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey16_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey16_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey2_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey2_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey32_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey32_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey4_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey4_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey8_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey8_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      generate_semantic_cache_key: {
        Args: { p_context_hash?: string; p_query_text: string }
        Returns: string
      }
      generate_workload_recommendations: {
        Args: {
          p_actual_hours: number
          p_session_count: number
          p_target_hours: number
          p_therapist_id: string
        }
        Returns: Json
      }
      get_admin_users: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_ai_cache_metrics: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_alternative_therapists: {
        Args: { p_client_id: string; p_end_time: string; p_start_time: string }
        Returns: Json
      }
      get_alternative_times: {
        Args: {
          p_client_id: string
          p_original_time: string
          p_therapist_id: string
        }
        Returns: Json
      }
      get_authorization_metrics: {
        Args:
          | { p_end_date: string; p_start_date: string }
          | { p_end_date: string; p_start_date: string }
        Returns: {
          approval_rate: number
          approval_ratio: number
          approved_authorizations: number
          denied_authorizations: number
          expired_authorizations: number
          pending_authorizations: number
          total_approved_units: number
          total_authorizations: number
          total_requested_units: number
        }[]
      }
      get_billing_metrics: {
        Args:
          | { p_end_date: string; p_start_date: string }
          | { p_end_date: string; p_start_date: string }
        Returns: {
          amount_by_client: Json
          collection_rate: number
          paid_amount: number
          pending_amount: number
          records_by_status: Json
          rejected_amount: number
          total_billed: number
        }[]
      }
      get_cached_ai_response: {
        Args: { p_cache_key: string }
        Returns: {
          metadata: Json
          response_text: string
        }[]
      }
      get_client_documents: {
        Args: { p_client_id: string }
        Returns: Json
      }
      get_guardian_client_portal: {
        Args: { p_client_id?: string | null }
        Returns: {
          client_date_of_birth: string | null
          client_email: string | null
          client_full_name: string
          client_id: string
          client_phone: string | null
          client_status: string | null
          guardian_is_primary: boolean
          guardian_notes: Json
          guardian_relationship: string | null
          upcoming_sessions: Json
        }[]
      }
      guardian_link_queue_admin_view: {
        Args: { p_organization_id?: string | null; p_status?: string | null }
        Returns: {
          approved_client_ids: string[] | null
          created_at: string
          guardian_email: string
          guardian_id: string
          id: string
          invite_token: string | null
          metadata: Json
          organization_id: string | null
          processed_at: string | null
          processed_by: string | null
          requested_client_ids: string[] | null
          resolution_notes: string | null
          status: string
          updated_at: string
        }[]
      }
      guardian_upcoming_sessions: {
        Args: {
          p_client_id: string
          p_guardian_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      guardian_visible_notes: {
        Args: {
          p_client_id: string
          p_guardian_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      get_client_metrics: {
        Args:
          | Record<PropertyKey, never>
          | { p_end_date: string; p_start_date: string }
          | { p_end_date: string; p_start_date: string }
        Returns: {
          active_clients: number
          activity_rate: number
          clients_by_age: Json
          clients_by_gender: Json
          clients_by_service_preference: Json
          inactive_clients: number
          total_clients: number
        }[]
      }
      get_dashboard_data: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_db_version: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      get_dropdown_data: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_optimal_time_slots: {
        Args: {
          p_client_preferences: Json
          p_date_range?: Json
          p_duration?: number
          p_therapist_preferences: Json
        }
        Returns: {
          availability_data: Json
          optimality_score: number
          reasoning: Json
          suggested_time: string
        }[]
      }
      get_organization_id_from_metadata: {
        Args: { p_metadata: Json }
        Returns: string
      }
      get_performance_metrics: {
        Args: { p_time_range?: string }
        Returns: Json
      }
      get_performance_recommendations: {
        Args: Record<PropertyKey, never>
        Returns: {
          category: string
          difficulty: string
          estimated_improvement: string
          impact: string
          recommendation: string
        }[]
      }
      get_recent_chat_history: {
        Args:
          | { p_conversation_id: string; p_limit?: number }
          | { p_conversation_id: string; p_limit?: number }
        Returns: {
          action_data: Json
          action_type: string
          content: string
          context: Json
          conversation_id: string
          created_at: string
          id: string
          role: string
        }[]
      }
      get_schedule_data_batch: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: Json
      }
      get_session_metrics: {
        Args:
          | {
              p_client_id?: string
              p_end_date: string
              p_start_date: string
              p_therapist_id?: string
            }
          | {
              p_client_id?: string
              p_end_date: string
              p_start_date: string
              p_therapist_id?: string
            }
        Returns: Json
      }
      get_session_notes_with_compliance: {
        Args: { p_client_id: string; p_limit?: number }
        Returns: {
          ai_confidence_score: number
          california_compliant: boolean
          created_at: string
          insurance_ready: boolean
          note_id: string
          session_date: string
          signed_at: string
          therapist_name: string
        }[]
      }
      get_sessions_optimized: {
        Args: {
          p_client_id?: string
          p_end_date: string
          p_start_date: string
          p_therapist_id?: string
        }
        Returns: {
          session_data: Json
        }[]
      }
      get_sessions_report: {
        Args:
          | { end_date?: string; start_date?: string }
          | {
              p_client_id?: string
              p_end_date: string
              p_start_date: string
              p_status?: string
              p_therapist_id?: string
            }
          | {
              p_client_id?: string
              p_end_date: string
              p_start_date: string
              p_status?: string
              p_therapist_id?: string
            }
        Returns: {
          client_id: string
          client_name: string
          end_time: string
          id: string
          notes: string
          start_time: string
          status: string
          therapist_id: string
          therapist_name: string
        }[]
      }
      get_system_alerts: {
        Args: { p_limit?: number }
        Returns: {
          alert_type: string
          created_at: string
          current_value: number
          id: string
          message: string
          metric_name: string
          resolved: boolean
          threshold_value: number
        }[]
      }
      get_therapist_metrics: {
        Args:
          | { p_end_date: string; p_start_date: string }
          | { p_end_date: string; p_start_date: string }
        Returns: {
          active_therapists: number
          avg_sessions_per_therapist: number
          therapists_by_service_type: Json
          therapists_by_specialty: Json
          total_therapists: number
          utilization_rate: number
        }[]
      }
      get_user_role_from_junction: {
        Args: { p_user_id: string }
        Returns: Database["public"]["Enums"]["role_type"]
      }
      get_user_roles: {
        Args: { p_user_id?: string }
        Returns: Json
      }
      get_user_therapist_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      insert_session_with_billing: {
        Args: {
          p_cpt_code: string
          p_modifiers?: string[]
          p_session: Json
          p_session_id?: string
        }
        Returns: Json
      }
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_super_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_valid_email: {
        Args: { email: string }
        Returns: boolean
      }
      is_valid_url: {
        Args: { url: string }
        Returns: boolean
      }
      log_ai_performance: {
        Args:
          | {
              function_name: string
              parameters: Json
              response_time: unknown
              token_count: number
            }
          | {
              p_cache_hit?: boolean
              p_conversation_id?: string
              p_error_occurred?: boolean
              p_function_called?: string
              p_response_time_ms: number
              p_token_usage?: Json
              p_user_id?: string
            }
          | {
              p_cache_hit?: boolean
              p_conversation_id?: string
              p_error_occurred?: boolean
              p_function_called?: string
              p_response_time_ms: number
              p_token_usage?: Json
              p_user_id?: string
            }
        Returns: undefined
      }
      log_db_performance: {
        Args:
          | { execution_time: unknown; query_name: string; query_text: string }
          | {
              p_cache_hit?: boolean
              p_execution_time_ms: number
              p_query_type: string
              p_rows_affected?: number
              p_table_name?: string
            }
        Returns: undefined
      }
      log_function_performance: {
        Args:
          | {
              p_duration_ms: number
              p_function_name: string
              p_result_size_kb?: number
            }
          | {
              p_execution_time_ms: number
              p_function_name: string
              p_parameters?: Json
              p_result_size?: number
            }
        Returns: undefined
      }
      manage_admin_users: {
        Args:
          | { metadata?: Json; operation: string; target_user_id: string }
          | { operation: string; target_user_id: string }
        Returns: undefined
      }
      process_client_document: {
        Args: {
          p_client_id: string
          p_document_type: string
          p_file_name: string
          p_file_path: string
          p_file_size: number
          p_file_type: string
        }
        Returns: Json
      }
      prune_session_transcripts: {
        Args: { retention_days?: number }
        Returns: {
          deleted_segments: number
          deleted_transcripts: number
        }[]
      }
      remove_user_role: {
        Args: { removed_by_uuid?: string; role_name: string; user_uuid: string }
        Returns: boolean
      }
      resolve_performance_alert: {
        Args: { p_alert_id: string; p_resolution_note?: string }
        Returns: boolean
      }
      temp_validate_time: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      update_client_documents: {
        Args: { p_client_id: string; p_documents: Json }
        Returns: undefined
      }
      user_has_any_role: {
        Args: { role_names: string[]; user_uuid?: string }
        Returns: boolean
      }
      user_has_role: {
        Args: { role_name: string } | { role_name: string; user_uuid?: string }
        Returns: boolean
      }
      validate_performance_improvements: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      validate_session_note_compliance: {
        Args: { p_note_id: string }
        Returns: Json
      }
      validate_time_interval_new: {
        Args: { t: string }
        Returns: boolean
      }
    }
    Enums: {
      role_type:
        | "client"
        | "therapist"
        | "staff"
        | "supervisor"
        | "admin"
        | "super_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      role_type: [
        "client",
        "therapist",
        "staff",
        "supervisor",
        "admin",
        "super_admin",
      ],
    },
  },
} as const
