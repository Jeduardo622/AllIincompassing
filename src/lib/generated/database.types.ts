export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
        Relationships: [
          {
            foreignKeyName: "admin_actions_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_actions_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_actions_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_actions_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      admin_invite_tokens: {
        Row: {
          accepted_at: string | null
          accepted_by_user_id: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          organization_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["role_type"]
          target_therapist_id: string | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at: string
          id?: string
          organization_id: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["role_type"]
          target_therapist_id?: string | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          organization_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["role_type"]
          target_therapist_id?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_invite_tokens_accepted_by_user_id_fkey"
            columns: ["accepted_by_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_invite_tokens_accepted_by_user_id_fkey"
            columns: ["accepted_by_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_invite_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_invite_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_invite_tokens_target_therapist_id_fkey"
            columns: ["target_therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_execution_traces: {
        Row: {
          attempt_id: string | null
          conversation_id: string | null
          correlation_id: string
          created_at: string
          id: string
          organization_id: string | null
          payload: Json | null
          replay_payload: Json | null
          request_id: string
          status: string
          step_id: string | null
          step_index: number
          step_name: string
          user_id: string | null
          work_item_id: string | null
        }
        Insert: {
          attempt_id?: string | null
          conversation_id?: string | null
          correlation_id: string
          created_at?: string
          id?: string
          organization_id?: string | null
          payload?: Json | null
          replay_payload?: Json | null
          request_id: string
          status: string
          step_id?: string | null
          step_index?: number
          step_name: string
          user_id?: string | null
          work_item_id?: string | null
        }
        Update: {
          attempt_id?: string | null
          conversation_id?: string | null
          correlation_id?: string
          created_at?: string
          id?: string
          organization_id?: string | null
          payload?: Json | null
          replay_payload?: Json | null
          request_id?: string
          status?: string
          step_id?: string | null
          step_index?: number
          step_name?: string
          user_id?: string | null
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_execution_traces_attempt_id_fkey"
            columns: [
              "attempt_id",
              "step_id",
              "work_item_id",
              "organization_id",
            ]
            isOneToOne: false
            referencedRelation: "agent_work_attempts"
            referencedColumns: [
              "id",
              "step_id",
              "work_item_id",
              "organization_id",
            ]
          },
          {
            foreignKeyName: "agent_execution_traces_step_id_fkey"
            columns: ["step_id", "work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_steps"
            referencedColumns: ["id", "work_item_id", "organization_id"]
          },
          {
            foreignKeyName: "agent_execution_traces_work_item_id_fkey"
            columns: ["work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      agent_prompt_tool_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_current: boolean
          metadata: Json | null
          prompt_version: string
          rollback_reason: string | null
          status: string
          tool_version: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_current?: boolean
          metadata?: Json | null
          prompt_version: string
          rollback_reason?: string | null
          status?: string
          tool_version: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_current?: boolean
          metadata?: Json | null
          prompt_version?: string
          rollback_reason?: string | null
          status?: string
          tool_version?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      agent_runtime_config: {
        Row: {
          actions_disabled: boolean
          config_key: string
          reason: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actions_disabled?: boolean
          config_key: string
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actions_disabled?: boolean
          config_key?: string
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      agent_work_approvals: {
        Row: {
          approval_hash: string | null
          assigned_to: string | null
          client_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason_code: string | null
          evidence_hash: string
          expires_at: string | null
          id: string
          input_hash: string
          organization_id: string
          request_reason_code: string | null
          requested_at: string
          requested_by: string | null
          required_role: string
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason_code: string | null
          status: Database["public"]["Enums"]["agent_work_approval_status"]
          step_id: string | null
          updated_at: string
          work_item_id: string
          workflow_version: number | null
        }
        Insert: {
          approval_hash?: string | null
          assigned_to?: string | null
          client_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason_code?: string | null
          evidence_hash: string
          expires_at?: string | null
          id?: string
          input_hash: string
          organization_id: string
          request_reason_code?: string | null
          requested_at?: string
          requested_by?: string | null
          required_role: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason_code?: string | null
          status?: Database["public"]["Enums"]["agent_work_approval_status"]
          step_id?: string | null
          updated_at?: string
          work_item_id: string
          workflow_version?: number | null
        }
        Update: {
          approval_hash?: string | null
          assigned_to?: string | null
          client_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason_code?: string | null
          evidence_hash?: string
          expires_at?: string | null
          id?: string
          input_hash?: string
          organization_id?: string
          request_reason_code?: string | null
          requested_at?: string
          requested_by?: string | null
          required_role?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason_code?: string | null
          status?: Database["public"]["Enums"]["agent_work_approval_status"]
          step_id?: string | null
          updated_at?: string
          work_item_id?: string
          workflow_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_approvals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_approvals_step_fk"
            columns: ["step_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "agent_work_steps"
            referencedColumns: ["id", "work_item_id"]
          },
          {
            foreignKeyName: "agent_work_approvals_work_item_fk"
            columns: ["work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      agent_work_assessment_links: {
        Row: {
          assessment_document_id: string
          client_id: string
          created_at: string
          id: string
          organization_id: string
          work_item_id: string
          workflow_key: string
          workflow_version: number
        }
        Insert: {
          assessment_document_id: string
          client_id: string
          created_at?: string
          id?: string
          organization_id: string
          work_item_id: string
          workflow_key: string
          workflow_version: number
        }
        Update: {
          assessment_document_id?: string
          client_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          work_item_id?: string
          workflow_key?: string
          workflow_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_assessment_links_assessment_document_id_fkey"
            columns: ["assessment_document_id"]
            isOneToOne: false
            referencedRelation: "assessment_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_assessment_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_assessment_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_assessment_links_work_item_fk"
            columns: ["work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      agent_work_attempts: {
        Row: {
          attempt_number: number
          client_id: string | null
          computed_cost: number | null
          correlation_id: string | null
          created_at: string
          error_class: string | null
          error_code: string | null
          finished_at: string | null
          id: string
          input_token_count: number | null
          lease_acquired_at: string
          lease_expires_at: string | null
          model: string | null
          model_request_schema_version: string | null
          organization_id: string
          output_token_count: number | null
          pricing_version: string | null
          prompt_version: string | null
          provider: string | null
          request_id: string | null
          status: Database["public"]["Enums"]["agent_work_attempt_status"]
          step_id: string
          temperature: number | null
          tool_version: string | null
          updated_at: string
          work_item_id: string
          worker_id: string
          workflow_version: number | null
        }
        Insert: {
          attempt_number: number
          client_id?: string | null
          computed_cost?: number | null
          correlation_id?: string | null
          created_at?: string
          error_class?: string | null
          error_code?: string | null
          finished_at?: string | null
          id?: string
          input_token_count?: number | null
          lease_acquired_at?: string
          lease_expires_at?: string | null
          model?: string | null
          model_request_schema_version?: string | null
          organization_id: string
          output_token_count?: number | null
          pricing_version?: string | null
          prompt_version?: string | null
          provider?: string | null
          request_id?: string | null
          status?: Database["public"]["Enums"]["agent_work_attempt_status"]
          step_id: string
          temperature?: number | null
          tool_version?: string | null
          updated_at?: string
          work_item_id: string
          worker_id: string
          workflow_version?: number | null
        }
        Update: {
          attempt_number?: number
          client_id?: string | null
          computed_cost?: number | null
          correlation_id?: string | null
          created_at?: string
          error_class?: string | null
          error_code?: string | null
          finished_at?: string | null
          id?: string
          input_token_count?: number | null
          lease_acquired_at?: string
          lease_expires_at?: string | null
          model?: string | null
          model_request_schema_version?: string | null
          organization_id?: string
          output_token_count?: number | null
          pricing_version?: string | null
          prompt_version?: string | null
          provider?: string | null
          request_id?: string | null
          status?: Database["public"]["Enums"]["agent_work_attempt_status"]
          step_id?: string
          temperature?: number | null
          tool_version?: string | null
          updated_at?: string
          work_item_id?: string
          worker_id?: string
          workflow_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_attempts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_attempts_step_fk"
            columns: ["step_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "agent_work_steps"
            referencedColumns: ["id", "work_item_id"]
          },
          {
            foreignKeyName: "agent_work_attempts_work_item_fk"
            columns: ["work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      agent_work_caloptima_draft_packets: {
        Row: {
          assessment_document_id: string
          client_id: string
          created_at: string
          id: string
          model_attempt_id: string
          model_step_id: string
          organization_id: string
          output_hash: string
          packet: Json
          work_item_id: string
        }
        Insert: {
          assessment_document_id: string
          client_id: string
          created_at?: string
          id?: string
          model_attempt_id: string
          model_step_id: string
          organization_id: string
          output_hash: string
          packet: Json
          work_item_id: string
        }
        Update: {
          assessment_document_id?: string
          client_id?: string
          created_at?: string
          id?: string
          model_attempt_id?: string
          model_step_id?: string
          organization_id?: string
          output_hash?: string
          packet?: Json
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_caloptima_draft_packets_assessment_document_id_fkey"
            columns: ["assessment_document_id"]
            isOneToOne: false
            referencedRelation: "assessment_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_caloptima_draft_packets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_caloptima_draft_packets_model_attempt_id_fkey"
            columns: ["model_attempt_id"]
            isOneToOne: false
            referencedRelation: "agent_work_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_caloptima_draft_packets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_caloptima_packets_model_step_fk"
            columns: ["model_step_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "agent_work_steps"
            referencedColumns: ["id", "work_item_id"]
          },
          {
            foreignKeyName: "agent_work_caloptima_packets_work_item_fk"
            columns: ["work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      agent_work_effects: {
        Row: {
          attempt_id: string | null
          client_id: string | null
          created_at: string
          effect_kind: string
          id: string
          organization_id: string
          payload_hash: string
          status: Database["public"]["Enums"]["agent_work_effect_status"]
          step_id: string
          target_id: string | null
          target_kind: string
          unique_effect_key: string
          updated_at: string
          verified_at: string | null
          work_item_id: string
        }
        Insert: {
          attempt_id?: string | null
          client_id?: string | null
          created_at?: string
          effect_kind: string
          id?: string
          organization_id: string
          payload_hash: string
          status?: Database["public"]["Enums"]["agent_work_effect_status"]
          step_id: string
          target_id?: string | null
          target_kind: string
          unique_effect_key: string
          updated_at?: string
          verified_at?: string | null
          work_item_id: string
        }
        Update: {
          attempt_id?: string | null
          client_id?: string | null
          created_at?: string
          effect_kind?: string
          id?: string
          organization_id?: string
          payload_hash?: string
          status?: Database["public"]["Enums"]["agent_work_effect_status"]
          step_id?: string
          target_id?: string | null
          target_kind?: string
          unique_effect_key?: string
          updated_at?: string
          verified_at?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_effects_attempt_fk"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "agent_work_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_effects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_effects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_effects_step_fk"
            columns: ["step_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "agent_work_steps"
            referencedColumns: ["id", "work_item_id"]
          },
          {
            foreignKeyName: "agent_work_effects_work_item_fk"
            columns: ["work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      agent_work_events: {
        Row: {
          actor_id: string | null
          actor_kind: string
          attempt_id: string | null
          client_id: string | null
          correlation_id: string | null
          created_at: string
          event_type: string
          id: string
          organization_id: string
          request_id: string | null
          sanitized_metadata: Json
          step_id: string | null
          work_item_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_kind: string
          attempt_id?: string | null
          client_id?: string | null
          correlation_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          organization_id: string
          request_id?: string | null
          sanitized_metadata?: Json
          step_id?: string | null
          work_item_id: string
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string
          attempt_id?: string | null
          client_id?: string | null
          correlation_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          organization_id?: string
          request_id?: string | null
          sanitized_metadata?: Json
          step_id?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_events_attempt_fk"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "agent_work_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_events_step_fk"
            columns: ["step_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "agent_work_steps"
            referencedColumns: ["id", "work_item_id"]
          },
          {
            foreignKeyName: "agent_work_events_work_item_fk"
            columns: ["work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      agent_work_evidence: {
        Row: {
          captured_at: string
          client_id: string | null
          created_at: string
          id: string
          locator: string | null
          metadata: Json
          organization_id: string
          sha256: string
          source_id: string
          source_kind: Database["public"]["Enums"]["agent_work_evidence_source_kind"]
          step_id: string | null
          work_item_id: string
        }
        Insert: {
          captured_at?: string
          client_id?: string | null
          created_at?: string
          id?: string
          locator?: string | null
          metadata?: Json
          organization_id: string
          sha256: string
          source_id: string
          source_kind: Database["public"]["Enums"]["agent_work_evidence_source_kind"]
          step_id?: string | null
          work_item_id: string
        }
        Update: {
          captured_at?: string
          client_id?: string | null
          created_at?: string
          id?: string
          locator?: string | null
          metadata?: Json
          organization_id?: string
          sha256?: string
          source_id?: string
          source_kind?: Database["public"]["Enums"]["agent_work_evidence_source_kind"]
          step_id?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_evidence_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_evidence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_evidence_step_fk"
            columns: ["step_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "agent_work_steps"
            referencedColumns: ["id", "work_item_id"]
          },
          {
            foreignKeyName: "agent_work_evidence_work_item_fk"
            columns: ["work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      agent_work_item_dependencies: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          predecessor_work_item_id: string
          successor_work_item_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          predecessor_work_item_id: string
          successor_work_item_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          predecessor_work_item_id?: string
          successor_work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_item_dependencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_item_dependencies_predecessor_fk"
            columns: ["predecessor_work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "agent_work_item_dependencies_successor_fk"
            columns: ["successor_work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      agent_work_items: {
        Row: {
          assigned_agent_key: string | null
          cancelled_at: string | null
          client_id: string | null
          completed_at: string | null
          completion_criteria: Json
          created_at: string
          current_step_id: string | null
          dedupe_key: string
          due_at: string | null
          failure_reason_code: string | null
          id: string
          objective: string
          organization_id: string
          owner_user_id: string | null
          parent_work_item_id: string | null
          priority: number
          prompt_tool_version_id: string | null
          risk: Database["public"]["Enums"]["agent_work_risk"]
          state_version: number
          status: Database["public"]["Enums"]["agent_work_item_status"]
          updated_at: string
          workflow_key: string
          workflow_version: number
        }
        Insert: {
          assigned_agent_key?: string | null
          cancelled_at?: string | null
          client_id?: string | null
          completed_at?: string | null
          completion_criteria?: Json
          created_at?: string
          current_step_id?: string | null
          dedupe_key: string
          due_at?: string | null
          failure_reason_code?: string | null
          id?: string
          objective: string
          organization_id: string
          owner_user_id?: string | null
          parent_work_item_id?: string | null
          priority?: number
          prompt_tool_version_id?: string | null
          risk?: Database["public"]["Enums"]["agent_work_risk"]
          state_version?: number
          status?: Database["public"]["Enums"]["agent_work_item_status"]
          updated_at?: string
          workflow_key: string
          workflow_version: number
        }
        Update: {
          assigned_agent_key?: string | null
          cancelled_at?: string | null
          client_id?: string | null
          completed_at?: string | null
          completion_criteria?: Json
          created_at?: string
          current_step_id?: string | null
          dedupe_key?: string
          due_at?: string | null
          failure_reason_code?: string | null
          id?: string
          objective?: string
          organization_id?: string
          owner_user_id?: string | null
          parent_work_item_id?: string | null
          priority?: number
          prompt_tool_version_id?: string | null
          risk?: Database["public"]["Enums"]["agent_work_risk"]
          state_version?: number
          status?: Database["public"]["Enums"]["agent_work_item_status"]
          updated_at?: string
          workflow_key?: string
          workflow_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_items_current_step_fk"
            columns: ["current_step_id", "id"]
            isOneToOne: false
            referencedRelation: "agent_work_steps"
            referencedColumns: ["id", "work_item_id"]
          },
          {
            foreignKeyName: "agent_work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_items_parent_work_item_id_fkey"
            columns: ["parent_work_item_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_items_prompt_tool_version_id_fkey"
            columns: ["prompt_tool_version_id"]
            isOneToOne: false
            referencedRelation: "agent_prompt_tool_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_work_retention_holds: {
        Row: {
          approved_at: string
          approved_by: string
          category: string
          created_at: string
          id: string
          organization_id: string
          provenance_code: string
          reason_code: string
          release_reason_code: string | null
          released_at: string | null
          released_by: string | null
          work_item_id: string
        }
        Insert: {
          approved_at: string
          approved_by: string
          category: string
          created_at?: string
          id?: string
          organization_id: string
          provenance_code: string
          reason_code: string
          release_reason_code?: string | null
          released_at?: string | null
          released_by?: string | null
          work_item_id: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          category?: string
          created_at?: string
          id?: string
          organization_id?: string
          provenance_code?: string
          reason_code?: string
          release_reason_code?: string | null
          released_at?: string | null
          released_by?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_retention_holds_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_retention_holds_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_work_retention_holds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_retention_holds_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_retention_holds_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "agent_work_retention_holds_work_item_org_fk"
            columns: ["work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      agent_work_retention_policies: {
        Row: {
          approved_at: string
          approved_by: string
          category: string
          created_at: string
          disabled_at: string | null
          id: string
          policy_code: string
          policy_reference: string
          policy_version: number
          updated_at: string
        }
        Insert: {
          approved_at: string
          approved_by: string
          category: string
          created_at?: string
          disabled_at?: string | null
          id?: string
          policy_code: string
          policy_reference: string
          policy_version: number
          updated_at?: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          category?: string
          created_at?: string
          disabled_at?: string | null
          id?: string
          policy_code?: string
          policy_reference?: string
          policy_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_retention_policies_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_retention_policies_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      agent_work_retention_policy_decisions: {
        Row: {
          attestation_kind: string
          category: string
          created_at: string
          decision_recorded_at: string
          decision_reference: string
          decision_sha256: string
          id: string
          policy_version: number
          retention_days: number
        }
        Insert: {
          attestation_kind: string
          category: string
          created_at?: string
          decision_recorded_at: string
          decision_reference: string
          decision_sha256: string
          id?: string
          policy_version: number
          retention_days: number
        }
        Update: {
          attestation_kind?: string
          category?: string
          created_at?: string
          decision_recorded_at?: string
          decision_reference?: string
          decision_sha256?: string
          id?: string
          policy_version?: number
          retention_days?: number
        }
        Relationships: []
      }
      agent_work_retention_receipts: {
        Row: {
          category: string
          created_at: string
          export_schema_version: string
          exported_row_count: number
          id: string
          manifest_hash: string
          organization_id: string
          work_item_id: string
        }
        Insert: {
          category: string
          created_at?: string
          export_schema_version: string
          exported_row_count: number
          id?: string
          manifest_hash: string
          organization_id: string
          work_item_id: string
        }
        Update: {
          category?: string
          created_at?: string
          export_schema_version?: string
          exported_row_count?: number
          id?: string
          manifest_hash?: string
          organization_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_retention_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_retention_receipts_work_item_org_fk"
            columns: ["work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      agent_work_step_dependencies: {
        Row: {
          created_at: string
          id: string
          predecessor_step_id: string
          successor_step_id: string
          work_item_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          predecessor_step_id: string
          successor_step_id: string
          work_item_id: string
        }
        Update: {
          created_at?: string
          id?: string
          predecessor_step_id?: string
          successor_step_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_step_dependencies_predecessor_fk"
            columns: ["predecessor_step_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "agent_work_steps"
            referencedColumns: ["id", "work_item_id"]
          },
          {
            foreignKeyName: "agent_work_step_dependencies_successor_fk"
            columns: ["successor_step_id", "work_item_id"]
            isOneToOne: false
            referencedRelation: "agent_work_steps"
            referencedColumns: ["id", "work_item_id"]
          },
        ]
      }
      agent_work_steps: {
        Row: {
          approval_hash: string | null
          attempt_count: number
          client_id: string | null
          completed_at: string | null
          completion_criteria: Json
          created_at: string
          execution_mode: Database["public"]["Enums"]["agent_work_execution_mode"]
          id: string
          input_hash: string | null
          last_error_class: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          ordinal: number
          organization_id: string
          output_hash: string | null
          required_role: string | null
          risk: Database["public"]["Enums"]["agent_work_risk"]
          state_version: number
          status: Database["public"]["Enums"]["agent_work_step_status"]
          step_key: string
          updated_at: string
          wake_at: string | null
          work_item_id: string
        }
        Insert: {
          approval_hash?: string | null
          attempt_count?: number
          client_id?: string | null
          completed_at?: string | null
          completion_criteria?: Json
          created_at?: string
          execution_mode: Database["public"]["Enums"]["agent_work_execution_mode"]
          id?: string
          input_hash?: string | null
          last_error_class?: string | null
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          ordinal: number
          organization_id: string
          output_hash?: string | null
          required_role?: string | null
          risk?: Database["public"]["Enums"]["agent_work_risk"]
          state_version?: number
          status?: Database["public"]["Enums"]["agent_work_step_status"]
          step_key: string
          updated_at?: string
          wake_at?: string | null
          work_item_id: string
        }
        Update: {
          approval_hash?: string | null
          attempt_count?: number
          client_id?: string | null
          completed_at?: string | null
          completion_criteria?: Json
          created_at?: string
          execution_mode?: Database["public"]["Enums"]["agent_work_execution_mode"]
          id?: string
          input_hash?: string | null
          last_error_class?: string | null
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          ordinal?: number
          organization_id?: string
          output_hash?: string | null
          required_role?: string | null
          risk?: Database["public"]["Enums"]["agent_work_risk"]
          state_version?: number
          status?: Database["public"]["Enums"]["agent_work_step_status"]
          step_key?: string
          updated_at?: string
          wake_at?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_work_steps_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_work_steps_work_item_fk"
            columns: ["work_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agent_work_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      ai_guidance_documents: {
        Row: {
          created_at: string
          guidance_key: string
          guidance_text: string
          id: string
          is_active: boolean
          source_reference: string | null
          source_type: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          guidance_key: string
          guidance_text: string
          id?: string
          is_active?: boolean
          source_reference?: string | null
          source_type: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          guidance_key?: string
          guidance_text?: string
          id?: string
          is_active?: boolean
          source_reference?: string | null
          source_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
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
          goal_ids: string[] | null
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
          goal_ids?: string[] | null
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
          goal_ids?: string[] | null
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
      assessment_checklist_items: {
        Row: {
          assessment_document_id: string
          client_id: string
          created_at: string
          extraction_method: string
          extraction_owner: string | null
          id: string
          label: string
          last_reviewed_at: string | null
          last_reviewed_by: string | null
          mode: string
          organization_id: string
          placeholder_key: string
          required: boolean
          review_notes: string | null
          review_owner: string | null
          section_key: string
          source: string
          status: string
          updated_at: string
          validation_rule: string
          value_json: Json | null
          value_text: string | null
        }
        Insert: {
          assessment_document_id: string
          client_id: string
          created_at?: string
          extraction_method: string
          extraction_owner?: string | null
          id?: string
          label: string
          last_reviewed_at?: string | null
          last_reviewed_by?: string | null
          mode: string
          organization_id: string
          placeholder_key: string
          required?: boolean
          review_notes?: string | null
          review_owner?: string | null
          section_key: string
          source?: string
          status?: string
          updated_at?: string
          validation_rule: string
          value_json?: Json | null
          value_text?: string | null
        }
        Update: {
          assessment_document_id?: string
          client_id?: string
          created_at?: string
          extraction_method?: string
          extraction_owner?: string | null
          id?: string
          label?: string
          last_reviewed_at?: string | null
          last_reviewed_by?: string | null
          mode?: string
          organization_id?: string
          placeholder_key?: string
          required?: boolean
          review_notes?: string | null
          review_owner?: string | null
          section_key?: string
          source?: string
          status?: string
          updated_at?: string
          validation_rule?: string
          value_json?: Json | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_checklist_items_assessment_document_id_fkey"
            columns: ["assessment_document_id"]
            isOneToOne: false
            referencedRelation: "assessment_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_checklist_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_checklist_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_documents: {
        Row: {
          approved_at: string | null
          bucket_id: string
          client_id: string
          created_at: string
          extracted_at: string | null
          extraction_completed_at: string | null
          extraction_error: string | null
          extraction_started_at: string | null
          file_name: string
          file_size: number
          id: string
          mime_type: string
          object_path: string
          organization_id: string
          rejected_at: string | null
          rejection_reason: string | null
          status: string
          template_type: string
          template_version_id: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          approved_at?: string | null
          bucket_id?: string
          client_id: string
          created_at?: string
          extracted_at?: string | null
          extraction_completed_at?: string | null
          extraction_error?: string | null
          extraction_started_at?: string | null
          file_name: string
          file_size?: number
          id?: string
          mime_type: string
          object_path: string
          organization_id: string
          rejected_at?: string | null
          rejection_reason?: string | null
          status?: string
          template_type?: string
          template_version_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          approved_at?: string | null
          bucket_id?: string
          client_id?: string
          created_at?: string
          extracted_at?: string | null
          extraction_completed_at?: string | null
          extraction_error?: string | null
          extraction_started_at?: string | null
          file_name?: string
          file_size?: number
          id?: string
          mime_type?: string
          object_path?: string
          organization_id?: string
          rejected_at?: string | null
          rejection_reason?: string | null
          status?: string
          template_type?: string
          template_version_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_documents_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "assessment_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_draft_goals: {
        Row: {
          accept_state: string
          assessment_document_id: string
          baseline: string | null
          baseline_data: string | null
          client_id: string
          clinical_goal_type: string | null
          created_at: string
          description: string
          domain_id: string | null
          draft_program_id: string | null
          evidence_refs: Json
          generalization_criteria: string | null
          goal_type: string
          id: string
          maintenance_criteria: string | null
          mastery_criteria: string | null
          measurement_type: string | null
          objective_data_points: Json
          operational_definition: string | null
          organization_id: string
          original_text: string
          program_name: string | null
          rationale: string | null
          review_flags: string[]
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          target_behavior: string | null
          target_criteria: string | null
          teaching_strategies: string | null
          title: string
          updated_at: string
        }
        Insert: {
          accept_state?: string
          assessment_document_id: string
          baseline?: string | null
          baseline_data?: string | null
          client_id: string
          clinical_goal_type?: string | null
          created_at?: string
          description: string
          domain_id?: string | null
          draft_program_id?: string | null
          evidence_refs?: Json
          generalization_criteria?: string | null
          goal_type?: string
          id?: string
          maintenance_criteria?: string | null
          mastery_criteria?: string | null
          measurement_type?: string | null
          objective_data_points?: Json
          operational_definition?: string | null
          organization_id: string
          original_text: string
          program_name?: string | null
          rationale?: string | null
          review_flags?: string[]
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          target_behavior?: string | null
          target_criteria?: string | null
          teaching_strategies?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          accept_state?: string
          assessment_document_id?: string
          baseline?: string | null
          baseline_data?: string | null
          client_id?: string
          clinical_goal_type?: string | null
          created_at?: string
          description?: string
          domain_id?: string | null
          draft_program_id?: string | null
          evidence_refs?: Json
          generalization_criteria?: string | null
          goal_type?: string
          id?: string
          maintenance_criteria?: string | null
          mastery_criteria?: string | null
          measurement_type?: string | null
          objective_data_points?: Json
          operational_definition?: string | null
          organization_id?: string
          original_text?: string
          program_name?: string | null
          rationale?: string | null
          review_flags?: string[]
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          target_behavior?: string | null
          target_criteria?: string | null
          teaching_strategies?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_draft_goals_assessment_document_id_fkey"
            columns: ["assessment_document_id"]
            isOneToOne: false
            referencedRelation: "assessment_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_draft_goals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_draft_goals_domain_id_fkey"
            columns: ["domain_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "goal_domains"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "assessment_draft_goals_draft_program_id_fkey"
            columns: ["draft_program_id"]
            isOneToOne: false
            referencedRelation: "assessment_draft_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_draft_goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_draft_programs: {
        Row: {
          accept_state: string
          assessment_document_id: string
          client_id: string
          confidence: string | null
          created_at: string
          description: string | null
          evidence_refs: Json
          id: string
          name: string
          organization_id: string
          rationale: string | null
          review_flags: string[]
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          summary_rationale: string | null
          updated_at: string
        }
        Insert: {
          accept_state?: string
          assessment_document_id: string
          client_id: string
          confidence?: string | null
          created_at?: string
          description?: string | null
          evidence_refs?: Json
          id?: string
          name: string
          organization_id: string
          rationale?: string | null
          review_flags?: string[]
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          summary_rationale?: string | null
          updated_at?: string
        }
        Update: {
          accept_state?: string
          assessment_document_id?: string
          client_id?: string
          confidence?: string | null
          created_at?: string
          description?: string | null
          evidence_refs?: Json
          id?: string
          name?: string
          organization_id?: string
          rationale?: string | null
          review_flags?: string[]
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          summary_rationale?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_draft_programs_assessment_document_id_fkey"
            columns: ["assessment_document_id"]
            isOneToOne: false
            referencedRelation: "assessment_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_draft_programs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_draft_programs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_extractions: {
        Row: {
          assessment_document_id: string
          client_id: string
          confidence: number | null
          created_at: string
          extraction_method_detail: string | null
          field_key: string
          id: string
          label: string
          mode: string
          organization_id: string
          required: boolean
          review_notes: string | null
          section_key: string
          source_span: Json | null
          status: string
          updated_at: string
          value_json: Json | null
          value_text: string | null
        }
        Insert: {
          assessment_document_id: string
          client_id: string
          confidence?: number | null
          created_at?: string
          extraction_method_detail?: string | null
          field_key: string
          id?: string
          label: string
          mode: string
          organization_id: string
          required?: boolean
          review_notes?: string | null
          section_key: string
          source_span?: Json | null
          status?: string
          updated_at?: string
          value_json?: Json | null
          value_text?: string | null
        }
        Update: {
          assessment_document_id?: string
          client_id?: string
          confidence?: number | null
          created_at?: string
          extraction_method_detail?: string | null
          field_key?: string
          id?: string
          label?: string
          mode?: string
          organization_id?: string
          required?: boolean
          review_notes?: string | null
          section_key?: string
          source_span?: Json | null
          status?: string
          updated_at?: string
          value_json?: Json | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_extractions_assessment_document_id_fkey"
            columns: ["assessment_document_id"]
            isOneToOne: false
            referencedRelation: "assessment_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_extractions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_extractions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_review_events: {
        Row: {
          action: string
          actor_id: string | null
          assessment_document_id: string
          client_id: string
          created_at: string
          event_payload: Json
          from_status: string | null
          id: string
          item_id: string | null
          item_type: string
          notes: string | null
          organization_id: string
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          assessment_document_id: string
          client_id: string
          created_at?: string
          event_payload?: Json
          from_status?: string | null
          id?: string
          item_id?: string | null
          item_type: string
          notes?: string | null
          organization_id: string
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          assessment_document_id?: string
          client_id?: string
          created_at?: string
          event_payload?: Json
          from_status?: string | null
          id?: string
          item_id?: string | null
          item_type?: string
          notes?: string | null
          organization_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_review_events_assessment_document_id_fkey"
            columns: ["assessment_document_id"]
            isOneToOne: false
            referencedRelation: "assessment_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_review_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_review_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_structured_sections: {
        Row: {
          assessment_document_id: string
          client_id: string
          created_at: string
          field_key: string
          id: string
          organization_id: string
          payload: Json
          required: boolean
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          section_index: number
          section_key: string
          source_span: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          assessment_document_id: string
          client_id: string
          created_at?: string
          field_key: string
          id?: string
          organization_id: string
          payload?: Json
          required?: boolean
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          section_index?: number
          section_key: string
          source_span?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          assessment_document_id?: string
          client_id?: string
          created_at?: string
          field_key?: string
          id?: string
          organization_id?: string
          payload?: Json
          required?: boolean
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          section_index?: number
          section_key?: string
          source_span?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_structured_sections_assessment_document_id_fkey"
            columns: ["assessment_document_id"]
            isOneToOne: false
            referencedRelation: "assessment_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_structured_sections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_structured_sections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_template_fields: {
        Row: {
          created_at: string
          field_key: string
          field_type: string
          id: string
          label: string
          layout_json: Json
          mode: string
          page_number: number
          repeat_group_key: string | null
          required: boolean
          section_key: string
          source: string
          template_version_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          field_key: string
          field_type: string
          id?: string
          label: string
          layout_json?: Json
          mode: string
          page_number: number
          repeat_group_key?: string | null
          required?: boolean
          section_key: string
          source?: string
          template_version_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          field_key?: string
          field_type?: string
          id?: string
          label?: string
          layout_json?: Json
          mode?: string
          page_number?: number
          repeat_group_key?: string | null
          required?: boolean
          section_key?: string
          source?: string
          template_version_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_template_fields_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "assessment_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_template_pages: {
        Row: {
          created_at: string
          id: string
          layout_json: Json
          page_number: number
          template_version_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          layout_json?: Json
          page_number: number
          template_version_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          layout_json?: Json
          page_number?: number
          template_version_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_template_pages_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "assessment_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_template_versions: {
        Row: {
          created_at: string
          id: string
          page_count: number
          source_document_name: string
          source_sha256: string | null
          status: string
          template_type: string
          updated_at: string
          version_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          page_count: number
          source_document_name: string
          source_sha256?: string | null
          status?: string
          template_type: string
          updated_at?: string
          version_key: string
        }
        Update: {
          created_at?: string
          id?: string
          page_count?: number
          source_document_name?: string
          source_sha256?: string | null
          status?: string
          template_type?: string
          updated_at?: string
          version_key?: string
        }
        Relationships: []
      }
      authorization_services: {
        Row: {
          approved_units: number | null
          authorization_id: string
          created_at: string | null
          created_by: string
          decision_status: string
          from_date: string
          id: string
          organization_id: string
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
          created_by: string
          decision_status?: string
          from_date: string
          id?: string
          organization_id: string
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
          created_by?: string
          decision_status?: string
          from_date?: string
          id?: string
          organization_id?: string
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
          {
            foreignKeyName: "authorization_services_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authorization_services_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "authorization_services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      authorizations: {
        Row: {
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          authorization_number: string
          client_id: string
          created_at: string | null
          created_by: string
          denial_reason: string | null
          denied_at: string | null
          diagnosis_code: string
          diagnosis_description: string | null
          documents: Json | null
          end_date: string
          id: string
          insurance_provider_id: string | null
          member_id: string | null
          organization_id: string
          plan_type: string | null
          provider_id: string
          start_date: string
          status: string
          updated_at: string | null
        }
        Insert: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          authorization_number: string
          client_id: string
          created_at?: string | null
          created_by: string
          denial_reason?: string | null
          denied_at?: string | null
          diagnosis_code: string
          diagnosis_description?: string | null
          documents?: Json | null
          end_date: string
          id?: string
          insurance_provider_id?: string | null
          member_id?: string | null
          organization_id: string
          plan_type?: string | null
          provider_id: string
          start_date: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          authorization_number?: string
          client_id?: string
          created_at?: string | null
          created_by?: string
          denial_reason?: string | null
          denied_at?: string | null
          diagnosis_code?: string
          diagnosis_description?: string | null
          documents?: Json | null
          end_date?: string
          id?: string
          insurance_provider_id?: string | null
          member_id?: string | null
          organization_id?: string
          plan_type?: string | null
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
            foreignKeyName: "authorizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authorizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "authorizations_insurance_provider_id_fkey"
            columns: ["insurance_provider_id"]
            isOneToOne: false
            referencedRelation: "insurance_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authorizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
        Relationships: [
          {
            foreignKeyName: "behavioral_patterns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_modifiers: {
        Row: {
          billing_note: string | null
          code: string
          created_at: string
          description: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          billing_note?: string | null
          code: string
          created_at?: string
          description: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          billing_note?: string | null
          code?: string
          created_at?: string
          description?: string
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
      bt_session_note_amendments: {
        Row: {
          bt_aba_responses: Json
          bt_aba_template_snapshot: Json
          correction_id: string
          correction_round: number
          created_at: string
          id: string
          organization_id: string
          original_bt_note_id: string
          request_id: string
          signature_method: string
          signature_value: string
          signed_at: string
          signer_user_id: string
          version_number: number
        }
        Insert: {
          bt_aba_responses?: Json
          bt_aba_template_snapshot?: Json
          correction_id: string
          correction_round: number
          created_at?: string
          id?: string
          organization_id: string
          original_bt_note_id: string
          request_id: string
          signature_method: string
          signature_value: string
          signed_at?: string
          signer_user_id: string
          version_number: number
        }
        Update: {
          bt_aba_responses?: Json
          bt_aba_template_snapshot?: Json
          correction_id?: string
          correction_round?: number
          created_at?: string
          id?: string
          organization_id?: string
          original_bt_note_id?: string
          request_id?: string
          signature_method?: string
          signature_value?: string
          signed_at?: string
          signer_user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "bt_session_note_amendments_correction_id_request_id_organi_fkey"
            columns: [
              "correction_id",
              "request_id",
              "organization_id",
              "correction_round",
            ]
            isOneToOne: false
            referencedRelation: "supervision_session_note_corrections"
            referencedColumns: [
              "id",
              "request_id",
              "organization_id",
              "correction_round",
            ]
          },
          {
            foreignKeyName: "bt_session_note_amendments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bt_session_note_amendments_original_bt_note_id_organizatio_fkey"
            columns: ["original_bt_note_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "client_session_notes"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bt_session_note_amendments_request_id_organization_id_fkey"
            columns: ["request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "supervision_session_note_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bt_session_note_amendments_signer_user_id_fkey"
            columns: ["signer_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bt_session_note_amendments_signer_user_id_fkey"
            columns: ["signer_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
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
        Relationships: [
          {
            foreignKeyName: "chat_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
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
            foreignKeyName: "client_guardians_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_guardians_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_guardians_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_guardians_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_guardians_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_guardians_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_guardians_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_guardians_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_guardians_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      client_issues: {
        Row: {
          category: string | null
          client_id: string
          created_at: string
          created_by: string | null
          date_opened: string
          description: string | null
          id: string
          last_action: string
          organization_id: string
          priority: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          date_opened?: string
          description?: string | null
          id?: string
          last_action?: string
          organization_id: string
          priority?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          date_opened?: string
          description?: string | null
          id?: string
          last_action?: string
          organization_id?: string
          priority?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_issues_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_issues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_issues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_issues_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          client_id: string
          content: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          id: string
          is_visible_to_parent: boolean | null
          is_visible_to_therapist: boolean
          organization_id: string | null
          status: string | null
        }
        Insert: {
          client_id: string
          content?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_visible_to_parent?: boolean | null
          is_visible_to_therapist?: boolean
          organization_id?: string | null
          status?: string | null
        }
        Update: {
          client_id?: string
          content?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_visible_to_parent?: boolean | null
          is_visible_to_therapist?: boolean
          organization_id?: string | null
          status?: string | null
        }
        Relationships: []
      }
      client_onboarding_prefills: {
        Row: {
          consumed_at: string | null
          consumed_by_user_id: string | null
          created_at: string
          created_by_user_id: string
          expires_at: string
          id: string
          organization_id: string
          payload: Json
          token_hash: string
        }
        Insert: {
          consumed_at?: string | null
          consumed_by_user_id?: string | null
          created_at?: string
          created_by_user_id: string
          expires_at: string
          id?: string
          organization_id: string
          payload: Json
          token_hash: string
        }
        Update: {
          consumed_at?: string | null
          consumed_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string
          expires_at?: string
          id?: string
          organization_id?: string
          payload?: Json
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_onboarding_prefills_consumed_by_user_id_fkey"
            columns: ["consumed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_onboarding_prefills_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_onboarding_prefills_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_session_notes: {
        Row: {
          authorization_id: string
          bt_aba_finalization_result: Json | null
          bt_aba_responses: Json | null
          bt_aba_template_id: string | null
          bt_aba_template_snapshot: Json | null
          client_id: string
          created_at: string
          created_by: string
          end_time: string
          goal_ids: string[] | null
          goal_measurements: Json | null
          goal_notes: Json | null
          goals_addressed: string[]
          id: string
          is_locked: boolean
          narrative: string
          organization_id: string
          service_code: string
          session_date: string
          session_duration: number
          session_id: string | null
          signed_at: string | null
          start_time: string
          therapist_id: string
          updated_at: string
        }
        Insert: {
          authorization_id: string
          bt_aba_finalization_result?: Json | null
          bt_aba_responses?: Json | null
          bt_aba_template_id?: string | null
          bt_aba_template_snapshot?: Json | null
          client_id: string
          created_at?: string
          created_by: string
          end_time: string
          goal_ids?: string[] | null
          goal_measurements?: Json | null
          goal_notes?: Json | null
          goals_addressed?: string[]
          id?: string
          is_locked?: boolean
          narrative: string
          organization_id: string
          service_code: string
          session_date: string
          session_duration: number
          session_id?: string | null
          signed_at?: string | null
          start_time: string
          therapist_id: string
          updated_at?: string
        }
        Update: {
          authorization_id?: string
          bt_aba_finalization_result?: Json | null
          bt_aba_responses?: Json | null
          bt_aba_template_id?: string | null
          bt_aba_template_snapshot?: Json | null
          client_id?: string
          created_at?: string
          created_by?: string
          end_time?: string
          goal_ids?: string[] | null
          goal_measurements?: Json | null
          goal_notes?: Json | null
          goals_addressed?: string[]
          id?: string
          is_locked?: boolean
          narrative?: string
          organization_id?: string
          service_code?: string
          session_date?: string
          session_duration?: number
          session_id?: string | null
          signed_at?: string | null
          start_time?: string
          therapist_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_session_notes_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_session_notes_bt_aba_template_id_fkey"
            columns: ["bt_aba_template_id"]
            isOneToOne: false
            referencedRelation: "session_note_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_session_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_session_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_session_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_session_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_session_notes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_session_notes_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      client_therapist_links: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          therapist_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          therapist_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          therapist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_therapist_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_therapist_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_therapist_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_therapist_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_therapist_links_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          assessment_units: number | null
          auth_end_date: string | null
          auth_start_date: string | null
          auth_units: number | null
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
          therapist_assigned_at: string | null
          therapist_id: string | null
          unscheduled_hours: number | null
          updated_at: string
          updated_by: string | null
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          assessment_units?: number | null
          auth_end_date?: string | null
          auth_start_date?: string | null
          auth_units?: number | null
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
          therapist_assigned_at?: string | null
          therapist_id?: string | null
          unscheduled_hours?: number | null
          updated_at?: string
          updated_by?: string | null
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          assessment_units?: number | null
          auth_end_date?: string | null
          auth_start_date?: string | null
          auth_units?: number | null
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
          therapist_assigned_at?: string | null
          therapist_id?: string | null
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
            foreignKeyName: "clients_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
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
      cpt_modifier_mappings: {
        Row: {
          cpt_code_id: string
          created_at: string
          id: string
          is_default: boolean
          is_required: boolean
          modifier_id: string
          updated_at: string
        }
        Insert: {
          cpt_code_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          is_required?: boolean
          modifier_id: string
          updated_at?: string
        }
        Update: {
          cpt_code_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          is_required?: boolean
          modifier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cpt_modifier_mappings_cpt_code_id_fkey"
            columns: ["cpt_code_id"]
            isOneToOne: false
            referencedRelation: "cpt_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cpt_modifier_mappings_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "billing_modifiers"
            referencedColumns: ["id"]
          },
        ]
      }
      edi_claim_denials: {
        Row: {
          billing_record_id: string
          denial_code: string
          description: string | null
          id: string
          payer_control_number: string | null
          received_at: string
          recorded_at: string
          session_id: string
        }
        Insert: {
          billing_record_id: string
          denial_code: string
          description?: string | null
          id?: string
          payer_control_number?: string | null
          received_at: string
          recorded_at?: string
          session_id: string
        }
        Update: {
          billing_record_id?: string
          denial_code?: string
          description?: string | null
          id?: string
          payer_control_number?: string | null
          received_at?: string
          recorded_at?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edi_claim_denials_billing_record_id_fkey"
            columns: ["billing_record_id"]
            isOneToOne: false
            referencedRelation: "billing_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edi_claim_denials_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      edi_claim_statuses: {
        Row: {
          billing_record_id: string
          claim_control_number: string | null
          created_at: string
          effective_at: string
          export_file_id: string | null
          id: string
          notes: string | null
          session_id: string
          status: string
        }
        Insert: {
          billing_record_id: string
          claim_control_number?: string | null
          created_at?: string
          effective_at: string
          export_file_id?: string | null
          id?: string
          notes?: string | null
          session_id: string
          status: string
        }
        Update: {
          billing_record_id?: string
          claim_control_number?: string | null
          created_at?: string
          effective_at?: string
          export_file_id?: string | null
          id?: string
          notes?: string | null
          session_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "edi_claim_statuses_billing_record_id_fkey"
            columns: ["billing_record_id"]
            isOneToOne: false
            referencedRelation: "billing_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edi_claim_statuses_export_file_id_fkey"
            columns: ["export_file_id"]
            isOneToOne: false
            referencedRelation: "edi_export_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edi_claim_statuses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      edi_export_files: {
        Row: {
          checksum: string
          claim_count: number
          content: string
          created_at: string
          file_name: string
          group_control_number: string
          id: string
          interchange_control_number: string
          transaction_set_control_number: string
        }
        Insert: {
          checksum: string
          claim_count: number
          content: string
          created_at?: string
          file_name: string
          group_control_number: string
          id?: string
          interchange_control_number: string
          transaction_set_control_number: string
        }
        Update: {
          checksum?: string
          claim_count?: number
          content?: string
          created_at?: string
          file_name?: string
          group_control_number?: string
          id?: string
          interchange_control_number?: string
          transaction_set_control_number?: string
        }
        Relationships: []
      }
      employee_manager_assignments: {
        Row: {
          created_at: string
          effective_from: string
          effective_through: string | null
          employment_profile_id: string
          id: string
          manager_user_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          effective_from: string
          effective_through?: string | null
          employment_profile_id: string
          id?: string
          manager_user_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_through?: string | null
          employment_profile_id?: string
          id?: string
          manager_user_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_manager_assignments_employment_profile_id_organiz_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "employee_manager_assignments_manager_user_id_fkey"
            columns: ["manager_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_manager_assignments_manager_user_id_fkey"
            columns: ["manager_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_manager_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_rate_versions: {
        Row: {
          created_at: string
          created_by: string
          effective_from: string
          effective_through: string | null
          employment_profile_id: string
          hourly_rate_cents: number
          id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          effective_from: string
          effective_through?: string | null
          employment_profile_id: string
          hourly_rate_cents: number
          id?: string
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          effective_from?: string
          effective_through?: string | null
          employment_profile_id?: string
          hourly_rate_cents?: number
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_rate_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_rate_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_rate_versions_employment_profile_id_organization__fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "employee_rate_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_time_events: {
        Row: {
          actor_user_id: string
          created_at: string
          employment_profile_id: string
          event_at: string
          event_type: Database["public"]["Enums"]["payroll_event_type"]
          id: string
          metadata: Json
          organization_id: string
          replacement_for_event_id: string | null
          source_note: string | null
          source_timezone: string
          work_category: Database["public"]["Enums"]["work_category"] | null
          work_location: Database["public"]["Enums"]["work_location"]
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          employment_profile_id: string
          event_at: string
          event_type: Database["public"]["Enums"]["payroll_event_type"]
          id?: string
          metadata?: Json
          organization_id: string
          replacement_for_event_id?: string | null
          source_note?: string | null
          source_timezone: string
          work_category?: Database["public"]["Enums"]["work_category"] | null
          work_location: Database["public"]["Enums"]["work_location"]
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          employment_profile_id?: string
          event_at?: string
          event_type?: Database["public"]["Enums"]["payroll_event_type"]
          id?: string
          metadata?: Json
          organization_id?: string
          replacement_for_event_id?: string | null
          source_note?: string | null
          source_timezone?: string
          work_category?: Database["public"]["Enums"]["work_category"] | null
          work_location?: Database["public"]["Enums"]["work_location"]
        }
        Relationships: [
          {
            foreignKeyName: "employee_time_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_time_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_time_events_employment_profile_id_organization_id_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "employee_time_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_time_events_replacement_for_event_id_organization_fkey"
            columns: ["replacement_for_event_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employee_time_events"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      employment_profiles: {
        Row: {
          active_from: string
          active_through: string | null
          classification: string
          created_at: string
          employee_number: string
          home_jurisdiction: string
          id: string
          organization_id: string
          payroll_employee_id: string
          therapist_id: string | null
          timezone: string
          user_id: string
        }
        Insert: {
          active_from: string
          active_through?: string | null
          classification: string
          created_at?: string
          employee_number: string
          home_jurisdiction: string
          id?: string
          organization_id: string
          payroll_employee_id: string
          therapist_id?: string | null
          timezone: string
          user_id: string
        }
        Update: {
          active_from?: string
          active_through?: string | null
          classification?: string
          created_at?: string
          employee_number?: string
          home_jurisdiction?: string
          id?: string
          organization_id?: string
          payroll_employee_id?: string
          therapist_id?: string | null
          timezone?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employment_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_profiles_therapist_id_organization_id_fkey"
            columns: ["therapist_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "employment_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employment_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      error_taxonomy: {
        Row: {
          category: string
          code: string
          description: string
          http_status: number
          retryable: boolean
          severity: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          code: string
          description: string
          http_status: number
          retryable?: boolean
          severity: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          code?: string
          description?: string
          http_status?: number
          retryable?: boolean
          severity?: string
          updated_at?: string
          updated_by?: string | null
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
      feature_flag_plan_history: {
        Row: {
          action: string
          actor_id: string | null
          change_context: string
          feature_flag_id: string | null
          id: string
          new_state: Json | null
          occurred_at: string
          organization_id: string | null
          plan_code: string | null
          previous_state: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          change_context: string
          feature_flag_id?: string | null
          id?: string
          new_state?: Json | null
          occurred_at?: string
          organization_id?: string | null
          plan_code?: string | null
          previous_state?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          change_context?: string
          feature_flag_id?: string | null
          id?: string
          new_state?: Json | null
          occurred_at?: string
          organization_id?: string | null
          plan_code?: string | null
          previous_state?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flag_plan_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flag_plan_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "feature_flag_plan_history_feature_flag_id_fkey"
            columns: ["feature_flag_id"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flag_plan_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_flag_plan_history_plan_code_fkey"
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
      function_idempotency_keys: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          idempotency_key: string
          response_body: Json
          response_hash: string
          status_code: number
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          idempotency_key: string
          response_body: Json
          response_hash: string
          status_code?: number
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          idempotency_key?: string
          response_body?: Json
          response_hash?: string
          status_code?: number
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
      goal_data_points: {
        Row: {
          assessment_document_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          goal_id: string
          id: string
          metric_name: string
          metric_payload: Json
          metric_unit: string | null
          metric_value: number | null
          observed_at: string
          organization_id: string
          session_id: string | null
          source: string
          updated_at: string
        }
        Insert: {
          assessment_document_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          goal_id: string
          id?: string
          metric_name: string
          metric_payload?: Json
          metric_unit?: string | null
          metric_value?: number | null
          observed_at?: string
          organization_id: string
          session_id?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          assessment_document_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          goal_id?: string
          id?: string
          metric_name?: string
          metric_payload?: Json
          metric_unit?: string | null
          metric_value?: number | null
          observed_at?: string
          organization_id?: string
          session_id?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_data_points_assessment_document_id_fkey"
            columns: ["assessment_document_id"]
            isOneToOne: false
            referencedRelation: "assessment_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_data_points_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_data_points_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_data_points_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_data_points_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_domains: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_target_phase_criteria: {
        Row: {
          client_id: string
          clinical_note: string | null
          comparator: string | null
          consecutive_sessions: number | null
          created_at: string
          created_by: string | null
          goal_id: string
          id: string
          metric: string | null
          min_observations: number | null
          organization_id: string
          phase: Database["public"]["Enums"]["goal_target_phase"]
          target_id: string
          threshold: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          clinical_note?: string | null
          comparator?: string | null
          consecutive_sessions?: number | null
          created_at?: string
          created_by?: string | null
          goal_id: string
          id?: string
          metric?: string | null
          min_observations?: number | null
          organization_id: string
          phase: Database["public"]["Enums"]["goal_target_phase"]
          target_id: string
          threshold?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          clinical_note?: string | null
          comparator?: string | null
          consecutive_sessions?: number | null
          created_at?: string
          created_by?: string | null
          goal_id?: string
          id?: string
          metric?: string | null
          min_observations?: number | null
          organization_id?: string
          phase?: Database["public"]["Enums"]["goal_target_phase"]
          target_id?: string
          threshold?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_target_phase_criteria_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_phase_criteria_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_phase_criteria_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_phase_criteria_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "goal_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_target_phase_evaluations: {
        Row: {
          client_id: string
          evaluated_at: string
          evaluated_by: string | null
          goal_id: string
          goal_status: string
          id: string
          metric_value: number | null
          note_id: string | null
          observation_count: number | null
          organization_id: string
          phase: Database["public"]["Enums"]["goal_target_phase"]
          progression_version: number
          result: string
          session_completed_at: string
          session_id: string
          target_id: string
        }
        Insert: {
          client_id: string
          evaluated_at?: string
          evaluated_by?: string | null
          goal_id: string
          goal_status: string
          id?: string
          metric_value?: number | null
          note_id?: string | null
          observation_count?: number | null
          organization_id: string
          phase: Database["public"]["Enums"]["goal_target_phase"]
          progression_version: number
          result: string
          session_completed_at: string
          session_id: string
          target_id: string
        }
        Update: {
          client_id?: string
          evaluated_at?: string
          evaluated_by?: string | null
          goal_id?: string
          goal_status?: string
          id?: string
          metric_value?: number | null
          note_id?: string | null
          observation_count?: number | null
          organization_id?: string
          phase?: Database["public"]["Enums"]["goal_target_phase"]
          progression_version?: number
          result?: string
          session_completed_at?: string
          session_id?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_target_phase_evaluations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_phase_evaluations_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_phase_evaluations_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "client_session_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_phase_evaluations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_phase_evaluations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_phase_evaluations_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "goal_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_target_transitions: {
        Row: {
          actor_id: string | null
          client_id: string
          goal_id: string
          id: string
          metadata: Json
          note_id: string | null
          organization_id: string
          previous_evaluation_window_started_at: string | null
          previous_phase:
            | Database["public"]["Enums"]["goal_target_phase"]
            | null
          previous_progression_version: number
          previous_status: string | null
          previous_target_id: string | null
          reason: string | null
          resulting_evaluation_window_started_at: string | null
          resulting_phase:
            | Database["public"]["Enums"]["goal_target_phase"]
            | null
          resulting_progression_version: number
          resulting_status: string | null
          resulting_target_id: string | null
          session_id: string | null
          source: string
          target_id: string
          transitioned_at: string
        }
        Insert: {
          actor_id?: string | null
          client_id: string
          goal_id: string
          id?: string
          metadata?: Json
          note_id?: string | null
          organization_id: string
          previous_evaluation_window_started_at?: string | null
          previous_phase?:
            | Database["public"]["Enums"]["goal_target_phase"]
            | null
          previous_progression_version: number
          previous_status?: string | null
          previous_target_id?: string | null
          reason?: string | null
          resulting_evaluation_window_started_at?: string | null
          resulting_phase?:
            | Database["public"]["Enums"]["goal_target_phase"]
            | null
          resulting_progression_version: number
          resulting_status?: string | null
          resulting_target_id?: string | null
          session_id?: string | null
          source: string
          target_id: string
          transitioned_at?: string
        }
        Update: {
          actor_id?: string | null
          client_id?: string
          goal_id?: string
          id?: string
          metadata?: Json
          note_id?: string | null
          organization_id?: string
          previous_evaluation_window_started_at?: string | null
          previous_phase?:
            | Database["public"]["Enums"]["goal_target_phase"]
            | null
          previous_progression_version?: number
          previous_status?: string | null
          previous_target_id?: string | null
          reason?: string | null
          resulting_evaluation_window_started_at?: string | null
          resulting_phase?:
            | Database["public"]["Enums"]["goal_target_phase"]
            | null
          resulting_progression_version?: number
          resulting_status?: string | null
          resulting_target_id?: string | null
          session_id?: string | null
          source?: string
          target_id?: string
          transitioned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_target_transitions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_transitions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_transitions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "client_session_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_transitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_transitions_previous_target_id_fkey"
            columns: ["previous_target_id"]
            isOneToOne: false
            referencedRelation: "goal_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_transitions_resulting_target_id_fkey"
            columns: ["resulting_target_id"]
            isOneToOne: false
            referencedRelation: "goal_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_transitions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_target_transitions_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "goal_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_targets: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          current_phase: Database["public"]["Enums"]["goal_target_phase"] | null
          evaluation_window_started_at: string | null
          goal_id: string
          graph_config: Json
          id: string
          is_current: boolean
          measurement_type: string
          name: string
          organization_id: string
          progression_version: number
          sort_order: number
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          current_phase?:
            | Database["public"]["Enums"]["goal_target_phase"]
            | null
          evaluation_window_started_at?: string | null
          goal_id: string
          graph_config?: Json
          id?: string
          is_current?: boolean
          measurement_type: string
          name: string
          organization_id: string
          progression_version?: number
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          current_phase?:
            | Database["public"]["Enums"]["goal_target_phase"]
            | null
          evaluation_window_started_at?: string | null
          goal_id?: string
          graph_config?: Json
          id?: string
          is_current?: boolean
          measurement_type?: string
          name?: string
          organization_id?: string
          progression_version?: number
          sort_order?: number
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_targets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_targets_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_versions: {
        Row: {
          baseline_data: string | null
          change_reason: string | null
          changed_at: string
          changed_by: string
          client_id: string
          clinical_context: string | null
          description: string
          generalization_criteria: string | null
          goal_id: string
          id: string
          maintenance_criteria: string | null
          mastery_criteria: string | null
          measurement_type: string | null
          objective_data_points: Json
          organization_id: string
          original_text: string
          program_id: string
          status: string
          target_behavior: string | null
          target_criteria: string | null
          title: string
        }
        Insert: {
          baseline_data?: string | null
          change_reason?: string | null
          changed_at?: string
          changed_by: string
          client_id: string
          clinical_context?: string | null
          description: string
          generalization_criteria?: string | null
          goal_id: string
          id?: string
          maintenance_criteria?: string | null
          mastery_criteria?: string | null
          measurement_type?: string | null
          objective_data_points?: Json
          organization_id: string
          original_text: string
          program_id: string
          status: string
          target_behavior?: string | null
          target_criteria?: string | null
          title: string
        }
        Update: {
          baseline_data?: string | null
          change_reason?: string | null
          changed_at?: string
          changed_by?: string
          client_id?: string
          clinical_context?: string | null
          description?: string
          generalization_criteria?: string | null
          goal_id?: string
          id?: string
          maintenance_criteria?: string | null
          mastery_criteria?: string | null
          measurement_type?: string | null
          objective_data_points?: Json
          organization_id?: string
          original_text?: string
          program_id?: string
          status?: string
          target_behavior?: string | null
          target_criteria?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_versions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_versions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_versions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          baseline: string | null
          baseline_data: string | null
          client_id: string
          clinical_context: string | null
          clinical_goal_type: string | null
          created_at: string
          created_by: string | null
          description: string
          domain_id: string | null
          generalization_criteria: string | null
          goal_type: string
          id: string
          maintenance_criteria: string | null
          mastery_criteria: string | null
          measurement_type: string | null
          objective_data_points: Json
          operational_definition: string | null
          organization_id: string
          original_text: string
          program_id: string
          source: string
          status: string
          target_behavior: string | null
          target_criteria: string | null
          teaching_strategies: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          baseline?: string | null
          baseline_data?: string | null
          client_id: string
          clinical_context?: string | null
          clinical_goal_type?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          domain_id?: string | null
          generalization_criteria?: string | null
          goal_type?: string
          id?: string
          maintenance_criteria?: string | null
          mastery_criteria?: string | null
          measurement_type?: string | null
          objective_data_points?: Json
          operational_definition?: string | null
          organization_id: string
          original_text: string
          program_id: string
          source?: string
          status?: string
          target_behavior?: string | null
          target_criteria?: string | null
          teaching_strategies?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          baseline?: string | null
          baseline_data?: string | null
          client_id?: string
          clinical_context?: string | null
          clinical_goal_type?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          domain_id?: string | null
          generalization_criteria?: string | null
          goal_type?: string
          id?: string
          maintenance_criteria?: string | null
          mastery_criteria?: string | null
          measurement_type?: string | null
          objective_data_points?: Json
          operational_definition?: string | null
          organization_id?: string
          original_text?: string
          program_id?: string
          source?: string
          status?: string
          target_behavior?: string | null
          target_criteria?: string | null
          teaching_strategies?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_domain_id_fkey"
            columns: ["domain_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "goal_domains"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_link_queue: {
        Row: {
          approved_client_ids: string[]
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
          requested_client_ids: string[]
          resolution_notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_client_ids?: string[]
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
          requested_client_ids?: string[]
          resolution_notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_client_ids?: string[]
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
          requested_client_ids?: string[]
          resolution_notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_link_queue_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_link_queue_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "guardian_link_queue_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_link_queue_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "guardian_link_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_link_queue_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_link_queue_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          phone?: string | null
          state?: string | null
          type?: string
          updated_at?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      message_thread_participants: {
        Row: {
          archived_at: string | null
          joined_at: string
          last_read_at: string | null
          muted_at: string | null
          organization_id: string
          thread_id: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          joined_at?: string
          last_read_at?: string | null
          muted_at?: string | null
          organization_id: string
          thread_id: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          joined_at?: string
          last_read_at?: string | null
          muted_at?: string | null
          organization_id?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_thread_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_thread_participants_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_thread_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_thread_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      message_threads: {
        Row: {
          created_at: string
          created_by: string
          id: string
          organization_id: string
          subject: string | null
          thread_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          subject?: string | null
          thread_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          subject?: string | null
          thread_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_threads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_threads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "message_threads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          sender_id: string
          thread_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          sender_id: string
          thread_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sender_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id"]
          },
        ]
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
      pay_group_assignments: {
        Row: {
          created_at: string
          effective_from: string
          effective_through: string | null
          employment_profile_id: string
          id: string
          organization_id: string
          pay_group_id: string
        }
        Insert: {
          created_at?: string
          effective_from: string
          effective_through?: string | null
          employment_profile_id: string
          id?: string
          organization_id: string
          pay_group_id: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_through?: string | null
          employment_profile_id?: string
          id?: string
          organization_id?: string
          pay_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_group_assignments_employment_profile_id_organization_i_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pay_group_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_group_assignments_pay_group_id_organization_id_fkey"
            columns: ["pay_group_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pay_groups"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      pay_groups: {
        Row: {
          cadence: Database["public"]["Enums"]["pay_group_cadence"]
          created_at: string
          id: string
          name: string
          organization_id: string
          timezone: string
        }
        Insert: {
          cadence: Database["public"]["Enums"]["pay_group_cadence"]
          created_at?: string
          id?: string
          name: string
          organization_id: string
          timezone: string
        }
        Update: {
          cadence?: Database["public"]["Enums"]["pay_group_cadence"]
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_periods: {
        Row: {
          created_at: string
          ends_on: string
          exported_at: string | null
          id: string
          locked_at: string | null
          organization_id: string
          pay_group_id: string
          starts_on: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          exported_at?: string | null
          id?: string
          locked_at?: string | null
          organization_id: string
          pay_group_id: string
          starts_on: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          exported_at?: string | null
          id?: string
          locked_at?: string | null
          organization_id?: string
          pay_group_id?: string
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_periods_pay_group_id_organization_id_fkey"
            columns: ["pay_group_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pay_groups"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      payroll_audit_events: {
        Row: {
          actor_user_id: string
          created_at: string
          id: string
          operation: string
          organization_id: string
          payload: Json
          target_row_id: string
          target_table: string
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          id?: string
          operation: string
          organization_id: string
          payload?: Json
          target_row_id: string
          target_table: string
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          id?: string
          operation?: string
          organization_id?: string
          payload?: Json
          target_row_id?: string
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_blocker_resolutions: {
        Row: {
          action: string
          actor_user_id: string
          blocker_type: string
          comment: string | null
          created_at: string
          employment_profile_id: string
          id: string
          idempotency_key: string
          occurred_at: string
          organization_id: string
          pay_period_id: string
          payload_hash: string
          previous_resolution_id: string | null
          reason: string | null
          received_at: string
          session_attendance_correction_request_id: string | null
          time_correction_request_id: string | null
          timekeeping_exception_id: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          blocker_type: string
          comment?: string | null
          created_at?: string
          employment_profile_id: string
          id?: string
          idempotency_key: string
          occurred_at?: string
          organization_id: string
          pay_period_id: string
          payload_hash: string
          previous_resolution_id?: string | null
          reason?: string | null
          received_at?: string
          session_attendance_correction_request_id?: string | null
          time_correction_request_id?: string | null
          timekeeping_exception_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          blocker_type?: string
          comment?: string | null
          created_at?: string
          employment_profile_id?: string
          id?: string
          idempotency_key?: string
          occurred_at?: string
          organization_id?: string
          pay_period_id?: string
          payload_hash?: string
          previous_resolution_id?: string | null
          reason?: string | null
          received_at?: string
          session_attendance_correction_request_id?: string | null
          time_correction_request_id?: string | null
          timekeeping_exception_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_blocker_resolutions_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_employment_profile_id_organiza_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_pay_period_id_organization_id_fkey"
            columns: ["pay_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_previous_resolution_id_organiz_fkey"
            columns: ["previous_resolution_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payroll_blocker_resolution_current_states"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_previous_resolution_id_organiz_fkey"
            columns: ["previous_resolution_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payroll_blocker_resolutions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_session_attendance_correction__fkey"
            columns: [
              "session_attendance_correction_request_id",
              "organization_id",
            ]
            isOneToOne: false
            referencedRelation: "session_attendance_correction_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_time_correction_request_id_org_fkey"
            columns: ["time_correction_request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "time_correction_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_timekeeping_exception_id_organ_fkey"
            columns: ["timekeeping_exception_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "timekeeping_exceptions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      payroll_capability_grants: {
        Row: {
          capability: Database["public"]["Enums"]["payroll_capability"]
          created_at: string
          effective_from: string
          effective_through: string | null
          granted_by: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          capability: Database["public"]["Enums"]["payroll_capability"]
          created_at?: string
          effective_from?: string
          effective_through?: string | null
          granted_by: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          capability?: Database["public"]["Enums"]["payroll_capability"]
          created_at?: string
          effective_from?: string
          effective_through?: string | null
          granted_by?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_capability_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_capability_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_capability_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_capability_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_capability_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payroll_legal_holds: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          employment_profile_id: string | null
          hold_reason_code: string
          id: string
          organization_id: string
          pay_period_id: string | null
          record_category: string | null
          released_at: string | null
          released_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          employment_profile_id?: string | null
          hold_reason_code: string
          id?: string
          organization_id: string
          pay_period_id?: string | null
          record_category?: string | null
          released_at?: string | null
          released_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          employment_profile_id?: string | null
          hold_reason_code?: string
          id?: string
          organization_id?: string
          pay_period_id?: string | null
          record_category?: string | null
          released_at?: string | null
          released_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_legal_holds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_legal_holds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_legal_holds_employment_profile_id_organization_id_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_legal_holds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_legal_holds_pay_period_id_organization_id_fkey"
            columns: ["pay_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_legal_holds_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_legal_holds_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payroll_mutation_receipts: {
        Row: {
          actor_user_id: string
          created_at: string
          id: string
          idempotency_key: string
          operation: string
          organization_id: string
          payload_hash: string
          result_payload: Json
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          operation: string
          organization_id: string
          payload_hash: string
          result_payload: Json
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          operation?: string
          organization_id?: string
          payload_hash?: string
          result_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "payroll_mutation_receipts_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_mutation_receipts_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_mutation_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_organization_settings: {
        Row: {
          created_at: string
          external_payroll_organization_id: string
          id: string
          organization_id: string
          timezone: string
          updated_at: string
          workday_starts_at: string
          workweek_starts_on: number
        }
        Insert: {
          created_at?: string
          external_payroll_organization_id: string
          id?: string
          organization_id: string
          timezone: string
          updated_at?: string
          workday_starts_at?: string
          workweek_starts_on?: number
        }
        Update: {
          created_at?: string
          external_payroll_organization_id?: string
          id?: string
          organization_id?: string
          timezone?: string
          updated_at?: string
          workday_starts_at?: string
          workweek_starts_on?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_policy_versions: {
        Row: {
          activation_status: Database["public"]["Enums"]["payroll_policy_activation_status"]
          created_at: string
          effective_from: string
          effective_through: string | null
          id: string
          jurisdiction: string
          organization_id: string | null
          policy_name: string
          supports_monthly_nonexempt: boolean
        }
        Insert: {
          activation_status?: Database["public"]["Enums"]["payroll_policy_activation_status"]
          created_at?: string
          effective_from?: string
          effective_through?: string | null
          id?: string
          jurisdiction: string
          organization_id?: string | null
          policy_name: string
          supports_monthly_nonexempt?: boolean
        }
        Update: {
          activation_status?: Database["public"]["Enums"]["payroll_policy_activation_status"]
          created_at?: string
          effective_from?: string
          effective_through?: string | null
          id?: string
          jurisdiction?: string
          organization_id?: string | null
          policy_name?: string
          supports_monthly_nonexempt?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payroll_policy_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_retention_policies: {
        Row: {
          created_at: string
          effective_from: string
          id: string
          organization_id: string
          retention_years: number
        }
        Insert: {
          created_at?: string
          effective_from?: string
          id?: string
          organization_id: string
          retention_years: number
        }
        Update: {
          created_at?: string
          effective_from?: string
          id?: string
          organization_id?: string
          retention_years?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_retention_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          created_at: string
          email: string
          first_name: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          last_login_at: string | null
          last_name: string | null
          organization_id: string | null
          phone: string | null
          preferences: Json | null
          role: string
          time_zone: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          organization_id?: string | null
          phone?: string | null
          preferences?: Json | null
          role?: string
          time_zone?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          organization_id?: string | null
          phone?: string | null
          preferences?: Json | null
          role?: string
          time_zone?: string | null
          title?: string | null
          updated_at?: string
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
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      program_notes: {
        Row: {
          author_id: string | null
          content: Json
          created_at: string
          id: string
          note_type: string
          organization_id: string
          program_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          content?: Json
          created_at?: string
          id?: string
          note_type: string
          organization_id: string
          program_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          content?: Json
          created_at?: string
          id?: string
          note_type?: string
          organization_id?: string
          program_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_notes_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          id: string
          name: string
          organization_id: string
          start_date: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          organization_id: string
          start_date?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          organization_id?: string
          start_date?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "programs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      query_performance_metrics: {
        Row: {
          affected_rows: number | null
          cache_hit: boolean | null
          created_at: string
          data_size_bytes: number | null
          duration_ms: number
          error_message: string | null
          error_occurred: boolean | null
          id: string
          operation: string
          query_complexity: string | null
          query_key: string
          session_id: string
          timestamp: string
          user_id: string | null
        }
        Insert: {
          affected_rows?: number | null
          cache_hit?: boolean | null
          created_at?: string
          data_size_bytes?: number | null
          duration_ms: number
          error_message?: string | null
          error_occurred?: boolean | null
          id?: string
          operation: string
          query_complexity?: string | null
          query_key: string
          session_id: string
          timestamp?: string
          user_id?: string | null
        }
        Update: {
          affected_rows?: number | null
          cache_hit?: boolean | null
          created_at?: string
          data_size_bytes?: number | null
          duration_ms?: number
          error_message?: string | null
          error_occurred?: boolean | null
          id?: string
          operation?: string
          query_complexity?: string | null
          query_key?: string
          session_id?: string
          timestamp?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "query_performance_metrics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "query_performance_metrics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
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
          name: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      scheduling_orchestration_runs: {
        Row: {
          correlation_id: string
          created_at: string
          id: string
          inputs: Json | null
          organization_id: string | null
          outputs: Json | null
          request_id: string
          rollback_plan: Json | null
          status: string
          workflow: string
        }
        Insert: {
          correlation_id: string
          created_at?: string
          id?: string
          inputs?: Json | null
          organization_id?: string | null
          outputs?: Json | null
          request_id: string
          rollback_plan?: Json | null
          status: string
          workflow: string
        }
        Update: {
          correlation_id?: string
          created_at?: string
          id?: string
          inputs?: Json | null
          organization_id?: string | null
          outputs?: Json | null
          request_id?: string
          rollback_plan?: Json | null
          status?: string
          workflow?: string
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
      service_contract_rates: {
        Row: {
          contract_id: string
          cpt_code_id: string
          created_at: string
          id: string
          modifiers: string[]
          organization_id: string
          rate: number
          updated_at: string
        }
        Insert: {
          contract_id: string
          cpt_code_id: string
          created_at?: string
          id?: string
          modifiers?: string[]
          organization_id: string
          rate: number
          updated_at?: string
        }
        Update: {
          contract_id?: string
          cpt_code_id?: string
          created_at?: string
          id?: string
          modifiers?: string[]
          organization_id?: string
          rate?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_contract_rates_contract_fk"
            columns: ["contract_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "service_contracts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "service_contract_rates_cpt_code_id_fkey"
            columns: ["cpt_code_id"]
            isOneToOne: false
            referencedRelation: "cpt_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_contract_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_contract_versions: {
        Row: {
          contract_id: string
          file_url: string | null
          id: string
          organization_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          contract_id: string
          file_url?: string | null
          id?: string
          organization_id: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          contract_id?: string
          file_url?: string | null
          id?: string
          organization_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_contract_versions_contract_fk"
            columns: ["contract_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "service_contracts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "service_contract_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_contract_versions_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_contract_versions_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      service_contracts: {
        Row: {
          authorized_units: number
          client_id: string
          confidence_score: number | null
          created_at: string
          created_by: string | null
          effective_date: string
          file_url: string | null
          id: string
          insurance_provider_id: string | null
          organization_id: string
          payer_name: string
          reimbursement_method: string
          termination_date: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          authorized_units?: number
          client_id: string
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          effective_date: string
          file_url?: string | null
          id?: string
          insurance_provider_id?: string | null
          organization_id: string
          payer_name: string
          reimbursement_method?: string
          termination_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          authorized_units?: number
          client_id?: string
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          effective_date?: string
          file_url?: string | null
          id?: string
          insurance_provider_id?: string | null
          organization_id?: string
          payer_name?: string
          reimbursement_method?: string
          termination_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_contracts_insurance_provider_id_fkey"
            columns: ["insurance_provider_id"]
            isOneToOne: false
            referencedRelation: "insurance_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_contracts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_contracts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
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
      session_attendance_correction_requests: {
        Row: {
          created_at: string
          employment_profile_id: string
          id: string
          organization_id: string
          reason_code: string
          replacement_payload: Json
          requested_by: string
          session_attendance_event_id: string
        }
        Insert: {
          created_at?: string
          employment_profile_id: string
          id?: string
          organization_id: string
          reason_code: string
          replacement_payload?: Json
          requested_by: string
          session_attendance_event_id: string
        }
        Update: {
          created_at?: string
          employment_profile_id?: string
          id?: string
          organization_id?: string
          reason_code?: string
          replacement_payload?: Json
          requested_by?: string
          session_attendance_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_attendance_correction_employment_profile_id_organi_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "session_attendance_correction_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_correction_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_correction_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "session_attendance_correction_session_attendance_event_id__fkey"
            columns: ["session_attendance_event_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "session_attendance_events"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      session_attendance_events: {
        Row: {
          actor_user_id: string
          created_at: string
          employee_time_event_id: string | null
          employment_profile_id: string
          event_at: string
          event_type: Database["public"]["Enums"]["session_attendance_event_type"]
          id: string
          metadata: Json
          organization_id: string
          replacement_for_event_id: string | null
          session_id: string
          source_note: string | null
          source_timezone: string
          work_location: Database["public"]["Enums"]["work_location"]
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          employee_time_event_id?: string | null
          employment_profile_id: string
          event_at: string
          event_type: Database["public"]["Enums"]["session_attendance_event_type"]
          id?: string
          metadata?: Json
          organization_id: string
          replacement_for_event_id?: string | null
          session_id: string
          source_note?: string | null
          source_timezone: string
          work_location: Database["public"]["Enums"]["work_location"]
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          employee_time_event_id?: string | null
          employment_profile_id?: string
          event_at?: string
          event_type?: Database["public"]["Enums"]["session_attendance_event_type"]
          id?: string
          metadata?: Json
          organization_id?: string
          replacement_for_event_id?: string | null
          session_id?: string
          source_note?: string | null
          source_timezone?: string
          work_location?: Database["public"]["Enums"]["work_location"]
        }
        Relationships: [
          {
            foreignKeyName: "session_attendance_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "session_attendance_events_employee_time_event_id_organizat_fkey"
            columns: ["employee_time_event_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employee_time_events"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "session_attendance_events_employment_profile_id_organizati_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "session_attendance_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_events_replacement_for_event_id_organiz_fkey"
            columns: ["replacement_for_event_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "session_attendance_events"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "session_attendance_events_session_id_organization_id_fkey"
            columns: ["session_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      session_audit_logs: {
        Row: {
          actor_id: string | null
          created_at: string
          event_payload: Json
          event_type: string
          id: string
          organization_id: string
          session_id: string
          therapist_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_payload?: Json
          event_type: string
          id?: string
          organization_id: string
          session_id: string
          therapist_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_payload?: Json
          event_type?: string
          id?: string
          organization_id?: string
          session_id?: string
          therapist_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_audit_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_audit_logs_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
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
          created_at: string
          id: string
          modifier_id: string
          position: number
          session_cpt_entry_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          modifier_id: string
          position?: number
          session_cpt_entry_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          modifier_id?: string
          position?: number
          session_cpt_entry_id?: string
          updated_at?: string
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
            referencedRelation: "session_cpt_details_vw"
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
      session_goals: {
        Row: {
          client_id: string
          created_at: string
          goal_id: string
          organization_id: string
          program_id: string
          session_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          goal_id: string
          organization_id: string
          program_id: string
          session_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          goal_id?: string
          organization_id?: string
          program_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_goals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_goals_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_goals_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_goals_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
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
          hold_key?: string
          id?: string
          organization_id: string
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
            foreignKeyName: "session_holds_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_holds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      session_note_attestations: {
        Row: {
          attestation_role: string
          id: string
          note_id: string | null
          organization_id: string
          signature_method: string
          signature_value: string
          signed_at: string
          signer_user_id: string
          supervision_note_id: string | null
        }
        Insert: {
          attestation_role: string
          id?: string
          note_id?: string | null
          organization_id: string
          signature_method: string
          signature_value: string
          signed_at?: string
          signer_user_id: string
          supervision_note_id?: string | null
        }
        Update: {
          attestation_role?: string
          id?: string
          note_id?: string | null
          organization_id?: string
          signature_method?: string
          signature_value?: string
          signed_at?: string
          signer_user_id?: string
          supervision_note_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_note_attestations_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "client_session_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_note_attestations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_note_attestations_signer_user_id_fkey"
            columns: ["signer_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_note_attestations_signer_user_id_fkey"
            columns: ["signer_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "session_note_attestations_supervision_note_id_fkey"
            columns: ["supervision_note_id"]
            isOneToOne: false
            referencedRelation: "supervision_session_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      session_note_pdf_exports: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          error: string | null
          expires_at: string | null
          id: string
          note_ids: string[]
          organization_id: string
          request_id: string | null
          requested_by: string
          started_at: string | null
          status: string
          storage_bucket: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          error?: string | null
          expires_at?: string | null
          id?: string
          note_ids: string[]
          organization_id: string
          request_id?: string | null
          requested_by: string
          started_at?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          error?: string | null
          expires_at?: string | null
          id?: string
          note_ids?: string[]
          organization_id?: string
          request_id?: string | null
          requested_by?: string
          started_at?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_note_pdf_exports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_note_pdf_exports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          template_structure?: Json
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
        Relationships: [
          {
            foreignKeyName: "session_note_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
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
          appointment_id: string | null
          cancellation_attribution: string | null
          client_id: string
          created_at: string | null
          created_by: string | null
          duration_minutes: number | null
          end_time: string
          goal_id: string | null
          has_transcription_consent: boolean
          id: string
          location_type: string | null
          metadata: Json
          notes: string | null
          organization_id: string
          program_id: string | null
          rate_per_hour: number | null
          session_date: string | null
          session_type: string | null
          start_time: string
          started_at: string | null
          status: string
          therapist_id: string
          total_cost: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          appointment_id?: string | null
          cancellation_attribution?: string | null
          client_id: string
          created_at?: string | null
          created_by?: string | null
          duration_minutes?: number | null
          end_time: string
          goal_id?: string | null
          has_transcription_consent?: boolean
          id?: string
          location_type?: string | null
          metadata?: Json
          notes?: string | null
          organization_id: string
          program_id?: string | null
          rate_per_hour?: number | null
          session_date?: string | null
          session_type?: string | null
          start_time: string
          started_at?: string | null
          status?: string
          therapist_id: string
          total_cost?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          appointment_id?: string | null
          cancellation_attribution?: string | null
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          duration_minutes?: number | null
          end_time?: string
          goal_id?: string | null
          has_transcription_consent?: boolean
          id?: string
          location_type?: string | null
          metadata?: Json
          notes?: string | null
          organization_id?: string
          program_id?: string | null
          rate_per_hour?: number | null
          session_date?: string | null
          session_type?: string | null
          start_time?: string
          started_at?: string | null
          status?: string
          therapist_id?: string
          total_cost?: number | null
          updated_at?: string
          updated_by?: string | null
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
            foreignKeyName: "sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sessions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      supervision_session_note_corrections: {
        Row: {
          correction_reason: string
          correction_round: number
          id: string
          organization_id: string
          request_id: string
          requested_at: string
          resolved_at: string | null
          resolving_bt_user_id: string | null
          resulting_amendment_id: string | null
          reviewer_user_id: string
        }
        Insert: {
          correction_reason: string
          correction_round: number
          id?: string
          organization_id: string
          request_id: string
          requested_at?: string
          resolved_at?: string | null
          resolving_bt_user_id?: string | null
          resulting_amendment_id?: string | null
          reviewer_user_id: string
        }
        Update: {
          correction_reason?: string
          correction_round?: number
          id?: string
          organization_id?: string
          request_id?: string
          requested_at?: string
          resolved_at?: string | null
          resolving_bt_user_id?: string | null
          resulting_amendment_id?: string | null
          reviewer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supervision_session_note_correc_request_id_organization_id_fkey"
            columns: ["request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "supervision_session_note_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supervision_session_note_corrections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_note_corrections_resolving_bt_user_id_fkey"
            columns: ["resolving_bt_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_note_corrections_resolving_bt_user_id_fkey"
            columns: ["resolving_bt_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "supervision_session_note_corrections_resulting_amendment_id_fke"
            columns: ["resulting_amendment_id", "id"]
            isOneToOne: false
            referencedRelation: "bt_session_note_amendments"
            referencedColumns: ["id", "correction_id"]
          },
          {
            foreignKeyName: "supervision_session_note_corrections_reviewer_user_id_fkey"
            columns: ["reviewer_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_note_corrections_reviewer_user_id_fkey"
            columns: ["reviewer_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      supervision_session_note_requests: {
        Row: {
          assigned_admin_user_id: string | null
          bt_therapist_id: string
          cancellation_reason: string | null
          cancellation_source: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          id: string
          organization_id: string
          reopen_source: string | null
          reopened_at: string | null
          reopened_by: string | null
          requested_by: string | null
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_admin_user_id?: string | null
          bt_therapist_id: string
          cancellation_reason?: string | null
          cancellation_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          organization_id: string
          reopen_source?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          requested_by?: string | null
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_admin_user_id?: string | null
          bt_therapist_id?: string
          cancellation_reason?: string | null
          cancellation_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          reopen_source?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          requested_by?: string | null
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supervision_session_note_requests_assigned_admin_user_id_fkey"
            columns: ["assigned_admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_note_requests_assigned_admin_user_id_fkey"
            columns: ["assigned_admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "supervision_session_note_requests_bt_therapist_id_fkey"
            columns: ["bt_therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_note_requests_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_note_requests_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "supervision_session_note_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_note_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_note_requests_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_note_requests_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "supervision_session_note_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_note_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "supervision_session_note_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      supervision_session_notes: {
        Row: {
          completed_by: string
          created_at: string
          id: string
          organization_id: string
          request_id: string
          responses: Json
          session_id: string
          signed_at: string | null
          template_id: string
          updated_at: string
        }
        Insert: {
          completed_by: string
          created_at?: string
          id?: string
          organization_id: string
          request_id: string
          responses?: Json
          session_id: string
          signed_at?: string | null
          template_id: string
          updated_at?: string
        }
        Update: {
          completed_by?: string
          created_at?: string
          id?: string
          organization_id?: string
          request_id?: string
          responses?: Json
          session_id?: string
          signed_at?: string | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supervision_session_notes_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_notes_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "supervision_session_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_notes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "supervision_session_note_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_notes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_session_notes_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "session_note_templates"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id?: string
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
            foreignKeyName: "therapist_certifications_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "therapists"
            referencedColumns: ["id"]
          },
        ]
      }
      therapist_documents: {
        Row: {
          bucket_id: string
          created_at: string
          document_key: string
          id: string
          object_path: string
          organization_id: string
          therapist_id: string
        }
        Insert: {
          bucket_id?: string
          created_at?: string
          document_key: string
          id?: string
          object_path: string
          organization_id: string
          therapist_id: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          document_key?: string
          id?: string
          object_path?: string
          organization_id?: string
          therapist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "therapist_documents_therapist_id_fkey"
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
          first_name: string
          full_name: string
          id: string
          last_name: string
          latitude: number | null
          license_number: string | null
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
          status: string
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
          first_name: string
          full_name: string
          id?: string
          last_name: string
          latitude?: number | null
          license_number?: string | null
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
          status?: string
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
          first_name?: string
          full_name?: string
          id?: string
          last_name?: string
          latitude?: number | null
          license_number?: string | null
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
          status?: string
          street?: string | null
          supervisor?: string | null
          taxonomy_code?: string | null
          time_zone?: string | null
          title?: string | null
          weekly_hours_max?: number | null
          weekly_hours_min?: number | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "therapists_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "therapists_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      time_correction_requests: {
        Row: {
          created_at: string
          employment_profile_id: string
          id: string
          organization_id: string
          original_event_id: string
          reason_code: string
          replacement_payload: Json
          requested_by: string
        }
        Insert: {
          created_at?: string
          employment_profile_id: string
          id?: string
          organization_id: string
          original_event_id: string
          reason_code: string
          replacement_payload?: Json
          requested_by: string
        }
        Update: {
          created_at?: string
          employment_profile_id?: string
          id?: string
          organization_id?: string
          original_event_id?: string
          reason_code?: string
          replacement_payload?: Json
          requested_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_correction_requests_employment_profile_id_organizatio_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "time_correction_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_correction_requests_original_event_id_organization_id_fkey"
            columns: ["original_event_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employee_time_events"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "time_correction_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_correction_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      timekeeping_exceptions: {
        Row: {
          created_at: string
          details: Json
          employment_profile_id: string
          exception_code: string
          id: string
          organization_id: string
          source_session_attendance_event_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          employment_profile_id: string
          exception_code: string
          id?: string
          organization_id: string
          source_session_attendance_event_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          employment_profile_id?: string
          exception_code?: string
          id?: string
          organization_id?: string
          source_session_attendance_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timekeeping_exceptions_employment_profile_id_organization__fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timekeeping_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timekeeping_exceptions_source_session_attendance_event_fkey"
            columns: ["source_session_attendance_event_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "session_attendance_events"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      timesheet_approvals: {
        Row: {
          action: string
          actor_user_id: string
          attestation: boolean | null
          comment: string | null
          created_at: string
          employment_profile_id: string
          id: string
          idempotency_key: string
          occurred_at: string
          organization_id: string
          pay_period_id: string
          payload_hash: string
          previous_transition_id: string | null
          reason: string | null
          received_at: string
          snapshot_hash: string
          snapshot_id: string
        }
        Insert: {
          action: string
          actor_user_id: string
          attestation?: boolean | null
          comment?: string | null
          created_at?: string
          employment_profile_id: string
          id?: string
          idempotency_key: string
          occurred_at?: string
          organization_id: string
          pay_period_id: string
          payload_hash: string
          previous_transition_id?: string | null
          reason?: string | null
          received_at?: string
          snapshot_hash: string
          snapshot_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          attestation?: boolean | null
          comment?: string | null
          created_at?: string
          employment_profile_id?: string
          id?: string
          idempotency_key?: string
          occurred_at?: string
          organization_id?: string
          pay_period_id?: string
          payload_hash?: string
          previous_transition_id?: string | null
          reason?: string | null
          received_at?: string
          snapshot_hash?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_approvals_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_approvals_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_approvals_employment_profile_id_organization_id_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_approvals_pay_period_id_organization_id_fkey"
            columns: ["pay_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_approvals_previous_transition_id_organization_id_fkey"
            columns: ["previous_transition_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "timesheet_approval_current_states"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_approvals_previous_transition_id_organization_id_fkey"
            columns: ["previous_transition_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "timesheet_approvals"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_approvals_snapshot_id_organization_id_employment_fkey"
            columns: [
              "snapshot_id",
              "organization_id",
              "employment_profile_id",
              "pay_period_id",
            ]
            isOneToOne: false
            referencedRelation: "timesheet_snapshots"
            referencedColumns: [
              "id",
              "organization_id",
              "employment_profile_id",
              "pay_period_id",
            ]
          },
        ]
      }
      timesheet_meal_resolutions: {
        Row: {
          created_at: string
          deadline_at: string
          employment_profile_id: string
          id: string
          meal_end_event_id: string | null
          meal_ordinal: number
          meal_start_event_id: string | null
          organization_id: string
          pay_period_id: string
          resolution_code: string
          resolution_reason: string | null
          resolved_at: string
          resolved_by: string
          shift_start_event_id: string
        }
        Insert: {
          created_at?: string
          deadline_at: string
          employment_profile_id: string
          id?: string
          meal_end_event_id?: string | null
          meal_ordinal: number
          meal_start_event_id?: string | null
          organization_id: string
          pay_period_id: string
          resolution_code: string
          resolution_reason?: string | null
          resolved_at?: string
          resolved_by: string
          shift_start_event_id: string
        }
        Update: {
          created_at?: string
          deadline_at?: string
          employment_profile_id?: string
          id?: string
          meal_end_event_id?: string | null
          meal_ordinal?: number
          meal_start_event_id?: string | null
          organization_id?: string
          pay_period_id?: string
          resolution_code?: string
          resolution_reason?: string | null
          resolved_at?: string
          resolved_by?: string
          shift_start_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_meal_resolutions_employment_profile_id_organizat_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_meal_resolutions_meal_end_event_id_organization__fkey"
            columns: [
              "meal_end_event_id",
              "organization_id",
              "employment_profile_id",
            ]
            isOneToOne: false
            referencedRelation: "employee_time_events"
            referencedColumns: [
              "id",
              "organization_id",
              "employment_profile_id",
            ]
          },
          {
            foreignKeyName: "timesheet_meal_resolutions_meal_start_event_id_organizatio_fkey"
            columns: [
              "meal_start_event_id",
              "organization_id",
              "employment_profile_id",
            ]
            isOneToOne: false
            referencedRelation: "employee_time_events"
            referencedColumns: [
              "id",
              "organization_id",
              "employment_profile_id",
            ]
          },
          {
            foreignKeyName: "timesheet_meal_resolutions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_meal_resolutions_pay_period_id_organization_id_fkey"
            columns: ["pay_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_meal_resolutions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_meal_resolutions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_meal_resolutions_shift_start_event_id_organizati_fkey"
            columns: [
              "shift_start_event_id",
              "organization_id",
              "employment_profile_id",
            ]
            isOneToOne: false
            referencedRelation: "employee_time_events"
            referencedColumns: [
              "id",
              "organization_id",
              "employment_profile_id",
            ]
          },
        ]
      }
      timesheet_snapshot_current_heads: {
        Row: {
          created_at: string
          created_by: string
          employment_profile_id: string
          id: string
          organization_id: string
          pay_period_id: string
          prior_snapshot_id: string | null
          snapshot_id: string
          source_hash: string
        }
        Insert: {
          created_at?: string
          created_by: string
          employment_profile_id: string
          id?: string
          organization_id: string
          pay_period_id: string
          prior_snapshot_id?: string | null
          snapshot_id: string
          source_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string
          employment_profile_id?: string
          id?: string
          organization_id?: string
          pay_period_id?: string
          prior_snapshot_id?: string | null
          snapshot_id?: string
          source_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_snapshot_current_he_employment_profile_id_organi_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_snapshot_current_he_pay_period_id_organization_i_fkey"
            columns: ["pay_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_snapshot_current_he_prior_snapshot_id_organizati_fkey"
            columns: [
              "prior_snapshot_id",
              "organization_id",
              "employment_profile_id",
              "pay_period_id",
            ]
            isOneToOne: false
            referencedRelation: "timesheet_snapshots"
            referencedColumns: [
              "id",
              "organization_id",
              "employment_profile_id",
              "pay_period_id",
            ]
          },
          {
            foreignKeyName: "timesheet_snapshot_current_he_snapshot_id_organization_id__fkey"
            columns: [
              "snapshot_id",
              "organization_id",
              "employment_profile_id",
              "pay_period_id",
            ]
            isOneToOne: false
            referencedRelation: "timesheet_snapshots"
            referencedColumns: [
              "id",
              "organization_id",
              "employment_profile_id",
              "pay_period_id",
            ]
          },
          {
            foreignKeyName: "timesheet_snapshot_current_heads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_snapshot_current_heads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_snapshot_current_heads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_snapshot_lines: {
        Row: {
          created_at: string
          employment_profile_id: string
          id: string
          line_code: string
          line_payload: Json
          line_type: string
          organization_id: string
          pay_period_id: string
          snapshot_id: string
        }
        Insert: {
          created_at?: string
          employment_profile_id: string
          id?: string
          line_code: string
          line_payload?: Json
          line_type: string
          organization_id: string
          pay_period_id: string
          snapshot_id: string
        }
        Update: {
          created_at?: string
          employment_profile_id?: string
          id?: string
          line_code?: string
          line_payload?: Json
          line_type?: string
          organization_id?: string
          pay_period_id?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_snapshot_lines_employment_profile_id_organizatio_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_snapshot_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_snapshot_lines_pay_period_id_organization_id_fkey"
            columns: ["pay_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_snapshot_lines_snapshot_id_organization_id_emplo_fkey"
            columns: [
              "snapshot_id",
              "organization_id",
              "employment_profile_id",
              "pay_period_id",
            ]
            isOneToOne: false
            referencedRelation: "timesheet_snapshots"
            referencedColumns: [
              "id",
              "organization_id",
              "employment_profile_id",
              "pay_period_id",
            ]
          },
        ]
      }
      timesheet_snapshots: {
        Row: {
          calculation_revision: number
          canonical_payload: Json
          canonical_snapshot_hash: string | null
          created_at: string
          created_by: string
          double_time_seconds: number
          employment_profile_id: string
          gross_earnings_cents: number
          id: string
          lockable: boolean
          meal_premium_cents: number
          organization_id: string
          overtime_seconds: number
          pay_period_id: string
          policy_version_id: string
          regular_seconds: number
          snapshot_version: number
          source_hash: string
          source_high_water: Json
        }
        Insert: {
          calculation_revision?: number
          canonical_payload?: Json
          canonical_snapshot_hash?: string | null
          created_at?: string
          created_by: string
          double_time_seconds?: number
          employment_profile_id: string
          gross_earnings_cents?: number
          id?: string
          lockable?: boolean
          meal_premium_cents?: number
          organization_id: string
          overtime_seconds?: number
          pay_period_id: string
          policy_version_id: string
          regular_seconds?: number
          snapshot_version?: number
          source_hash: string
          source_high_water?: Json
        }
        Update: {
          calculation_revision?: number
          canonical_payload?: Json
          canonical_snapshot_hash?: string | null
          created_at?: string
          created_by?: string
          double_time_seconds?: number
          employment_profile_id?: string
          gross_earnings_cents?: number
          id?: string
          lockable?: boolean
          meal_premium_cents?: number
          organization_id?: string
          overtime_seconds?: number
          pay_period_id?: string
          policy_version_id?: string
          regular_seconds?: number
          snapshot_version?: number
          source_hash?: string
          source_high_water?: Json
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_snapshots_employment_profile_id_organization_id_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_snapshots_pay_period_id_organization_id_fkey"
            columns: ["pay_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_snapshots_policy_version_id_organization_id_fkey"
            columns: ["policy_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payroll_policy_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      trial_events: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          event_timestamp: string
          goal_id: string
          id: string
          metadata: Json
          organization_id: string
          prompt_level: string | null
          prompt_type: string | null
          response: string | null
          session_id: string
          target_id: string
          therapist_id: string
          trial_number: number
          updated_at: string
          updated_by: string | null
          value: number | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          event_timestamp?: string
          goal_id: string
          id?: string
          metadata?: Json
          organization_id: string
          prompt_level?: string | null
          prompt_type?: string | null
          response?: string | null
          session_id: string
          target_id: string
          therapist_id: string
          trial_number: number
          updated_at?: string
          updated_by?: string | null
          value?: number | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          event_timestamp?: string
          goal_id?: string
          id?: string
          metadata?: Json
          organization_id?: string
          prompt_level?: string | null
          prompt_type?: string | null
          response?: string | null
          session_id?: string
          target_id?: string
          therapist_id?: string
          trial_number?: number
          updated_at?: string
          updated_by?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trial_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_events_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_events_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "goal_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          expires_at: string | null
          granted_at: string | null
          granted_by: string | null
          id: string
          is_active: boolean
          role_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean
          role_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean
          role_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
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
          {
            foreignKeyName: "user_therapist_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_therapist_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_therapist_links_quarantine: {
        Row: {
          had_supported_active_role: boolean
          id: string
          link_created_at: string
          link_id: string
          quarantine_batch: string
          quarantined_at: string
          reason: string
          therapist_deleted_at: string | null
          therapist_id: string
          therapist_organization_id: string | null
          therapist_status: string | null
          user_id: string
          user_organization_id: string | null
        }
        Insert: {
          had_supported_active_role: boolean
          id?: string
          link_created_at: string
          link_id: string
          quarantine_batch: string
          quarantined_at?: string
          reason: string
          therapist_deleted_at?: string | null
          therapist_id: string
          therapist_organization_id?: string | null
          therapist_status?: string | null
          user_id: string
          user_organization_id?: string | null
        }
        Update: {
          had_supported_active_role?: boolean
          id?: string
          link_created_at?: string
          link_id?: string
          quarantine_batch?: string
          quarantined_at?: string
          reason?: string
          therapist_deleted_at?: string | null
          therapist_id?: string
          therapist_organization_id?: string | null
          therapist_status?: string | null
          user_id?: string
          user_organization_id?: string | null
        }
        Relationships: []
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
      payroll_blocker_resolution_current_states: {
        Row: {
          action: string | null
          actor_user_id: string | null
          blocker_id: string | null
          blocker_type: string | null
          comment: string | null
          created_at: string | null
          employment_profile_id: string | null
          id: string | null
          idempotency_key: string | null
          occurred_at: string | null
          organization_id: string | null
          pay_period_id: string | null
          payload_hash: string | null
          previous_resolution_id: string | null
          reason: string | null
          received_at: string | null
          session_attendance_correction_request_id: string | null
          time_correction_request_id: string | null
          timekeeping_exception_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_blocker_resolutions_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_employment_profile_id_organiza_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_pay_period_id_organization_id_fkey"
            columns: ["pay_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_previous_resolution_id_organiz_fkey"
            columns: ["previous_resolution_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payroll_blocker_resolution_current_states"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_previous_resolution_id_organiz_fkey"
            columns: ["previous_resolution_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payroll_blocker_resolutions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_session_attendance_correction__fkey"
            columns: [
              "session_attendance_correction_request_id",
              "organization_id",
            ]
            isOneToOne: false
            referencedRelation: "session_attendance_correction_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_time_correction_request_id_org_fkey"
            columns: ["time_correction_request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "time_correction_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payroll_blocker_resolutions_timekeeping_exception_id_organ_fkey"
            columns: ["timekeeping_exception_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "timekeeping_exceptions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      session_cpt_details_vw: {
        Row: {
          billed_minutes: number | null
          client_id: string | null
          cpt_code: string | null
          cpt_code_id: string | null
          created_at: string | null
          end_time: string | null
          id: string | null
          is_primary: boolean | null
          line_number: number | null
          modifier_codes: string[] | null
          notes: string | null
          organization_id: string | null
          rate: number | null
          session_id: string | null
          session_organization_id: string | null
          short_description: string | null
          start_time: string | null
          therapist_id: string | null
          units: number | null
          updated_at: string | null
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
      timesheet_approval_current_states: {
        Row: {
          action: string | null
          actor_user_id: string | null
          attestation: boolean | null
          comment: string | null
          created_at: string | null
          employment_profile_id: string | null
          id: string | null
          idempotency_key: string | null
          occurred_at: string | null
          organization_id: string | null
          pay_period_id: string | null
          payload_hash: string | null
          previous_transition_id: string | null
          reason: string | null
          received_at: string | null
          snapshot_hash: string | null
          snapshot_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_approvals_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_approvals_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_approvals_employment_profile_id_organization_id_fkey"
            columns: ["employment_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employment_profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_approvals_pay_period_id_organization_id_fkey"
            columns: ["pay_period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pay_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_approvals_previous_transition_id_organization_id_fkey"
            columns: ["previous_transition_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "timesheet_approval_current_states"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_approvals_previous_transition_id_organization_id_fkey"
            columns: ["previous_transition_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "timesheet_approvals"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "timesheet_approvals_snapshot_id_organization_id_employment_fkey"
            columns: [
              "snapshot_id",
              "organization_id",
              "employment_profile_id",
              "pay_period_id",
            ]
            isOneToOne: false
            referencedRelation: "timesheet_snapshots"
            referencedColumns: [
              "id",
              "organization_id",
              "employment_profile_id",
              "pay_period_id",
            ]
          },
        ]
      }
    }
    Functions: {
      acquire_session_hold:
        | {
            Args: {
              p_client_id: string
              p_end_time: string
              p_hold_seconds?: number
              p_session_id?: string
              p_start_time: string
              p_therapist_id: string
            }
            Returns: Json
          }
        | {
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
      agent_work_advisory_projection_descriptor: {
        Args: { p_step_id: string }
        Returns: {
          effect_key: string
          output_hash: string
        }[]
      }
      agent_work_caloptima_advisory_projection_descriptor: {
        Args: { p_step_id: string }
        Returns: {
          effect_key: string
          output_hash: string
        }[]
      }
      agent_work_canonical_effect_key: {
        Args: {
          p_actor_user_id: string
          p_organization_id: string
          p_output_hash: string
          p_step_key: string
          p_target_id: string
          p_target_kind: string
          p_workflow_key: string
          p_workflow_version: number
        }
        Returns: string
      }
      agent_work_compute_approval_hash: {
        Args: {
          p_assigned_to: string
          p_evidence_hash: string
          p_input_hash: string
          p_request_reason_code: string
          p_required_role: string
          p_step_id: string
          p_work_item_id: string
          p_workflow_version: number
        }
        Returns: string
      }
      agent_work_compute_evidence_hash: {
        Args: { p_work_item_id: string }
        Returns: string
      }
      agent_work_compute_input_hash: {
        Args: { p_step_id: string; p_work_item_id: string }
        Returns: string
      }
      agent_work_iehp_advisory_projection_descriptor: {
        Args: { p_step_id: string }
        Returns: {
          effect_key: string
          output_hash: string
        }[]
      }
      agent_work_lock_advisory_projection_context: {
        Args: {
          p_attempt_id: string
          p_effect_key: string
          p_expected_state_version: number
          p_payload_hash: string
          p_step_id: string
          p_worker_id: string
        }
        Returns: {
          attempt_id: string
          attempt_number: number
          client_id: string
          effect_key: string
          organization_id: string
          payload_hash: string
          step_id: string
          step_state_version: number
          work_item_id: string
          worker_id: string
        }[]
      }
      agent_work_log_queue_event: {
        Args: {
          p_actor_id: string
          p_actor_kind: string
          p_event_type: string
          p_sanitized_metadata?: Json
          p_step_id: string
        }
        Returns: undefined
      }
      agent_work_recompute_item_status: {
        Args: { p_work_item_id: string }
        Returns: Database["public"]["Enums"]["agent_work_item_status"]
      }
      agent_work_user_has_client_access: {
        Args: {
          p_client_id: string
          p_organization_id: string
          p_reference_at?: string
          p_user_id: string
        }
        Returns: boolean
      }
      agent_work_user_has_exact_role: {
        Args: {
          p_organization_id: string
          p_reference_at?: string
          p_required_role: string
          p_user_id: string
        }
        Returns: boolean
      }
      agent_work_validate_queue_payload: {
        Args: { p_payload: Json }
        Returns: {
          available_at: string
          correlation_id: string
          organization_id: string
          step_id: string
          work_item_id: string
          workflow_version: number
        }[]
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
      apply_schedule_week_forward: {
        Args: {
          p_displayed_week_end: string
          p_displayed_week_start: string
          p_dry_run?: boolean
          p_end_date: string
          p_source_session_ids: string[]
          p_time_zone: string
        }
        Returns: Json
      }
      archive_agent_work_message: {
        Args: { p_msg_id: string }
        Returns: boolean
      }
      archive_agent_work_poison_messages: {
        Args: { p_max_items_per_pass: number; p_now: string }
        Returns: Json
      }
      assign_admin_role: {
        Args: { organization_id: string; reason?: string; user_email: string }
        Returns: undefined
      }
      assign_therapist_role:
        | { Args: { p_email: string; p_user_id: string }; Returns: undefined }
        | { Args: { p_therapist_id: string }; Returns: undefined }
      begin_agent_work_caloptima_model_attempt: {
        Args: {
          p_actor_user_id: string
          p_client_id: string
          p_correlation_id: string
          p_organization_id: string
          p_request_id: string
          p_work_item_id: string
        }
        Returns: {
          allowed_tools: string[]
          attempt_id: string
          attempt_status: Database["public"]["Enums"]["agent_work_attempt_status"]
          client_id: string
          guarded_tools: string[]
          model: string
          model_request_schema_version: string
          organization_id: string
          output_hash: string
          pricing_version: string
          prompt_version: string
          provider: string
          step_id: string
          step_key: string
          temperature: number
          tool_version: string
          work_item_id: string
          workflow_key: string
          workflow_version: number
        }[]
      }
      cache_ai_response: {
        Args: {
          p_cache_key: string
          p_expires_at?: string
          p_metadata: Json
          p_query_text: string
          p_response_text: string
        }
        Returns: undefined
      }
      calculate_efficiency_score: {
        Args: {
          p_actual_hours: number
          p_session_count: number
          p_therapist_id: string
        }
        Returns: number
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
        Returns: undefined
      }
      claim_agent_work_step: {
        Args: {
          p_lease_seconds: number
          p_work_item_id: string
          p_worker_id: string
        }
        Returns: {
          approval_hash: string | null
          attempt_count: number
          client_id: string | null
          completed_at: string | null
          completion_criteria: Json
          created_at: string
          execution_mode: Database["public"]["Enums"]["agent_work_execution_mode"]
          id: string
          input_hash: string | null
          last_error_class: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          ordinal: number
          organization_id: string
          output_hash: string | null
          required_role: string | null
          risk: Database["public"]["Enums"]["agent_work_risk"]
          state_version: number
          status: Database["public"]["Enums"]["agent_work_step_status"]
          step_key: string
          updated_at: string
          wake_at: string | null
          work_item_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "agent_work_steps"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_queued_agent_work_step: {
        Args: {
          p_lease_seconds: number
          p_step_id: string
          p_work_item_id: string
          p_worker_id: string
        }
        Returns: {
          approval_hash: string
          attempt_count: number
          attempt_id: string
          client_id: string
          completed_at: string
          completion_criteria: Json
          created_at: string
          execution_mode: Database["public"]["Enums"]["agent_work_execution_mode"]
          id: string
          input_hash: string
          last_error_class: string
          last_error_code: string
          lease_expires_at: string
          lease_owner: string
          max_attempts: number
          ordinal: number
          organization_id: string
          output_hash: string
          required_role: string
          risk: Database["public"]["Enums"]["agent_work_risk"]
          state_version: string
          status: Database["public"]["Enums"]["agent_work_step_status"]
          step_key: string
          updated_at: string
          wake_at: string
          work_item_id: string
        }[]
      }
      cleanup_ai_cache: { Args: never; Returns: number }
      client_email_exists: { Args: { p_email: string }; Returns: boolean }
      complete_agent_work_caloptima_model_attempt: {
        Args: {
          p_actor_user_id: string
          p_attempt_id: string
          p_client_id: string
          p_computed_cost: number
          p_draft_packet: Json
          p_error_class: string
          p_error_code: string
          p_input_token_count: number
          p_organization_id: string
          p_output_token_count: number
          p_step_id: string
          p_work_item_id: string
        }
        Returns: {
          approval_hash: string | null
          attempt_count: number
          client_id: string | null
          completed_at: string | null
          completion_criteria: Json
          created_at: string
          execution_mode: Database["public"]["Enums"]["agent_work_execution_mode"]
          id: string
          input_hash: string | null
          last_error_class: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          ordinal: number
          organization_id: string
          output_hash: string | null
          required_role: string | null
          risk: Database["public"]["Enums"]["agent_work_risk"]
          state_version: number
          status: Database["public"]["Enums"]["agent_work_step_status"]
          step_key: string
          updated_at: string
          wake_at: string | null
          work_item_id: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_work_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_goal_target_mastery: {
        Args: {
          expected_version: number
          reason: string
          target_goal_target_id: string
        }
        Returns: {
          current_phase: Database["public"]["Enums"]["goal_target_phase"]
          goal_id: string
          goal_status: string
          next_target_id: string
          outcome: string
          previous_phase: Database["public"]["Enums"]["goal_target_phase"]
          target_id: string
          warning: string
        }[]
      }
      complete_supervision_session_note_request: {
        Args: { p_request_id: string; p_responses: Json; p_template_id: string }
        Returns: string
      }
      confirm_session_hold:
        | { Args: { p_hold_key: string; p_session: Json }; Returns: Json }
        | {
            Args: {
              p_actor_id: string
              p_session_data: Json
              p_session_hold_id: string
            }
            Returns: string
          }
      confirm_session_hold_with_enrichment: {
        Args: {
          p_actor_id?: string
          p_cpt?: Json
          p_goal_ids?: string[]
          p_hold_key: string
          p_session: Json
        }
        Returns: Json
      }
      confirm_session_hold_with_enrichment_before_goal_rebuild: {
        Args: {
          p_actor_id?: string
          p_cpt?: Json
          p_goal_ids?: string[]
          p_hold_key: string
          p_session: Json
        }
        Returns: Json
      }
      confirm_session_holds_batch_with_enrichment: {
        Args: { p_actor_id?: string; p_occurrences: Json }
        Returns: Json
      }
      count_admin_users: { Args: { organization_id?: string }; Returns: number }
      create_admin_invite: {
        Args: {
          p_email: string
          p_role: Database["public"]["Enums"]["role_type"]
        }
        Returns: string
      }
      create_admin_invite_token_rate_limited:
        | {
            Args: {
              p_created_by: string
              p_email: string
              p_expires_at: string
              p_organization_id: string
              p_role: Database["public"]["Enums"]["role_type"]
              p_token_hash: string
            }
            Returns: {
              expires_at: string
              id: string
              status: string
            }[]
          }
        | {
            Args: {
              p_created_by: string
              p_email: string
              p_expires_at: string
              p_organization_id: string
              p_role: Database["public"]["Enums"]["role_type"]
              p_target_therapist_id: string
              p_token_hash: string
            }
            Returns: {
              expires_at: string
              id: string
              status: string
            }[]
          }
      create_agent_assessment_work_item: {
        Args: {
          p_actor_user_id: string
          p_assessment_document_id: string
          p_client_id: string
          p_dedupe_key: string
          p_organization_id: string
          p_workflow_version: number
        }
        Returns: string
      }
      create_agent_caloptima_draft_review_work_item: {
        Args: {
          p_actor_user_id: string
          p_assessment_document_id: string
          p_client_id: string
          p_dedupe_key: string
          p_organization_id: string
          p_workflow_version: number
        }
        Returns: string
      }
      create_authorization_with_services: {
        Args: {
          p_authorization_number: string
          p_client_id: string
          p_diagnosis_code: string
          p_diagnosis_description: string
          p_end_date: string
          p_insurance_provider_id?: string
          p_member_id?: string
          p_plan_type?: string
          p_provider_id: string
          p_services?: Json
          p_start_date: string
          p_status?: string
        }
        Returns: {
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          authorization_number: string
          client_id: string
          created_at: string | null
          created_by: string
          denial_reason: string | null
          denied_at: string | null
          diagnosis_code: string
          diagnosis_description: string | null
          documents: Json | null
          end_date: string
          id: string
          insurance_provider_id: string | null
          member_id: string | null
          organization_id: string
          plan_type: string | null
          provider_id: string
          start_date: string
          status: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "authorizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_client: {
        Args: { p_client_data: Json }
        Returns: {
          address_line1: string | null
          address_line2: string | null
          assessment_units: number | null
          auth_end_date: string | null
          auth_start_date: string | null
          auth_units: number | null
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
          therapist_assigned_at: string | null
          therapist_id: string | null
          unscheduled_hours: number | null
          updated_at: string
          updated_by: string | null
          zip_code: string | null
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_staff_message_thread: {
        Args: {
          p_participant_user_ids: string[]
          p_subject?: string
          p_thread_type: string
        }
        Returns: string
      }
      create_super_admin: { Args: { user_email: string }; Returns: undefined }
      create_supervision_session_note_request_for_completed_session: {
        Args: { p_session_id: string }
        Returns: string
      }
      current_org_id: { Args: never; Returns: string }
      current_user_can_capture_trial_event: {
        Args: { target_client_id: string; target_organization_id: string }
        Returns: boolean
      }
      current_user_can_decide_agent_work_approval: {
        Args: { p_approval_id: string }
        Returns: boolean
      }
      current_user_can_delete_goal_targets: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      current_user_can_manage_agent_work_row: {
        Args: { p_client_id: string; p_organization_id: string }
        Returns: boolean
      }
      current_user_can_manage_locked_trial_event: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      current_user_can_manage_programs_goals: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      current_user_can_read_agent_work_assessment_endpoint: {
        Args: {
          p_assessment_document_id: string
          p_workflow_key: string
          p_workflow_version: number
        }
        Returns: boolean
      }
      current_user_can_read_agent_work_item_endpoint: {
        Args: { p_work_item_id: string }
        Returns: boolean
      }
      current_user_can_take_client_data: {
        Args: { target_client_id: string; target_organization_id: string }
        Returns: boolean
      }
      current_user_decidable_agent_work_approval_ids: {
        Args: { p_work_item_id: string }
        Returns: {
          approval_id: string
        }[]
      }
      current_user_is_super_admin: { Args: never; Returns: boolean }
      current_user_organization_id: { Args: never; Returns: string }
      current_user_visible_agent_work_approval_ids: {
        Args: { p_work_item_id: string }
        Returns: {
          approval_id: string
        }[]
      }
      decide_agent_work_approval: {
        Args: {
          p_actor_user_id: string
          p_approval_id: string
          p_decision: string
          p_reason_code: string
          p_work_item_id: string
        }
        Returns: Json
      }
      delete_admin_therapist_link: {
        Args: {
          p_organization_id: string
          target_therapist_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      derive_timesheet_snapshot: {
        Args: { p_idempotency_key: string; selected_local_date: string }
        Returns: Json
      }
      detect_scheduling_conflicts: {
        Args: {
          p_end_date: string
          p_include_suggestions?: boolean
          p_start_date: string
        }
        Returns: {
          affected_sessions: Json
          auto_resolvable: boolean
          conflict_id: string
          conflict_type: string
          severity: number
          suggested_resolutions: Json
        }[]
      }
      disable_hosted_agent_work_queue_scheduler: { Args: never; Returns: Json }
      disable_local_agent_work_queue_scheduler: {
        Args: never
        Returns: boolean
      }
      enable_hosted_agent_work_queue_scheduler: {
        Args: {
          p_max_items_per_pass?: number
          p_schedule: string
          p_timeout_milliseconds?: number
        }
        Returns: Json
      }
      enable_local_agent_work_queue_scheduler: {
        Args: {
          p_max_items_per_pass?: number
          p_schedule: string
          p_timeout_milliseconds?: number
        }
        Returns: Json
      }
      enqueue_agent_work_message: {
        Args: {
          p_available_at?: string
          p_correlation_id?: string
          p_step_id: string
        }
        Returns: number
      }
      enqueue_impersonation_revocation: {
        Args: { p_audit_id: string; p_token_jti: string }
        Returns: undefined
      }
      ensure_admin_role: { Args: { user_email: string }; Returns: undefined }
      ensure_user_has_admin_role: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      expire_agent_work_approvals: {
        Args: { p_max_items_per_pass: number; p_now: string }
        Returns: Json
      }
      export_agent_work_retention_manifest: {
        Args: { p_organization_id: string; p_work_item_id: string }
        Returns: Json
      }
      fail_agent_work_caloptima_model_attempt: {
        Args: {
          p_actor_user_id: string
          p_attempt_id: string
          p_client_id: string
          p_error_code: string
          p_organization_id: string
          p_step_id: string
          p_work_item_id: string
        }
        Returns: {
          approval_hash: string | null
          attempt_count: number
          client_id: string | null
          completed_at: string | null
          completion_criteria: Json
          created_at: string
          execution_mode: Database["public"]["Enums"]["agent_work_execution_mode"]
          id: string
          input_hash: string | null
          last_error_class: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          ordinal: number
          organization_id: string
          output_hash: string | null
          required_role: string | null
          risk: Database["public"]["Enums"]["agent_work_risk"]
          state_version: number
          status: Database["public"]["Enums"]["agent_work_step_status"]
          step_key: string
          updated_at: string
          wake_at: string | null
          work_item_id: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_work_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_agent_work_advisory_projection_effect: {
        Args: {
          p_attempt_id: string
          p_effect_key: string
          p_expected_state_version: number
          p_payload_hash: string
          p_step_id: string
          p_worker_id: string
        }
        Returns: {
          approval_hash: string | null
          attempt_count: number
          client_id: string | null
          completed_at: string | null
          completion_criteria: Json
          created_at: string
          execution_mode: Database["public"]["Enums"]["agent_work_execution_mode"]
          id: string
          input_hash: string | null
          last_error_class: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          ordinal: number
          organization_id: string
          output_hash: string | null
          required_role: string | null
          risk: Database["public"]["Enums"]["agent_work_risk"]
          state_version: number
          status: Database["public"]["Enums"]["agent_work_step_status"]
          step_key: string
          updated_at: string
          wake_at: string | null
          work_item_id: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_work_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_bt_aba_session_note: {
        Args: {
          p_expected_target_versions?: Json
          p_note_id: string
          p_note_payload: Json
          p_responses: Json
          p_session_id: string
          p_trial_events?: Json
        }
        Returns: Json
      }
      finalize_session_note_with_progression: {
        Args: {
          expected_target_versions?: Json
          note_payload: Json
          target_note_id: string
          target_session_id: string
          trial_events?: Json
        }
        Returns: {
          note: Json
          progression_results: Json
        }[]
      }
      finalize_session_note_with_progression_v1: {
        Args: {
          expected_target_versions?: Json
          note_payload: Json
          target_note_id: string
          target_session_id: string
          trial_events?: Json
        }
        Returns: {
          note: Json
          progression_results: Json
        }[]
      }
      generate_semantic_cache_key: {
        Args: { p_context_hash?: string; p_query_text: string }
        Returns: string
      }
      generate_slot_reasoning: {
        Args: {
          p_client_id: string
          p_client_prefs: Json
          p_slot_time: string
          p_therapist_id: string
          p_therapist_prefs: Json
        }
        Returns: Json
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
      get_admin_linkable_therapists: {
        Args: { p_organization_id: string }
        Returns: {
          email: string
          full_name: string
          id: string
        }[]
      }
      get_admin_therapist_links: {
        Args: { p_organization_id: string }
        Returns: {
          therapist_id: string
          therapist_name: string
          user_id: string
        }[]
      }
      get_admin_users: {
        Args: { organization_id?: string }
        Returns: {
          created_at: string | null
          email: string | null
          id: string | null
          raw_user_meta_data: Json | null
          user_id: string | null
          user_role_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "admin_users"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_admin_users_paged: {
        Args: { organization_id?: string; p_limit?: number; p_offset?: number }
        Returns: {
          created_at: string | null
          email: string | null
          id: string | null
          raw_user_meta_data: Json | null
          user_id: string | null
          user_role_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "admin_users"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_ai_cache_metrics: {
        Args: never
        Returns: {
          cache_size_mb: number
          expired_entries: number
          hit_rate: number
          total_entries: number
        }[]
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
      get_authorization_metrics:
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
      get_billing_metrics:
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
      get_bt_aba_session_note: { Args: { p_session_id: string }; Returns: Json }
      get_bt_supervision_correction_tasks: { Args: never; Returns: Json }
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
              inactive_clients: number
              new_clients: number
              service_preferences: Json
              sessions_per_client: Json
              total_clients: number
            }[]
          }
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
      get_client_preference_factor: {
        Args: { p_client_id: string; p_slot_time: string }
        Returns: number
      }
      get_dashboard_data: { Args: never; Returns: Json }
      get_dashboard_data_for_org: {
        Args: { actor_user_id: string; target_organization_id: string }
        Returns: Json
      }
      get_db_version: { Args: never; Returns: string }
      get_dropdown_data: { Args: never; Returns: Json }
      get_employee_users_paged: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_organization_id?: string
        }
        Returns: {
          created_at: string
          email: string
          first_name: string
          full_name: string
          id: string
          is_active: boolean
          last_login_at: string
          last_name: string
          organization_id: string
          role: Database["public"]["Enums"]["role_type"]
          title: string
        }[]
      }
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
      get_historical_success_rate: {
        Args: { p_client_id: string; p_therapist_id: string }
        Returns: number
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
      get_payroll_day: { Args: { local_date: string }; Returns: Json }
      get_payroll_timesheet_period: {
        Args: { selected_local_date: string }
        Returns: Json
      }
      get_pending_supervision_review_packets: {
        Args: never
        Returns: {
          assigned_reviewer_user_id: string
          bt_note_id: string
          bt_responses: Json
          bt_signature_method: string
          bt_signed_at: string
          bt_template_snapshot: Json
          bt_therapist_id: string
          bt_therapist_name: string
          bt_therapist_title: string
          can_complete: boolean
          can_return: boolean
          client_id: string
          client_name: string
          correction_id: string
          correction_reason: string
          correction_requested_at: string
          correction_reviewer_user_id: string
          correction_round: number
          latest_version_number: number
          organization_id: string
          place_of_service: string
          request_created_at: string
          request_id: string
          request_status: string
          review_versions: Json
          session_end_time: string
          session_id: string
          session_start_time: string
          supervision_template_id: string
          supervision_template_name: string
          supervision_template_structure: Json
        }[]
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
      get_scheduling_efficiency_factor: {
        Args: { p_slot_time: string; p_therapist_id: string }
        Returns: number
      }
      get_session_capture_strict_billing_gate: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      get_session_metrics: {
        Args: {
          p_client_id?: string
          p_end_date: string
          p_start_date: string
          p_therapist_id?: string
        }
        Returns: {
          cancelled_sessions: number
          completed_sessions: number
          no_show_sessions: number
          sessions_by_client: Json
          sessions_by_day: Json
          sessions_by_therapist: Json
          total_sessions: number
        }[]
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
      get_session_payroll_context: {
        Args: { session_id: string }
        Returns: Json
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
            Args: { p_end_date: string; p_start_date: string }
            Returns: {
              client_name: string
              session_day: string
              session_id: string
              session_type: string
              status: string
              therapist_name: string
            }[]
          }
        | {
            Args: {
              p_client_id: string
              p_end_date: string
              p_start_date: string
              p_status: string
              p_therapist_id: string
            }
            Returns: {
              client_name: string
              session_day: string
              session_id: string
              session_type: string
              status: string
              therapist_name: string
            }[]
          }
        | {
            Args: {
              p_client_id: string
              p_end_date: string
              p_start_date: string
              p_status: string
              p_therapist_id: string
            }
            Returns: {
              client_name: string
              session_day: string
              session_id: string
              session_type: string
              status: string
              therapist_name: string
            }[]
          }
      get_slot_availability_context: {
        Args: {
          p_client_id: string
          p_slot_time: string
          p_therapist_id: string
        }
        Returns: Json
      }
      get_supervision_session_note_action_count: {
        Args: never
        Returns: number
      }
      get_therapist_availability: {
        Args: { p_end: string; p_start: string; p_therapist_id: string }
        Returns: Json
      }
      get_therapist_metrics:
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
      get_therapist_workload_factor: {
        Args: { p_slot_time: string; p_therapist_id: string }
        Returns: number
      }
      get_user_role_from_junction: {
        Args: { p_user_id: string }
        Returns: Database["public"]["Enums"]["role_type"]
      }
      get_user_roles: {
        Args: never
        Returns: {
          roles: string[]
        }[]
      }
      get_user_therapist_id: { Args: never; Returns: string }
      guardian_contact_metadata: {
        Args: { p_guardian_id?: string }
        Returns: {
          client_id: string
          metadata: Json
        }[]
      }
      guardian_link_queue_admin_view: {
        Args: { p_organization_id: string; p_status?: string }
        Returns: {
          approved_client_ids: string[]
          created_at: string
          guardian_email: string
          guardian_id: string
          id: string
          invite_token: string
          metadata: Json
          organization_id: string
          processed_at: string
          processed_by: string
          requested_client_ids: string[]
          status: string
          updated_at: string
        }[]
      }
      has_care_role: { Args: never; Returns: boolean }
      has_role: { Args: { target_role: string }; Returns: boolean }
      hosted_agent_work_queue_scheduler_status: { Args: never; Returns: Json }
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
      list_eligible_staff_for_messaging: {
        Args: { p_organization_id: string }
        Returns: {
          email: string
          full_name: string
          role: string
          user_id: string
        }[]
      }
      list_staff_message_thread_participant_names: {
        Args: { p_thread_id: string }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      load_agent_work_runtime_policy: {
        Args: { p_mode_input?: string }
        Returns: {
          actionsDisabled: boolean
          authoritative: boolean
          killSwitchEnabled: boolean
          runtimeMode: string
        }[]
      }
      log_error_event: {
        Args: {
          p_context?: Json
          p_details?: Json
          p_error_type: string
          p_message: string
          p_severity?: string
          p_stack_trace?: string
          p_url?: string
          p_user_agent?: string
        }
        Returns: undefined
      }
      log_function_performance:
        | {
            Args: {
              p_duration_ms: number
              p_function_name: string
              p_result_size_kb?: number
            }
            Returns: undefined
          }
        | {
            Args: {
              p_execution_time_ms: number
              p_function_name: string
              p_parameters?: Json
              p_result_size?: number
            }
            Returns: undefined
          }
      manage_admin_users:
        | {
            Args: { operation: string; target_user_id: string }
            Returns: undefined
          }
        | {
            Args: {
              caller_organization_id: string
              operation: string
              target_user_id: string
            }
            Returns: undefined
          }
        | {
            Args: { metadata: Json; operation: string; target_user_id: string }
            Returns: undefined
          }
      override_goal_target_progression: {
        Args: {
          expected_version: number
          reason: string
          target_current_goal_target_id: string
          target_goal_target_id: string
          target_phase: Database["public"]["Enums"]["goal_target_phase"]
        }
        Returns: {
          current_phase: Database["public"]["Enums"]["goal_target_phase"]
          goal_id: string
          goal_status: string
          next_target_id: string
          outcome: string
          previous_phase: Database["public"]["Enums"]["goal_target_phase"]
          target_id: string
          warning: string
        }[]
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
      provision_ci_rls_fixture_profile: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: string
      }
      provision_ci_smoke_bcba_profile: {
        Args: { p_user_id: string }
        Returns: string
      }
      prune_admin_actions: {
        Args: { retention_days?: number }
        Returns: number
      }
      prune_admin_invite_tokens: { Args: never; Returns: number }
      prune_agent_work_retention_category: {
        Args: {
          p_category: string
          p_manifest_hash: string
          p_organization_id: string
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
      reactivate_cancelled_session: {
        Args: {
          p_actor_id: string
          p_end_time?: string
          p_session_id: string
          p_start_time?: string
        }
        Returns: Json
      }
      read_agent_work_advisory_projection_descriptor: {
        Args: { p_step_id: string }
        Returns: {
          effect_key: string
          output_hash: string
        }[]
      }
      read_agent_work_advisory_projection_effect: {
        Args: { p_effect_key: string; p_step_id: string }
        Returns: {
          attempt_id: string
          client_id: string
          created_at: string
          effect_kind: string
          id: string
          organization_id: string
          payload_hash: string
          status: Database["public"]["Enums"]["agent_work_effect_status"]
          step_id: string
          step_state_version: number
          step_status: Database["public"]["Enums"]["agent_work_step_status"]
          target_id: string
          target_kind: string
          unique_effect_key: string
          updated_at: string
          verified_at: string
          work_item_id: string
        }[]
      }
      read_agent_work_caloptima_draft_packet: {
        Args: {
          p_actor_user_id: string
          p_client_id: string
          p_organization_id: string
          p_work_item_id: string
        }
        Returns: {
          output_hash: string
          packet: Json
          packet_hash: string
        }[]
      }
      read_agent_work_messages: {
        Args: { p_qty?: number; p_visibility_timeout_seconds?: number }
        Returns: {
          available_at: string
          correlation_id: string
          enqueued_at: string
          message: Json
          msg_id: string
          organization_id: string
          read_ct: number
          step_id: string
          vt: string
          work_item_id: string
          workflow_version: number
        }[]
      }
      read_agent_work_runner_scope: {
        Args: {
          p_organization_id: string
          p_step_id: string
          p_work_item_id: string
          p_workflow_version: number
        }
        Returns: {
          attempt_count: number
          client_id: string
          effect_key: string
          evidence_hashes: string[]
          execution_mode: Database["public"]["Enums"]["agent_work_execution_mode"]
          input_hash: string
          item_status: Database["public"]["Enums"]["agent_work_item_status"]
          max_attempts: number
          organization_id: string
          owner_user_id: string
          step_id: string
          step_key: string
          step_status: Database["public"]["Enums"]["agent_work_step_status"]
          work_item_id: string
          workflow_key: string
          workflow_version: number
        }[]
      }
      reconcile_supervision_session_note_requests: {
        Args: { p_since?: string }
        Returns: number
      }
      record_agent_work_advisory_projection_effect: {
        Args: {
          p_attempt_id: string
          p_effect_key: string
          p_expected_state_version: number
          p_payload_hash: string
          p_step_id: string
          p_worker_id: string
        }
        Returns: {
          attempt_id: string
          client_id: string
          created_at: string
          effect_kind: string
          id: string
          organization_id: string
          payload_hash: string
          status: Database["public"]["Enums"]["agent_work_effect_status"]
          step_id: string
          step_state_version: number
          target_id: string
          target_kind: string
          unique_effect_key: string
          updated_at: string
          verified_at: string
          work_item_id: string
        }[]
      }
      record_agent_work_model_attempt_result: {
        Args: {
          p_actor_user_id: string
          p_attempt_id: string
          p_client_id: string
          p_computed_cost: number
          p_error_class: string
          p_error_code: string
          p_input_token_count: number
          p_organization_id: string
          p_output_token_count: number
          p_step_id: string
          p_work_item_id: string
        }
        Returns: {
          attempt_number: number
          client_id: string | null
          computed_cost: number | null
          correlation_id: string | null
          created_at: string
          error_class: string | null
          error_code: string | null
          finished_at: string | null
          id: string
          input_token_count: number | null
          lease_acquired_at: string
          lease_expires_at: string | null
          model: string | null
          model_request_schema_version: string | null
          organization_id: string
          output_token_count: number | null
          pricing_version: string | null
          prompt_version: string | null
          provider: string | null
          request_id: string | null
          status: Database["public"]["Enums"]["agent_work_attempt_status"]
          step_id: string
          temperature: number | null
          tool_version: string | null
          updated_at: string
          work_item_id: string
          worker_id: string
          workflow_version: number | null
        }
        SetofOptions: {
          from: "*"
          to: "agent_work_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_employee_time_event: {
        Args: { event_payload: Json; idempotency_key: string }
        Returns: Json
      }
      record_session_attendance_event: {
        Args: { event_payload: Json; idempotency_key: string }
        Returns: Json
      }
      record_session_audit: {
        Args: {
          p_actor_id?: string
          p_event_payload?: Json
          p_event_type: string
          p_session_id: string
        }
        Returns: undefined
      }
      refresh_agent_work_caloptima_evidence: {
        Args: {
          p_actor_user_id: string
          p_client_id: string
          p_organization_id: string
          p_work_item_id: string
        }
        Returns: Json
      }
      reorder_goal_targets: {
        Args: {
          expected_versions: number[]
          ordered_target_ids: string[]
          target_goal_id: string
        }
        Returns: {
          client_id: string
          created_at: string
          created_by: string | null
          current_phase: Database["public"]["Enums"]["goal_target_phase"] | null
          evaluation_window_started_at: string | null
          goal_id: string
          graph_config: Json
          id: string
          is_current: boolean
          measurement_type: string
          name: string
          organization_id: string
          progression_version: number
          sort_order: number
          status: string
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "goal_targets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      request_agent_work_approval_handoff: {
        Args: {
          p_actor_user_id: string
          p_assigned_owner_user_id: string
          p_expires_at: string
          p_reason_code: string
          p_step_id: string
          p_work_item_id: string
        }
        Returns: Json
      }
      request_session_attendance_correction: {
        Args: { correction_payload: Json; idempotency_key: string }
        Returns: Json
      }
      request_time_correction: {
        Args: { correction_payload: Json; idempotency_key: string }
        Returns: Json
      }
      requeue_expired_agent_work_leases: {
        Args: { p_max_items_per_pass: number; p_now: string }
        Returns: {
          reasonCode: string
        }[]
      }
      reset_user_password: {
        Args: { new_password: string; target_email: string }
        Returns: undefined
      }
      resolve_agent_work_assessment_scope: {
        Args: {
          p_actor_user_id: string
          p_assessment_document_id: string
          p_workflow_key: string
          p_workflow_version: number
        }
        Returns: {
          client_id: string
          id: string
          organization_id: string
          template_type: string
        }[]
      }
      resolve_assigned_bt_session_capture_billing: {
        Args: { p_session_id: string }
        Returns: {
          authorization_id: string
          service_code: string
          session_client_id: string
          session_therapist_id: string
          strict_billing: boolean
        }[]
      }
      resolve_payroll_blocker: {
        Args: { p_idempotency_key: string; p_payload: Json }
        Returns: Json
      }
      resubmit_bt_supervision_correction: {
        Args: {
          p_request_id: string
          p_responses: Json
          p_signature_method: string
          p_signature_value: string
        }
        Returns: string
      }
      return_supervision_session_note_request_to_bt: {
        Args: { p_reason: string; p_request_id: string }
        Returns: string
      }
      revoke_stale_agent_work_approvals: {
        Args: { p_max_items_per_pass: number; p_now: string }
        Returns: Json
      }
      save_bt_aba_session_note_draft: {
        Args: {
          p_note_payload: Json
          p_responses: Json
          p_session_id: string
          p_template_id: string
        }
        Returns: Json
      }
      schedule_agent_work_step_retry: {
        Args: {
          p_delay_seconds: number
          p_reason_code: string
          p_sanitized_metadata?: Json
          p_step_id: string
        }
        Returns: Json
      }
      session_has_locked_note: {
        Args: { target_session_id: string }
        Returns: boolean
      }
      set_admin_therapist_link: {
        Args: {
          p_organization_id: string
          target_therapist_id: string
          target_user_id: string
        }
        Returns: {
          therapist_id: string
          therapist_name: string
          user_id: string
        }[]
      }
      set_client_archive_state: {
        Args: { p_client_id: string; p_restore?: boolean }
        Returns: {
          address_line1: string | null
          address_line2: string | null
          assessment_units: number | null
          auth_end_date: string | null
          auth_start_date: string | null
          auth_units: number | null
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
          therapist_assigned_at: string | null
          therapist_id: string | null
          unscheduled_hours: number | null
          updated_at: string
          updated_by: string | null
          zip_code: string | null
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_goal_target_phase_criterion: {
        Args: {
          expected_version: number
          target_clinical_note: string
          target_comparator: string
          target_consecutive_sessions: number
          target_goal_target_id: string
          target_metric: string
          target_min_observations: number
          target_phase: Database["public"]["Enums"]["goal_target_phase"]
          target_threshold: number
        }
        Returns: Json
      }
      snapshot_agent_work_caloptima_draft_packet: {
        Args: {
          p_actor_user_id: string
          p_client_id: string
          p_draft_packet: Json
          p_model_attempt_id: string
          p_model_step_id: string
          p_organization_id: string
          p_work_item_id: string
        }
        Returns: {
          approval_hash: string | null
          attempt_count: number
          client_id: string | null
          completed_at: string | null
          completion_criteria: Json
          created_at: string
          execution_mode: Database["public"]["Enums"]["agent_work_execution_mode"]
          id: string
          input_hash: string | null
          last_error_class: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          ordinal: number
          organization_id: string
          output_hash: string | null
          required_role: string | null
          risk: Database["public"]["Enums"]["agent_work_risk"]
          state_version: number
          status: Database["public"]["Enums"]["agent_work_step_status"]
          step_key: string
          updated_at: string
          wake_at: string | null
          work_item_id: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_work_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      snapshot_agent_work_model_attempt: {
        Args: {
          p_actor_user_id: string
          p_attempt_id: string
          p_client_id: string
          p_correlation_id: string
          p_model: string
          p_model_request_schema_version: string
          p_organization_id: string
          p_pricing_version: string
          p_prompt_version: string
          p_provider: string
          p_request_id: string
          p_step_id: string
          p_temperature: number
          p_tool_version: string
          p_work_item_id: string
          p_workflow_version: number
        }
        Returns: {
          allowed_tools: string[]
          attempt_id: string
          attempt_status: Database["public"]["Enums"]["agent_work_attempt_status"]
          blocker_codes: string[]
          client_id: string
          evidence_source_ids: string[]
          guarded_tools: string[]
          organization_id: string
          prompt_version: string
          step_id: string
          step_key: string
          suggested_action_codes: string[]
          tool_version: string
          work_item_id: string
          workflow_key: string
          workflow_version: number
        }[]
      }
      start_session_with_goals: {
        Args: {
          p_actor_id?: string
          p_goal_id: string
          p_goal_ids?: string[]
          p_program_id: string
          p_session_id: string
          p_started_at?: string
        }
        Returns: Json
      }
      sync_agent_work_caloptima_projection_evidence: {
        Args: { p_step_id: string; p_work_item_id: string }
        Returns: Json
      }
      temp_validate_time: { Args: never; Returns: undefined }
      transition_agent_work_step: {
        Args: {
          p_expected_state_version: number
          p_output_hash: string
          p_reason_code: string
          p_sanitized_metadata: Json
          p_step_id: string
          p_to_status: Database["public"]["Enums"]["agent_work_step_status"]
        }
        Returns: {
          approval_hash: string | null
          attempt_count: number
          client_id: string | null
          completed_at: string | null
          completion_criteria: Json
          created_at: string
          execution_mode: Database["public"]["Enums"]["agent_work_execution_mode"]
          id: string
          input_hash: string | null
          last_error_class: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          ordinal: number
          organization_id: string
          output_hash: string | null
          required_role: string | null
          risk: Database["public"]["Enums"]["agent_work_risk"]
          state_version: number
          status: Database["public"]["Enums"]["agent_work_step_status"]
          step_key: string
          updated_at: string
          wake_at: string | null
          work_item_id: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_work_steps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transition_timesheet_approval: {
        Args: { p_idempotency_key: string; p_payload: Json }
        Returns: Json
      }
      update_authorization_documents: {
        Args: { p_authorization_id: string; p_documents: Json }
        Returns: {
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          authorization_number: string
          client_id: string
          created_at: string | null
          created_by: string
          denial_reason: string | null
          denied_at: string | null
          diagnosis_code: string
          diagnosis_description: string | null
          documents: Json | null
          end_date: string
          id: string
          insurance_provider_id: string | null
          member_id: string | null
          organization_id: string
          plan_type: string | null
          provider_id: string
          start_date: string
          status: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "authorizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_authorization_with_services: {
        Args: {
          p_authorization_id: string
          p_authorization_number: string
          p_client_id: string
          p_diagnosis_code: string
          p_diagnosis_description: string
          p_end_date: string
          p_insurance_provider_id: string
          p_member_id: string
          p_plan_type: string
          p_provider_id: string
          p_services?: Json
          p_start_date: string
          p_status: string
        }
        Returns: {
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          authorization_number: string
          client_id: string
          created_at: string | null
          created_by: string
          denial_reason: string | null
          denied_at: string | null
          diagnosis_code: string
          diagnosis_description: string | null
          documents: Json | null
          end_date: string
          id: string
          insurance_provider_id: string | null
          member_id: string | null
          organization_id: string
          plan_type: string | null
          provider_id: string
          start_date: string
          status: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "authorizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_client_documents: {
        Args: { p_client_id: string; p_documents: Json }
        Returns: undefined
      }
      user_has_role: { Args: { role_name: string }; Returns: boolean }
      user_has_role_for_org: {
        Args: {
          role_name: string
          target_client_id?: string
          target_organization_id?: string
          target_session_id?: string
          target_therapist_id?: string
        }
        Returns: boolean
      }
      validate_feature_flag_metadata: { Args: { obj: Json }; Returns: boolean }
      validate_organization_metadata: { Args: { obj: Json }; Returns: boolean }
      validate_session_note_compliance: {
        Args: { p_note_id: string }
        Returns: Json
      }
      validate_time_interval: { Args: { time_value: string }; Returns: boolean }
      validate_time_interval_new: { Args: { t: string }; Returns: boolean }
      wake_due_agent_work_steps: {
        Args: { p_max_items_per_pass: number; p_now: string }
        Returns: {
          reasonCode: string
        }[]
      }
    }
    Enums: {
      agent_work_approval_status:
        | "pending"
        | "approved"
        | "rejected"
        | "expired"
        | "revoked"
      agent_work_attempt_status:
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
        | "expired"
      agent_work_effect_status: "pending" | "verified" | "failed" | "cancelled"
      agent_work_evidence_source_kind:
        | "assessment_document"
        | "assessment_checklist_item"
        | "assessment_structured_section"
        | "assessment_review_event"
        | "work_item"
        | "work_step"
        | "approval"
        | "assessment_draft_program"
        | "assessment_draft_goal"
      agent_work_execution_mode: "deterministic" | "model_suggested" | "human"
      agent_work_item_status:
        | "queued"
        | "running"
        | "waiting"
        | "needs_review"
        | "blocked"
        | "completed"
        | "failed"
        | "cancelled"
      agent_work_risk: "low" | "moderate" | "high" | "clinical"
      agent_work_step_status:
        | "pending"
        | "ready"
        | "running"
        | "waiting"
        | "needs_approval"
        | "completed"
        | "failed"
        | "skipped"
        | "cancelled"
      goal_target_phase: "baseline" | "teaching" | "generalization" | "mastery"
      pay_group_cadence: "weekly" | "biweekly" | "monthly"
      payroll_capability:
        | "time.clock_self"
        | "time.view_self"
        | "time.request_correction_self"
        | "time.review_assigned"
        | "time.approve_assigned"
        | "session_attendance.record_assigned"
        | "payroll.configure_employment"
        | "payroll.resolve_exceptions"
        | "payroll.lock_period"
        | "payroll.reopen_period"
        | "payroll.export_period"
        | "payroll.view_compensation"
      payroll_event_type:
        | "shift_started"
        | "shift_ended"
        | "meal_started"
        | "meal_ended"
        | "work_category_changed"
      payroll_policy_activation_status: "inactive" | "active"
      role_type:
        | "client"
        | "therapist"
        | "admin"
        | "super_admin"
        | "bt"
        | "midtier"
        | "admin_schedule"
        | "bcba"
      session_attendance_event_type: "session_started" | "session_ended"
      work_category: "direct_service" | "administration" | "travel" | "training"
      work_location: "client_site" | "office" | "home" | "community" | "other"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      agent_work_approval_status: [
        "pending",
        "approved",
        "rejected",
        "expired",
        "revoked",
      ],
      agent_work_attempt_status: [
        "running",
        "completed",
        "failed",
        "cancelled",
        "expired",
      ],
      agent_work_effect_status: ["pending", "verified", "failed", "cancelled"],
      agent_work_evidence_source_kind: [
        "assessment_document",
        "assessment_checklist_item",
        "assessment_structured_section",
        "assessment_review_event",
        "work_item",
        "work_step",
        "approval",
        "assessment_draft_program",
        "assessment_draft_goal",
      ],
      agent_work_execution_mode: ["deterministic", "model_suggested", "human"],
      agent_work_item_status: [
        "queued",
        "running",
        "waiting",
        "needs_review",
        "blocked",
        "completed",
        "failed",
        "cancelled",
      ],
      agent_work_risk: ["low", "moderate", "high", "clinical"],
      agent_work_step_status: [
        "pending",
        "ready",
        "running",
        "waiting",
        "needs_approval",
        "completed",
        "failed",
        "skipped",
        "cancelled",
      ],
      goal_target_phase: ["baseline", "teaching", "generalization", "mastery"],
      pay_group_cadence: ["weekly", "biweekly", "monthly"],
      payroll_capability: [
        "time.clock_self",
        "time.view_self",
        "time.request_correction_self",
        "time.review_assigned",
        "time.approve_assigned",
        "session_attendance.record_assigned",
        "payroll.configure_employment",
        "payroll.resolve_exceptions",
        "payroll.lock_period",
        "payroll.reopen_period",
        "payroll.export_period",
        "payroll.view_compensation",
      ],
      payroll_event_type: [
        "shift_started",
        "shift_ended",
        "meal_started",
        "meal_ended",
        "work_category_changed",
      ],
      payroll_policy_activation_status: ["inactive", "active"],
      role_type: [
        "client",
        "therapist",
        "admin",
        "super_admin",
        "bt",
        "midtier",
        "admin_schedule",
        "bcba",
      ],
      session_attendance_event_type: ["session_started", "session_ended"],
      work_category: ["direct_service", "administration", "travel", "training"],
      work_location: ["client_site", "office", "home", "community", "other"],
    },
  },
} as const

