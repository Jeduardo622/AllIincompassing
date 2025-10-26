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

export async function featureFlagsRoute({ req, userContext, db }: HandlerParams): Promise<Response> {
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
      case "upsertOrganization": {
        const { organization } = parsed;
        const normalizedSlug = normalizeSlug(organization.slug);
        const sanitizedMetadata = sanitizeOrganizationMetadata(organization.metadata);

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
          const update = await db
            .from("organizations")
            .update({
              name: organization.name ?? null,
              slug: normalizedSlug,
              metadata: sanitizedMetadata ?? {},
              updated_by: actorId,
            })
            .eq("id", organization.id)
            .select("id, name, slug, metadata, created_at, updated_at")
            .single();

          if (update.error) {
            console.error("Failed to update organization", update.error);
            return handleError(400, "Unable to update organization");
          }

          record = update.data;
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
  (req, userContext) => featureFlagsRoute({ req, userContext, db: createRequestClient(req) }),
  RouteOptions.superAdmin,
);


