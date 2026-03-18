import {
  createProtectedRoute,
  corsHeaders,
  RouteOptions,
  type UserContext,
} from "../_shared/auth-middleware.ts";
import { createRequestClient, supabaseAdmin } from "../_shared/database.ts";
import { MissingOrgContextError, orgScopedQuery, requireOrg } from "../_shared/org.ts";
import { getRequestId } from "../lib/http/error.ts";
import {
  getSessionNotePdfExportJob,
  SESSION_NOTE_EXPORT_BUCKET,
  type SessionNotePdfExportStatus,
} from "../_shared/session-note-pdf-exports.ts";

interface RequestBody {
  noteIds?: string[];
  clientId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: string): boolean => UUID_RE.test(value);
const isAsyncExportEnabled = (): boolean => {
  const raw = Deno.env.get("SESSION_NOTES_PDF_ASYNC");
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return true;
  }
  return /^(1|true|yes|on)$/i.test(raw.trim());
};

const normalizeNoteIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && isUuid(item)),
    ),
  );
};

const mapAsyncResponse = (exportId: string, status: SessionNotePdfExportStatus) => ({
  success: true,
  data: {
    exportId,
    status,
  },
});

export default createProtectedRoute(async (req: Request, userContext: UserContext) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
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
    const requestId = getRequestId(req);

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const noteIds = normalizeNoteIds(body.noteIds);
    const clientId = typeof body.clientId === "string" && isUuid(body.clientId) ? body.clientId : null;

    if (!clientId || noteIds.length === 0) {
      return new Response(JSON.stringify({ error: "clientId and noteIds are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await orgScopedQuery(db, "client_session_notes", orgId)
      .select("id")
      .eq("client_id", clientId)
      .in("id", noteIds);

    if (error) {
      return new Response(JSON.stringify({ error: "Failed to load session notes" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const notes = Array.isArray(data) ? data : [];
    if (notes.length !== noteIds.length) {
      return new Response(JSON.stringify({ error: "No session notes found for export" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingQueued } = await supabaseAdmin
      .from("session_note_pdf_exports")
      .select("id,status")
      .eq("organization_id", orgId)
      .eq("requested_by", userContext.user.id)
      .eq("client_id", clientId)
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingQueued?.id && typeof existingQueued.id === "string") {
      const status = typeof existingQueued.status === "string" ? existingQueued.status as SessionNotePdfExportStatus : "queued";
      return new Response(JSON.stringify(mapAsyncResponse(existingQueued.id, status)), {
        status: 202,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    const inserted = await supabaseAdmin
      .from("session_note_pdf_exports")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        requested_by: userContext.user.id,
        note_ids: noteIds,
        status: "queued",
        storage_bucket: SESSION_NOTE_EXPORT_BUCKET,
        request_id: requestId,
      })
      .select("id")
      .single();

    if (inserted.error || !inserted.data?.id) {
      return new Response(JSON.stringify({ error: "Failed to enqueue export job" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.info("generate-session-notes-pdf enqueued", {
      exportId: inserted.data.id,
      organizationId: orgId,
      clientId,
      requestedBy: userContext.user.id,
      noteCount: noteIds.length,
      requestId,
    });

    const job = await getSessionNotePdfExportJob(supabaseAdmin, orgId, inserted.data.id);
    if (!job) {
      return new Response(JSON.stringify({ error: "Export job not found after enqueue" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(mapAsyncResponse(job.id, job.status)), {
      status: 202,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    if (error instanceof MissingOrgContextError) {
      return new Response(JSON.stringify({ error: error.message, role: userContext.profile.role }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("generate-session-notes-pdf error", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}, RouteOptions.therapist);
