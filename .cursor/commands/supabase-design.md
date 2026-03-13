# /supabase-design

## Purpose
Design, assess, or evolve Supabase backend architecture for this project.

This command must support both:
- Existing Supabase projects (assessment + improvement plan)
- Greenfield projects (new architecture design)

## Primary tools and ownership
- Primary specialist: `supabase-engineer`
- Primary tool interface: Supabase MCP server `plugin-supabase-supabase`
- Use MCP-first for schema/auth/storage/functions/realtime analysis and planning.
- Use shell/manual SQL only when MCP cannot perform the required step, and explicitly state fallback reason.

## Pipeline
`research-engineer -> specification-engineer -> software-architect -> supabase-engineer -> security-engineer`

## Execution process
1. Detect whether Supabase infrastructure already exists in the repo/environment.
2. If Supabase exists, assess current architecture:
   - schema: tables, relationships, indexes, constraints
   - RLS policies and role boundaries
   - authentication and session/JWT model
   - edge functions, storage, and realtime setup
   - operational/security risks and maintainability gaps
3. If Supabase does not exist, design a full initial architecture:
   - schema, relationships, indexes
   - auth model and role model
   - RLS strategy
   - storage and edge function plan
4. Propose concrete changes and rationale:
   - schema additions/changes and index tuning
   - RLS hardening and auth improvements
   - edge functions and storage updates
   - optional realtime design where justified
5. Provide safe migration strategy for every proposed schema change:
   - sequencing, rollout/rollback, data backfill, and compatibility notes

## Output format
Use this structure:

### Supabase Architecture Assessment

### Existing Infrastructure Summary

### Database Schema
- Tables
- Relationships
- Indexes

### Row Level Security Policies

### Authentication Flow

### Storage Strategy

### Edge Functions (if applicable)

### Recommended Improvements

### Migration Plan (if modifying existing schema)
