import { z } from "npm:zod@3.23.8";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";
import { organizationMetadataSchema, type OrganizationMetadata } from "./schema.ts";
import {
  createProtectedRoute,
  corsHeaders,
  logApiAccess,
  RouteOptions,
  type UserContext,
} from "../_shared/auth-middleware.ts";
import { createRequestClient } from "../_shared/database.ts";

const ADMIN_PATH = "/super-admin/feature-flags";

const respond = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const parseJson = async (req: Request): Promise<unknown> => {
  try {
    return await req.json();
  } catch {
    throw respond(400, { error: "Invalid JSON payload" });
  }
};

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const listSchema = z.object({
  action: z.literal("list"),
});

const createFlagSchema = z.object({
  action: z.literal("createFlag"),
  flagKey: z
    .string()
    .trim()
    .min(2, "flagKey must contain at least two characters")
    .max(100, "flagKey cannot exceed 100 characters"),
  description: z.string().trim().max(500).optional(),
  defaultEnabled: z.boolean().optional(),
});

const updateGlobalFlagSchema = z.object({
  action: z.literal("updateGlobalFlag"),
  flagId: z.string().uuid(),
  enabled: z.boolean(),
});

const setOrganizationFlagSchema = z.object({
  action: z.literal("setOrgFlag"),
  organizationId: z.string().uuid(),
  flagId: z.string().uuid(),
  enabled: z.boolean(),
});

const setOrganizationPlanSchema = z.object({
  action: z.literal("setOrgPlan"),
  organizationId: z.string().uuid(),
  planCode: z.string().trim().max(100).nullable(),
  notes: z.string().trim().max(500).optional(),
});

const upsertOrganizationSchema = z.object({
  action: z.literal("upsertOrganization"),
  organization: z.object({
    id: z.string().uuid(),
    name: z.string().trim().max(200).optional(),
    slug: z
      .string()
      .trim()
      .max(200)
      .optional()
      .refine(value => !value || slugPattern.test(value), {
        message: "Slug may contain only lowercase letters, numbers, and hyphens",
      }),
    metadata: organizationMetadataSchema.optional(),
  }),
});

const schemaByAction = {
  list: listSchema,
  createFlag: createFlagSchema,
  updateGlobalFlag: updateGlobalFlagSchema,
  setOrgFlag: setOrganizationFlagSchema,
  setOrgPlan: setOrganizationPlanSchema,
  upsertOrganization: upsertOrganizationSchema,
} as const;

type ParsedAction =
  | z.infer<typeof listSchema>
  | z.infer<typeof createFlagSchema>
  | z.infer<typeof updateGlobalFlagSchema>
  | z.infer<typeof setOrganizationFlagSchema>
  | z.infer<typeof setOrganizationPlanSchema>
  | z.infer<typeof upsertOrganizationSchema>;

const normalizeSlug = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const sanitized = trimmed
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : null;
};

const sanitizeOrganizationMetadata = (
  value: Record<string, unknown> | OrganizationMetadata | undefined,
): OrganizationMetadata | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const result = organizationMetadataSchema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0];
    const message = issue?.message ?? "Invalid organization metadata";
    throw respond(400, { error: `Invalid organization metadata: ${message}` });
  }

  return JSON.parse(JSON.stringify(result.data)) as OrganizationMetadata;
};

const parseActionPayload = (raw: unknown): ParsedAction => {
  if (!raw || typeof raw !== "object") {
    throw respond(400, { error: "Payload must be an object" });
  }

  const candidate = raw as { action?: string };
  const actionKey = candidate.action;

  if (!actionKey || !(actionKey in schemaByAction)) {
    throw respond(400, { error: "Unsupported action" });
  }

  const schema = schemaByAction[actionKey as keyof typeof schemaByAction];
  const result = schema.safeParse(raw);

  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid payload";
    throw respond(400, { error: message });
  }

  return result.data as ParsedAction;
};

interface HandlerParams {
  req: Request;
  userContext: UserContext;
  db: SupabaseClient;
}

export async function handleFeatureFlagAdmin({ req, userContext, db }: HandlerParams): Promise<Response> {
  if (req.method !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  let parsed: ParsedAction;
  try {
    const rawPayload = await parseJson(req);
    parsed = parseActionPayload(rawPayload);
  } catch (error) {
    if (error instanceof Response) {
      logApiAccess(req.method, ADMIN_PATH, userContext, error.status);
      return error;
    }
    console.error("Failed to parse feature flag payload", error);
    logApiAccess(req.method, ADMIN_PATH, userContext, 500);
    return respond(500, { error: "Failed to parse request" });
  }

  const actorId = userContext.user.id;

  const handleError = (status: number, message: string) => {
    logApiAccess(req.method, ADMIN_PATH, userContext, status);
    return respond(status, { error: message });
  };

  try {
    switch (parsed.action) {
      case "list": {
        const [flagsRes, orgsRes, orgFlagsRes, plansRes, assignmentsRes] = await Promise.all([
          db
            .from("feature_flags")
            .select("id, flag_key, description, default_enabled, metadata, created_at, updated_at")
            .order("flag_key", { ascending: true }),
          db
            .from("organizations")
            .select("id, name, slug, metadata, created_at, updated_at")
            .order("name", { ascending: true, nullsFirst: true }),
          db
            .from("organization_feature_flags")
            .select(
              "id, organization_id, feature_flag_id, is_enabled, created_at, updated_at, created_by, updated_by",
            ),
          db
            .from("plans")
            .select("code, name, description, is_active, updated_at")
            .order("code", { ascending: true }),
          db
            .from("organization_plans")
            .select("organization_id, plan_code, assigned_at, assigned_by, notes"),
        ]);

        if (flagsRes.error) {
          console.error("Failed to load feature flags", flagsRes.error);
          return handleError(500, "Unable to load feature flags");
        }

        if (orgsRes.error) {
          console.error("Failed to load organizations", orgsRes.error);
          return handleError(500, "Unable to load organizations");
        }

        if (orgFlagsRes.error) {
          console.error("Failed to load organization flag overrides", orgFlagsRes.error);
          return handleError(500, "Unable to load organization overrides");
        }

        if (plansRes.error) {
          console.error("Failed to load plans", plansRes.error);
          return handleError(500, "Unable to load plan catalog");
        }

        if (assignmentsRes.error) {
          console.error("Failed to load organization plans", assignmentsRes.error);
          return handleError(500, "Unable to load organization plans");
        }

        logApiAccess(req.method, ADMIN_PATH, userContext, 200);
        return respond(200, {
          flags: flagsRes.data ?? [],
          organizations: orgsRes.data ?? [],
          organizationFlags: orgFlagsRes.data ?? [],
          organizationPlans: assignmentsRes.data ?? [],
          plans: plansRes.data ?? [],
        });
      }

      case "createFlag": {
        const { flagKey, description, defaultEnabled } = parsed;

        const insertResult = await db
          .from("feature_flags")
          .insert({
            flag_key: flagKey,
            description: description ?? null,
            default_enabled: defaultEnabled ?? false,
            created_by: actorId,
            updated_by: actorId,
          })
          .select("id, flag_key, description, default_enabled, metadata, created_at, updated_at")
          .single();

        if (insertResult.error) {
          console.error("Failed to create feature flag", insertResult.error);
          const status = insertResult.error.code === "23505" ? 409 : 400;
          return handleError(status, status === 409 ? "Flag already exists" : "Unable to create feature flag");
        }

        const createdFlag = insertResult.data;

        const audit = await db.from("feature_flag_audit_logs").insert({
          feature_flag_id: createdFlag.id,
          organization_id: null,
          plan_code: null,
          actor_id: actorId,
          action: "create_flag",
          previous_state: null,
          new_state: createdFlag,
        });

        if (audit.error) {
          console.error("Failed to write feature flag audit log", audit.error);
          return handleError(500, "Unable to persist feature flag audit trail");
        }

        logApiAccess(req.method, ADMIN_PATH, userContext, 201);
        return respond(201, { flag: createdFlag });
      }

      case "updateGlobalFlag": {
        const { flagId, enabled } = parsed;
        const existing = await db
          .from("feature_flags")
          .select("id, flag_key, description, default_enabled, metadata, created_at, updated_at")
          .eq("id", flagId)
          .single();

        if (existing.error) {
          const status = existing.error.code === "PGRST116" ? 404 : 500;
          if (status === 404) {
            return handleError(404, "Feature flag not found");
          }
          console.error("Failed to load feature flag", existing.error);
          return handleError(500, "Unable to load feature flag");
        }

        const updateResult = await db
          .from("feature_flags")
          .update({ default_enabled: enabled, updated_by: actorId })
          .eq("id", flagId)
          .select("id, flag_key, description, default_enabled, metadata, created_at, updated_at")
          .single();

        if (updateResult.error) {
          console.error("Failed to update feature flag", updateResult.error);
          return handleError(400, "Unable to update feature flag");
        }

        const updatedFlag = updateResult.data;

        const audit = await db.from("feature_flag_audit_logs").insert({
          feature_flag_id: updatedFlag.id,
          organization_id: null,
          plan_code: null,
          actor_id: actorId,
          action: "update_global_flag",
          previous_state: existing.data,
          new_state: updatedFlag,
        });

        if (audit.error) {
          console.error("Failed to log global flag update", audit.error);
          return handleError(500, "Unable to persist feature flag audit trail");
        }

        logApiAccess(req.method, ADMIN_PATH, userContext, 200);
        return respond(200, { flag: updatedFlag });
      }

      case "setOrgFlag": {
        const { organizationId, flagId, enabled } = parsed;

        const [orgResult, flagResult] = await Promise.all([
          db.from("organizations").select("id, name").eq("id", organizationId).single(),
          db.from("feature_flags").select("id, flag_key, default_enabled").eq("id", flagId).single(),
        ]);

        if (orgResult.error) {
          const status = orgResult.error.code === "PGRST116" ? 404 : 500;
          if (status === 404) {
            return handleError(404, "Organization not found");
          }
          console.error("Failed to load organization", orgResult.error);
          return handleError(500, "Unable to load organization");
        }

        if (flagResult.error) {
          const status = flagResult.error.code === "PGRST116" ? 404 : 500;
          if (status === 404) {
            return handleError(404, "Feature flag not found");
          }
          console.error("Failed to load feature flag for organization toggle", flagResult.error);
          return handleError(500, "Unable to load feature flag");
        }

        const existing = await db
          .from("organization_feature_flags")
          .select("id, is_enabled, created_at, updated_at, created_by, updated_by")
          .eq("organization_id", organizationId)
          .eq("feature_flag_id", flagId)
          .maybeSingle();

        if (existing.error) {
          console.error("Failed to load organization feature flag", existing.error);
          return handleError(500, "Unable to read organization feature flag");
        }

        let updatedRecord;
        if (existing.data) {
          const update = await db
            .from("organization_feature_flags")
            .update({ is_enabled: enabled, updated_by: actorId })
            .eq("id", existing.data.id)
            .select(
              "id, organization_id, feature_flag_id, is_enabled, created_at, updated_at, created_by, updated_by",
            )
            .single();

          if (update.error) {
            console.error("Failed to update organization feature flag", update.error);
            return handleError(400, "Unable to update organization feature flag");
          }

          updatedRecord = update.data;
        } else {
          const insert = await db
            .from("organization_feature_flags")
            .insert({
              organization_id: organizationId,
              feature_flag_id: flagId,
              is_enabled: enabled,
              created_by: actorId,
              updated_by: actorId,
            })
            .select(
              "id, organization_id, feature_flag_id, is_enabled, created_at, updated_at, created_by, updated_by",
            )
            .single();

          if (insert.error) {
            console.error("Failed to create organization feature flag", insert.error);
            return handleError(400, "Unable to create organization feature flag");
          }

          updatedRecord = insert.data;
        }

        const audit = await db.from("feature_flag_audit_logs").insert({
          feature_flag_id: flagId,
          organization_id: organizationId,
          plan_code: null,
          actor_id: actorId,
          action: "set_org_flag",
          previous_state: existing.data ?? null,
          new_state: updatedRecord,
        });

        if (audit.error) {
          console.error("Failed to log organization feature flag change", audit.error);
          return handleError(500, "Unable to persist feature flag audit trail");
        }

        logApiAccess(req.method, ADMIN_PATH, userContext, 200);
        return respond(200, { organizationFeatureFlag: updatedRecord });
      }

      case "setOrgPlan": {
        const { organizationId, planCode, notes } = parsed;

        const orgResult = await db
          .from("organizations")
          .select("id, name")
          .eq("id", organizationId)
          .single();

        if (orgResult.error) {
          const status = orgResult.error.code === "PGRST116" ? 404 : 500;
          if (status === 404) {
            return handleError(404, "Organization not found");
          }
          console.error("Failed to load organization for plan update", orgResult.error);
          return handleError(500, "Unable to load organization");
        }

        if (planCode) {
          const planResult = await db.from("plans").select("code").eq("code", planCode).single();
          if (planResult.error) {
            const status = planResult.error.code === "PGRST116" ? 404 : 500;
            if (status === 404) {
              return handleError(404, "Plan not found");
            }
            console.error("Failed to load plan for assignment", planResult.error);
            return handleError(500, "Unable to load plan");
          }
        }

        const existing = await db
          .from("organization_plans")
          .select("organization_id, plan_code, assigned_at, assigned_by, notes")
          .eq("organization_id", organizationId)
          .maybeSingle();

        if (existing.error) {
          console.error("Failed to load existing organization plan", existing.error);
          return handleError(500, "Unable to load organization plan");
        }

        let updatedAssignment;

        if (planCode === null) {
          if (existing.data) {
            const remove = await db
              .from("organization_plans")
              .delete()
              .eq("organization_id", organizationId)
              .select("organization_id, plan_code, assigned_at, assigned_by, notes")
              .maybeSingle();

            if (remove.error) {
              console.error("Failed to remove organization plan", remove.error);
              return handleError(400, "Unable to remove organization plan");
            }
          }
          updatedAssignment = null;
        } else if (existing.data) {
          const update = await db
            .from("organization_plans")
            .update({ plan_code: planCode, notes: notes ?? existing.data.notes, assigned_by: actorId })
            .eq("organization_id", organizationId)
            .select("organization_id, plan_code, assigned_at, assigned_by, notes")
            .single();

          if (update.error) {
            console.error("Failed to update organization plan", update.error);
            return handleError(400, "Unable to update organization plan");
          }

          updatedAssignment = update.data;
        } else {
          const insert = await db
            .from("organization_plans")
            .insert({
              organization_id: organizationId,
              plan_code: planCode,
              assigned_by: actorId,
              notes: notes ?? null,
            })
            .select("organization_id, plan_code, assigned_at, assigned_by, notes")
            .single();

          if (insert.error) {
            console.error("Failed to assign organization plan", insert.error);
            return handleError(400, "Unable to assign organization plan");
          }

          updatedAssignment = insert.data;
        }

        const audit = await db.from("feature_flag_audit_logs").insert({
          feature_flag_id: null,
          organization_id: organizationId,
          plan_code: planCode ?? existing.data?.plan_code ?? null,
          actor_id: actorId,
          action: "set_org_plan",
          previous_state: existing.data ?? null,
          new_state: updatedAssignment,
        });

        if (audit.error) {
          console.error("Failed to log plan assignment", audit.error);
          return handleError(500, "Unable to persist feature flag audit trail");
        }

        logApiAccess(req.method, ADMIN_PATH, userContext, 200);
        return respond(200, { organizationPlan: updatedAssignment });
      }

      case "upsertOrganization": {
        const { organization } = parsed;
        const normalizedSlug = normalizeSlug(organization.slug);
        const sanitizedMetadata = sanitizeOrganizationMetadata(organization.metadata);
        const metadataProvided = organization.metadata !== undefined;

        const existing = await db
          .from("organizations")
          .select("id, name, slug, metadata, created_at, updated_at")
          .eq("id", organization.id)
          .maybeSingle();

        if (existing.error) {
          console.error("Failed to load organization", existing.error);
          return handleError(500, "Unable to load organization");
        }

        let record;
        if (existing.data) {
          const updatePayload: Record<string, unknown> = {
            name: organization.name ?? existing.data.name,
            slug: normalizedSlug ?? existing.data.slug,
            updated_by: actorId,
          };

          if (metadataProvided) {
            updatePayload.metadata = sanitizedMetadata ?? {};
          }

          const update = await db
            .from("organizations")
            .update(updatePayload)
            .eq("id", organization.id)
            .select("id, name, slug, metadata, created_at, updated_at")
            .single();

          if (update.error) {
            console.error("Failed to update organization", update.error);
            return handleError(400, "Unable to update organization");
          }

          record = update.data;

          const audit = await db.from("feature_flag_audit_logs").insert({
            feature_flag_id: null,
            organization_id: organization.id,
            plan_code: null,
            actor_id: actorId,
            action: "update_organization",
            previous_state: existing.data,
            new_state: record,
          });

          if (audit.error) {
            console.error("Failed to log organization update", audit.error);
            return handleError(500, "Unable to persist feature flag audit trail");
          }
        } else {
          const insert = await db
            .from("organizations")
            .insert({
              id: organization.id,
              name: organization.name ?? null,
              slug: normalizedSlug,
              metadata: sanitizedMetadata ?? {},
              created_by: actorId,
              updated_by: actorId,
            })
            .select("id, name, slug, metadata, created_at, updated_at")
            .single();

          if (insert.error) {
            console.error("Failed to create organization", insert.error);
            return handleError(400, "Unable to create organization");
          }

          record = insert.data;

          const audit = await db.from("feature_flag_audit_logs").insert({
            feature_flag_id: null,
            organization_id: organization.id,
            plan_code: null,
            actor_id: actorId,
            action: "create_organization",
            previous_state: null,
            new_state: record,
          });

          if (audit.error) {
            console.error("Failed to log organization creation", audit.error);
            return handleError(500, "Unable to persist feature flag audit trail");
          }
        }

        logApiAccess(req.method, ADMIN_PATH, userContext, existing.data ? 200 : 201);
        return respond(existing.data ? 200 : 201, { organization: record });
      }

      default:
        return handleError(400, "Unsupported action");
    }
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error("Unexpected feature flag error", error);
    return handleError(500, "Unexpected server error");
  }
}

export default createProtectedRoute(
  (req, userContext) => handleFeatureFlagAdmin({ req, userContext, db: createRequestClient(req) }),
  RouteOptions.superAdmin,
);
