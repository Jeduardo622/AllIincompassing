import {
  createProtectedRoute,
  corsHeaders,
  RouteOptions,
  type UserContext,
} from "../_shared/auth-middleware.ts";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { MissingOrgContextError, requireOrg } from "../_shared/org.ts";
import {
  claimQueuedSessionNotePdfExport,
  expireReadyExportIfNeeded,
  getSessionNotePdfExportJob,
  isStaleProcessingJob,
  processSessionNotePdfExportJob,
  resetStaleProcessingExport,
  type SessionNotePdfExportRow,
} from "../_shared/session-note-pdf-exports.ts";

interface StatusRequestBody {
  exportId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STALE_PROCESSING_MS = 2 * 60 * 1000;
const isAsyncExportEnabled = (): boolean => {
  const raw = Deno.env.get("SESSION_NOTES_PDF_ASYNC");
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return true;
  }
  return /^(1|true|yes|on)$/i.test(raw.trim());
};

const extractExportId = (req: Request, body: StatusRequestBody): string | null => {
  if (typeof body.exportId === "string" && UUID_RE.test(body.exportId)) {
    return body.exportId;
  }
  const url = new URL(req.url);
  const queryValue = url.searchParams.get("exportId");
  if (queryValue && UUID_RE.test(queryValue)) {
    return queryValue;
  }
  return null;
};

const toResponseBody = (job: SessionNotePdfExportRow) => {
  const terminal = job.status === "ready" || job.status === "failed" || job.status === "expired";
  return {
    success: true,
    data: {
      exportId: job.id,
      status: job.status,
      error: job.error,
      expiresAt: job.expires_at,
      completedAt: job.completed_at,
      downloadReady: job.status === "ready",
      isTerminal: terminal,
      pollAfterMs: terminal ? 0 : 1500,
    },
  };
};

const canAccessJob = (job: SessionNotePdfExportRow, userContext: UserContext): boolean => {
  if (job.requested_by === userContext.user.id) {
    return true;
  }
  return userContext.profile.role === "admin" || userContext.profile.role === "super_admin";
};

export default createProtectedRoute(async (req: Request, userContext: UserContext) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (!isAsyncExportEnabled()) {
      return new Response(JSON.stringify({ error: "Session notes PDF async export is disabled." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createRequestClient(req);
    const orgId = await requireOrg(db);
    const body = req.method === "POST"
      ? (await req.json().catch(() => ({} as StatusRequestBody)))
      : ({} as StatusRequestBody);
    const exportId = extractExportId(req, body);

    if (!exportId) {
      return new Response(JSON.stringify({ error: "exportId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let job = await getSessionNotePdfExportJob(supabaseAdmin, orgId, exportId);
    if (!job) {
      return new Response(JSON.stringify({ error: "Export job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!canAccessJob(job, userContext)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    job = await expireReadyExportIfNeeded(supabaseAdmin, job);

    if (job.status === "queued") {
      console.info("session-notes-pdf-status claim_queued", { exportId: job.id, organizationId: job.organization_id });
      const claimed = await claimQueuedSessionNotePdfExport(supabaseAdmin, job.id);
      if (claimed) {
        try {
          await processSessionNotePdfExportJob(supabaseAdmin, claimed);
        } catch (error) {
          console.error("session-notes-pdf-status process error", error);
        }
      }
    } else if (isStaleProcessingJob(job, STALE_PROCESSING_MS)) {
      console.warn("session-notes-pdf-status stale_requeue", { exportId: job.id, organizationId: job.organization_id });
      await resetStaleProcessingExport(supabaseAdmin, job.id);
      const reclaimed = await claimQueuedSessionNotePdfExport(supabaseAdmin, job.id);
      if (reclaimed) {
        try {
          await processSessionNotePdfExportJob(supabaseAdmin, reclaimed);
        } catch (error) {
          console.error("session-notes-pdf-status reprocess error", error);
        }
      }
    }

    const refreshed = await getSessionNotePdfExportJob(supabaseAdmin, orgId, exportId);
    if (!refreshed) {
      return new Response(JSON.stringify({ error: "Export job unavailable after refresh" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!canAccessJob(refreshed, userContext)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(toResponseBody(refreshed)), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof MissingOrgContextError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("session-notes-pdf-status error", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}, RouteOptions.therapist);
