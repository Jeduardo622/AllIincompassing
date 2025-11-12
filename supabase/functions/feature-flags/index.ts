// deno-lint-ignore-file no-import-prefix
import { z } from "npm:zod@3.23.8";
import { organizationMetadataSchema, type OrganizationMetadata } from "./schema.ts";

const SUPABASE_MODULE_SPEC = "npm:@supabase/supabase-js@2.50.0" as const;

type SupabaseModule = typeof import("npm:@supabase/supabase-js@2.50.0");
type SupabaseClient = import("npm:@supabase/supabase-js@2.50.0").SupabaseClient;
type UserContext = import("./_shared/auth-middleware.ts").UserContext;
type AuthMiddlewareOptions = import("./_shared/auth-middleware.ts").AuthMiddlewareOptions;

type ProtectedRouteFactory = (
  handler: (req: Request, userContext: UserContext) => Promise<Response>,
  options: AuthMiddlewareOptions,
) => (req: Request) => Promise<Response>;

interface AuthModule {
  createProtectedRoute: ProtectedRouteFactory;
  RouteOptions: {
    admin: AuthMiddlewareOptions;
  };
  logApiAccess: LogApiAccess;
}

interface DatabaseModule {
  configureSupabaseModule: (module: SupabaseModule) => void;
  createRequestClient: (req: Request) => SupabaseClient;
  getSupabaseAdmin: () => SupabaseClient;
}

const ADMIN_PATH = "/super-admin/feature-flags";

const STATIC_ALLOWED_ORIGINS = [
  "https://app.allincompassing.ai",
  "https://preview.allincompassing.ai",
  "https://staging.allincompassing.ai",
  "http://localhost:3000",
  "http://localhost:5173",
];
const envAllowedOrigins = (Deno.env.get("EDGE_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = Array.from(new Set([...STATIC_ALLOWED_ORIGINS, ...envAllowedOrigins]));
const PRIMARY_ALLOWED_ORIGIN = ALLOWED_ORIGINS[0] ?? "https://app.allincompassing.ai";
const adminAllowedOrigins = new Set(ALLOWED_ORIGINS);

const DEFAULT_ORGANIZATION_ID = ((): string | null => {
  const raw = Deno.env.get("DEFAULT_ORGANIZATION_ID") ?? "";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
})();

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
};

type LogApiAccess = (method: string, path: string, userContext: UserContext | null, status: number) => void;

let supabaseModulePromise: Promise<SupabaseModule> | null = null;
const loadSupabaseModule = () => {
  if (!supabaseModulePromise) {
    supabaseModulePromise = import(SUPABASE_MODULE_SPEC);
  }
  return supabaseModulePromise;
};

let authModulePromise: Promise<AuthModule> | null = null;
const loadAuthModule = () => {
  if (!authModulePromise) {
    authModulePromise = import("./_shared/auth-middleware.ts").then(module => {
      const api = module as {
        createProtectedRoute: ProtectedRouteFactory;
        RouteOptions: { admin: AuthMiddlewareOptions };
        logApiAccess: LogApiAccess;
      };
      return {
        createProtectedRoute: api.createProtectedRoute,
        RouteOptions: api.RouteOptions,
        logApiAccess: api.logApiAccess,
      };
    });
  }
  return authModulePromise;
};

let databaseModulePromise: Promise<DatabaseModule> | null = null;
const loadDatabaseModule = () => {
  if (!databaseModulePromise) {
    databaseModulePromise = import("./_shared/database.ts").then(module => {
      const api = module as unknown as DatabaseModule;
      return {
        configureSupabaseModule: api.configureSupabaseModule,
        createRequestClient: api.createRequestClient,
        getSupabaseAdmin: api.getSupabaseAdmin,
      };
    });
  }
  return databaseModulePromise;
};

interface InitializedDependencies {
  authModule: AuthModule;
  dbModule: DatabaseModule;
  supabaseModule: SupabaseModule;
  protectedAdminHandler: (req: Request) => Promise<Response>;
}

let initializationPromise: Promise<InitializedDependencies> | null = null;

const initializeDependencies = (): Promise<InitializedDependencies> => {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const [authModule, dbModule, supabaseModule] = await Promise.all([
        loadAuthModule(),
        loadDatabaseModule(),
        loadSupabaseModule(),
      ]);

      dbModule.configureSupabaseModule(supabaseModule);

      const protectedAdminHandler = authModule.createProtectedRoute(
        (req, userContext) =>
          handleFeatureFlagAdmin({
            req,
            userContext,
            db: dbModule.createRequestClient(req),
            getSupabaseAdmin: dbModule.getSupabaseAdmin,
            logApiAccess: authModule.logApiAccess,
          }),
        authModule.RouteOptions.admin,
      );

      return { authModule, dbModule, supabaseModule, protectedAdminHandler };
    })();
  }

  return initializationPromise;
};

const resolveRequestOrigin = (req: Request): { origin: string | null; requestedOrigin: string | null } => {
  const requestedOrigin = req.headers.get("origin");
  if (!requestedOrigin) {
    return { origin: null, requestedOrigin: null };
  }

  if (adminAllowedOrigins.has(requestedOrigin)) {
    return { origin: requestedOrigin, requestedOrigin };
  }

  return { origin: null, requestedOrigin };
};

const buildAdminCorsHeaders = (origin: string | null): Record<string, string> => ({
  "Access-Control-Allow-Origin": origin ?? PRIMARY_ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

const buildRuntimeCorsHeaders = (origin: string | null): Record<string, string> => ({
  "Access-Control-Allow-Origin": origin ?? PRIMARY_ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  Vary: "Origin",
});

const withCors = (origin: string | null, init: ResponseInit = {}): ResponseInit => ({
  ...init,
  headers: { ...(init.headers ?? {}), ...buildRuntimeCorsHeaders(origin) },
});

const respond = (origin: string | null, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_CORS_HEADERS, ...buildAdminCorsHeaders(origin), "Content-Type": "application/json" },
  });

const parseJson = async (req: Request, origin: string | null): Promise<unknown> => {
  try {
    return await req.json();
  } catch {
    throw respond(origin, 400, { error: "Invalid JSON payload" });
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
      .refine((value: string | null | undefined) => !value || slugPattern.test(value), {
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
  origin: string | null,
): OrganizationMetadata | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const result = organizationMetadataSchema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0];
    const message = issue?.message ?? "Invalid organization metadata";
    throw respond(origin, 400, { error: `Invalid organization metadata: ${message}` });
  }

  return JSON.parse(JSON.stringify(result.data)) as OrganizationMetadata;
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractOrganizationIdFromMetadata = (
  metadata: Record<string, unknown> | null | undefined,
): string | null => {
  if (!metadata) return null;
  const snake = asNonEmptyString(metadata["organization_id"]);
  if (snake) return snake;
  const camel = asNonEmptyString(metadata["organizationId"]);
  return camel;
};

const resolveCallerOrganizationId = async (
  userId: string,
  origin: string | null,
  adminClient: SupabaseClient,
): Promise<string | null> => {
  const { data, error } = await adminClient.auth.admin.getUserById(userId);

  if (error || !data?.user) {
    console.error("Failed to load caller metadata for organization sync", { userId, error });
    throw respond(origin, 500, { error: "Unable to load caller metadata" });
  }

  const metadata = data.user.user_metadata as Record<string, unknown> | undefined;
  return extractOrganizationIdFromMetadata(metadata ?? {});
};

const parseActionPayload = (raw: unknown, origin: string | null): ParsedAction => {
  if (!raw || typeof raw !== "object") {
    throw respond(origin, 400, { error: "Payload must be an object" });
  }

  const candidate = raw as { action?: string };
  const actionKey = candidate.action;

  if (!actionKey || !(actionKey in schemaByAction)) {
    throw respond(origin, 400, { error: "Unsupported action" });
  }

  const schema = schemaByAction[actionKey as keyof typeof schemaByAction];
  const result = schema.safeParse(raw);

  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid payload";
    throw respond(origin, 400, { error: message });
  }

  return result.data as ParsedAction;
};

interface HandlerParams {
  req: Request;
  userContext: UserContext;
  db: SupabaseClient;
  getSupabaseAdmin: () => SupabaseClient;
  logApiAccess: LogApiAccess;
}

export async function handleFeatureFlagAdmin({
  req,
  userContext,
  db,
  getSupabaseAdmin,
  logApiAccess,
}: HandlerParams): Promise<Response> {
  const { origin, requestedOrigin } = resolveRequestOrigin(req);

  if (requestedOrigin && !origin) {
    logApiAccess(req.method, ADMIN_PATH, userContext, 403);
    return respond(origin, 403, { error: "Origin not allowed" });
  }

  if (req.method !== "POST") {
    return respond(origin, 405, { error: "Method not allowed" });
  }

  let parsed: ParsedAction;
  try {
    const rawPayload = await parseJson(req, origin);
    parsed = parseActionPayload(rawPayload, origin);
  } catch (error) {
    if (error instanceof Response) {
      logApiAccess(req.method, ADMIN_PATH, userContext, error.status);
      return error;
    }
    console.error("Failed to parse feature flag payload", error);
    logApiAccess(req.method, ADMIN_PATH, userContext, 500);
    return respond(origin, 500, { error: "Failed to parse request" });
  }

  const handleError = (status: number, message: string) => {
    logApiAccess(req.method, ADMIN_PATH, userContext, status);
    return respond(origin, status, { error: message });
  };

  const actorId = userContext.user.id;
  const actorRole = userContext.profile.role;
  const isSuperAdmin = actorRole === "super_admin";
  const isAdmin = actorRole === "admin";
  const adminClient = getSupabaseAdmin();

  if (!isSuperAdmin && !isAdmin) {
    return handleError(403, "Insufficient permissions");
  }

  try {
    switch (parsed.action) {
      case "list": {
        if (!isSuperAdmin) {
          return handleError(403, "Super admin role required");
        }
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
        return respond(origin, 200, {
          flags: flagsRes.data ?? [],
          organizations: orgsRes.data ?? [],
          organizationFlags: orgFlagsRes.data ?? [],
          organizationPlans: assignmentsRes.data ?? [],
          plans: plansRes.data ?? [],
        });
      }

      case "createFlag": {
        if (!isSuperAdmin) {
          return handleError(403, "Super admin role required");
        }
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
        return respond(origin, 201, { flag: createdFlag });
      }

      case "updateGlobalFlag": {
        if (!isSuperAdmin) {
          return handleError(403, "Super admin role required");
        }
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
        return respond(origin, 200, { flag: updatedFlag });
      }

      case "setOrgFlag": {
        if (!isSuperAdmin) {
          return handleError(403, "Super admin role required");
        }
        const { organizationId, flagId, enabled } = parsed;

        if (!DEFAULT_ORGANIZATION_ID) {
          console.error("DEFAULT_ORGANIZATION_ID env var is not configured");
          return handleError(500, "Organization provisioning is not configured");
        }

        if (organizationId !== DEFAULT_ORGANIZATION_ID) {
          return handleError(403, "Only the primary clinic can be updated while single-clinic mode is active");
        }

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
        return respond(origin, 200, { organizationFeatureFlag: updatedRecord });
      }

      case "setOrgPlan": {
        if (!isSuperAdmin) {
          return handleError(403, "Super admin role required");
        }
        const { organizationId, planCode, notes } = parsed;

        if (!DEFAULT_ORGANIZATION_ID) {
          console.error("DEFAULT_ORGANIZATION_ID env var is not configured");
          return handleError(500, "Organization provisioning is not configured");
        }

        if (organizationId !== DEFAULT_ORGANIZATION_ID) {
          return handleError(403, "Only the primary clinic can be updated while single-clinic mode is active");
        }

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
        return respond(origin, 200, { organizationPlan: updatedAssignment });
      }

      case "upsertOrganization": {
        if (!isSuperAdmin) {
          if (!isAdmin) {
            return handleError(403, "Insufficient permissions");
          }

          const callerOrgId = await resolveCallerOrganizationId(actorId, origin, adminClient);
          if (callerOrgId) {
            return handleError(403, "Admins already linked to an organization cannot create additional organizations");
          }
        }

        const { organization } = parsed;
        const normalizedSlug = normalizeSlug(organization.slug);
        const sanitizedMetadata = sanitizeOrganizationMetadata(organization.metadata, origin);
        const metadataProvided = organization.metadata !== undefined;

        if (!DEFAULT_ORGANIZATION_ID) {
          console.error("DEFAULT_ORGANIZATION_ID env var is not configured");
          return handleError(500, "Organization provisioning is not configured");
        }

        if (organization.id !== DEFAULT_ORGANIZATION_ID) {
          return handleError(403, "Only the primary clinic can be updated while single-clinic mode is active");
        }

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
        return respond(origin, existing.data ? 200 : 201, { organization: record });
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

// Note: default export is the `handler` below to support GET/OPTIONS CORS logic.

export const applyAdminCors = async (response: Response, origin: string | null = null): Promise<Response> => {
  const headers = new Headers(response.headers);
  const corsHeadersForOrigin = buildAdminCorsHeaders(origin);
  headers.set("Access-Control-Allow-Origin", corsHeadersForOrigin["Access-Control-Allow-Origin"]);
  headers.set("Vary", "Origin");
  if (!headers.has("Access-Control-Allow-Methods")) {
    headers.set("Access-Control-Allow-Methods", corsHeadersForOrigin["Access-Control-Allow-Methods"]);
  }
  if (!headers.has("Access-Control-Allow-Headers")) {
    headers.set("Access-Control-Allow-Headers", corsHeadersForOrigin["Access-Control-Allow-Headers"]);
  }
  if (!headers.has("Access-Control-Max-Age")) {
    headers.set("Access-Control-Max-Age", corsHeadersForOrigin["Access-Control-Max-Age"]);
  }

  if (response.status === 204 || response.body === null) {
    return new Response(null, { status: response.status, headers });
  }

  const payload = await response.text();
  return new Response(payload, { status: response.status, headers });
};

export async function handler(req: Request): Promise<Response> {
  const { origin, requestedOrigin } = resolveRequestOrigin(req);

  if (requestedOrigin && !origin) {
    return respond(origin, 403, { error: "Origin not allowed" });
  }

  if (req.method === "OPTIONS") {
    const requestedMethod = (req.headers.get("Access-Control-Request-Method") || "").toUpperCase();
    if (!requestedMethod || requestedMethod === "GET") {
      return new Response(null, { status: 204, headers: buildRuntimeCorsHeaders(origin) });
    }

    const headers = buildAdminCorsHeaders(origin);
    const requestedHeaders = req.headers.get("Access-Control-Request-Headers");
    if (requestedHeaders) {
      headers["Access-Control-Allow-Headers"] = requestedHeaders;
    }

    return new Response(null, { status: 204, headers });
  }

  const { supabaseModule, protectedAdminHandler } = await initializeDependencies();

  if (req.method === "GET") {
    const authz = req.headers.get("authorization") ?? "";
    if (!authz.toLowerCase().startsWith("bearer ")) {
      return new Response(
        JSON.stringify({ error: "missing_token" }),
        withCors(origin, { status: 401, headers: { "Content-Type": "application/json" } }),
      );
    }

    const supabase = supabaseModule.createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authz } } },
    );

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return new Response(
        JSON.stringify({ error: "invalid_token" }),
        withCors(origin, { status: 401, headers: { "Content-Type": "application/json" } }),
      );
    }

    return new Response(
      JSON.stringify({ flags: { newDashboard: true } }),
      withCors(origin, { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  }

  const adminResp = await protectedAdminHandler(req);
  return applyAdminCors(adminResp, origin);
}

// Deno entrypoint
export default handler;
