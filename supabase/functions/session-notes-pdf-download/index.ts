import {
  createProtectedRoute,
  corsHeaders,
  RouteOptions,
  type UserContext,
} from "../_shared/auth-middleware.ts";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { MissingOrgContextError, requireOrg } from "../_shared/org.ts";
import {
  expireReadyExportIfNeeded,
  getSessionNotePdfExportJob,
} from "../_shared/session-note-pdf-exports.ts";

interface DownloadRequestBody {
  exportId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isAsyncExportEnabled = (): boolean => {
  const raw = Deno.env.get("SESSION_NOTES_PDF_ASYNC");
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return true;
  }
  return /^(1|true|yes|on)$/i.test(raw.trim());
};

const extractExportId = (req: Request, body: DownloadRequestBody): string | null => {
  if (typeof body.exportId === "string" && UUID_RE.test(body.exportId)) {
    return body.exportId;
  }
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("exportId");
  if (fromQuery && UUID_RE.test(fromQuery)) {
    return fromQuery;
  }
  return null;
};

const getFileName = (clientId: string, exportId: string): string => `session-notes-${clientId}-${exportId}.pdf`;

const canAccessJob = (requestedBy: string, userContext: UserContext): boolean => {
  if (requestedBy === userContext.user.id) {
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
      ? (await req.json().catch(() => ({} as DownloadRequestBody)))
      : ({} as DownloadRequestBody);
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
    if (!canAccessJob(job.requested_by, userContext)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    job = await expireReadyExportIfNeeded(supabaseAdmin, job);
    if (job.status !== "ready") {
      return new Response(JSON.stringify({ error: `Export not ready (status=${job.status})` }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!job.storage_bucket || !job.storage_path) {
      return new Response(JSON.stringify({ error: "Export artifact path missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const download = await supabaseAdmin.storage
      .from(job.storage_bucket)
      .download(job.storage_path);
    if (download.error || !download.data) {
      return new Response(JSON.stringify({ error: "Failed to download export artifact" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const filename = getFileName(job.client_id, job.id);
    return new Response(download.data, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof MissingOrgContextError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("session-notes-pdf-download error", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}, RouteOptions.therapist);
