import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";

export type SessionNotePdfExportStatus = "queued" | "processing" | "ready" | "failed" | "expired";

export interface SessionNotePdfExportRow {
  id: string;
  organization_id: string;
  client_id: string;
  requested_by: string;
  note_ids: string[];
  status: SessionNotePdfExportStatus;
  error: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
}

interface SessionNoteRecord {
  id: string;
  session_date: string | null;
  start_time: string | null;
  end_time: string | null;
  service_code: string | null;
  goals_addressed: string[] | null;
  narrative: string | null;
  therapists: { full_name: string | null } | null;
  clients: { full_name: string | null } | null;
}

export const SESSION_NOTE_EXPORT_BUCKET = "session-note-exports";
const FONT_SIZE = 11;
const LINE_HEIGHT = 16;
const PAGE_MARGIN = 48;
const MAX_ERROR_LENGTH = 500;
const EXPORT_TTL_HOURS = 24;

const nowIso = (): string => new Date().toISOString();

const addHoursIso = (hours: number): string => {
  const now = new Date();
  now.setHours(now.getHours() + hours);
  return now.toISOString();
};

const truncateError = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error ?? "Unknown export error");
  return text.length > MAX_ERROR_LENGTH ? text.slice(0, MAX_ERROR_LENGTH) : text;
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
        .filter((item) => item.length > 0),
    ),
  );
};

const wrapText = (
  text: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (value: string, size: number) => number },
  fontSize: number,
): string[] => {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let currentLine = words[0] ?? "";
  for (let index = 1; index < words.length; index += 1) {
    const nextWord = words[index] ?? "";
    const testLine = currentLine ? `${currentLine} ${nextWord}` : nextWord;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    if (width <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = nextWord;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
};

const drawSection = (
  page: any,
  title: string,
  text: string,
  font: any,
  boldFont: any,
  y: number,
) => {
  page.drawText(title, { x: PAGE_MARGIN, y, size: FONT_SIZE, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
  const lines = wrapText(text, page.getWidth() - PAGE_MARGIN * 2, font, FONT_SIZE);
  let cursorY = y - LINE_HEIGHT;
  for (const line of lines) {
    page.drawText(line, { x: PAGE_MARGIN, y: cursorY, size: FONT_SIZE, font, color: rgb(0.2, 0.2, 0.2) });
    cursorY -= LINE_HEIGHT;
  }
  return cursorY - LINE_HEIGHT / 2;
};

const buildPdf = async (notes: SessionNoteRecord[], clientId: string): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage();
  let y = page.getHeight() - PAGE_MARGIN;

  page.drawText("Session Notes Export", {
    x: PAGE_MARGIN,
    y,
    size: 16,
    font: boldFont,
    color: rgb(0.05, 0.05, 0.05),
  });
  y -= LINE_HEIGHT * 2;

  const clientName = notes[0]?.clients?.full_name ?? "Client";
  page.drawText(`Client: ${clientName}`, {
    x: PAGE_MARGIN,
    y,
    size: FONT_SIZE,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= LINE_HEIGHT * 2;

  for (const note of notes) {
    const sessionDate = note.session_date ?? "Unknown Date";
    const startTime = note.start_time ?? "Unknown Start";
    const endTime = note.end_time ?? "Unknown End";
    const therapistName = note.therapists?.full_name ?? "Unknown Therapist";
    const meta = `${sessionDate} · ${startTime} - ${endTime} · ${therapistName}`;

    if (y < PAGE_MARGIN + LINE_HEIGHT * 8) {
      page = pdfDoc.addPage();
      y = page.getHeight() - PAGE_MARGIN;
    }

    page.drawText(meta, {
      x: PAGE_MARGIN,
      y,
      size: FONT_SIZE,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= LINE_HEIGHT;

    y = drawSection(page, "Service", note.service_code ?? "Unknown", font, boldFont, y);
    const goals = Array.isArray(note.goals_addressed) ? note.goals_addressed.join(", ") : "";
    y = drawSection(page, "Goals Addressed", goals || "None listed", font, boldFont, y);
    y = drawSection(page, "Narrative", note.narrative ?? "", font, boldFont, y);
    y -= LINE_HEIGHT;
  }

  return pdfDoc.save();
};

const mapJob = (row: Record<string, unknown>): SessionNotePdfExportRow | null => {
  const id = typeof row.id === "string" ? row.id : null;
  const organizationId = typeof row.organization_id === "string" ? row.organization_id : null;
  const clientId = typeof row.client_id === "string" ? row.client_id : null;
  const requestedBy = typeof row.requested_by === "string" ? row.requested_by : null;
  const status = typeof row.status === "string" ? row.status as SessionNotePdfExportStatus : null;
  if (!id || !organizationId || !clientId || !requestedBy || !status) {
    return null;
  }

  return {
    id,
    organization_id: organizationId,
    client_id: clientId,
    requested_by: requestedBy,
    note_ids: normalizeNoteIds(row.note_ids),
    status,
    error: typeof row.error === "string" ? row.error : null,
    storage_bucket: typeof row.storage_bucket === "string" ? row.storage_bucket : null,
    storage_path: typeof row.storage_path === "string" ? row.storage_path : null,
    created_at: typeof row.created_at === "string" ? row.created_at : nowIso(),
    started_at: typeof row.started_at === "string" ? row.started_at : null,
    completed_at: typeof row.completed_at === "string" ? row.completed_at : null,
    expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
  };
};

export async function getSessionNotePdfExportJob(
  adminClient: SupabaseClient,
  orgId: string,
  exportId: string,
): Promise<SessionNotePdfExportRow | null> {
  const { data, error } = await adminClient
    .from("session_note_pdf_exports")
    .select("*")
    .eq("id", exportId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? "Failed to load session-note PDF export");
  }
  if (!data) {
    return null;
  }
  return mapJob(data as Record<string, unknown>);
}

export async function claimQueuedSessionNotePdfExport(
  adminClient: SupabaseClient,
  exportId: string,
): Promise<SessionNotePdfExportRow | null> {
  const { data, error } = await adminClient
    .from("session_note_pdf_exports")
    .update({
      status: "processing",
      started_at: nowIso(),
      error: null,
    })
    .eq("id", exportId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? "Failed to claim queued export job");
  }
  if (!data) {
    return null;
  }
  return mapJob(data as Record<string, unknown>);
}

export async function resetStaleProcessingExport(
  adminClient: SupabaseClient,
  exportId: string,
): Promise<void> {
  const { error } = await adminClient
    .from("session_note_pdf_exports")
    .update({
      status: "queued",
      error: "Processing timed out and was re-queued.",
    })
    .eq("id", exportId)
    .eq("status", "processing");

  if (error) {
    throw new Error(error.message ?? "Failed to requeue stale export");
  }
}

export async function markExportFailed(
  adminClient: SupabaseClient,
  exportId: string,
  error: unknown,
): Promise<void> {
  const { error: updateError } = await adminClient
    .from("session_note_pdf_exports")
    .update({
      status: "failed",
      error: truncateError(error),
      completed_at: nowIso(),
    })
    .eq("id", exportId);

  if (updateError) {
    throw new Error(updateError.message ?? "Failed to mark export as failed");
  }
}

export function isStaleProcessingJob(
  job: SessionNotePdfExportRow,
  staleMs: number,
): boolean {
  if (job.status !== "processing" || !job.started_at) {
    return false;
  }
  const startedAt = new Date(job.started_at).getTime();
  return Number.isFinite(startedAt) && Date.now() - startedAt > staleMs;
}

export async function processSessionNotePdfExportJob(
  adminClient: SupabaseClient,
  job: SessionNotePdfExportRow,
): Promise<SessionNotePdfExportRow> {
  try {
    console.info("session-note-pdf-export processing_start", {
      exportId: job.id,
      organizationId: job.organization_id,
      clientId: job.client_id,
      noteCount: job.note_ids.length,
    });

    if (!Array.isArray(job.note_ids) || job.note_ids.length === 0) {
      throw new Error("Export job missing note_ids.");
    }

    const { data, error } = await adminClient
      .from("client_session_notes")
      .select(`
        id,
        session_date,
        start_time,
        end_time,
        service_code,
        goals_addressed,
        narrative,
        therapists:therapist_id (full_name),
        clients:client_id (full_name)
      `)
      .eq("organization_id", job.organization_id)
      .eq("client_id", job.client_id)
      .in("id", job.note_ids);

    if (error) {
      throw new Error(error.message ?? "Failed to load session notes");
    }

    const notes = (data ?? []) as SessionNoteRecord[];
    if (notes.length === 0) {
      throw new Error("No session notes found for export");
    }

    const pdfBytes = await buildPdf(notes, job.client_id);
    const storageBucket = SESSION_NOTE_EXPORT_BUCKET;
    const storagePath = `${job.organization_id}/${job.client_id}/${job.id}.pdf`;

    const upload = await adminClient.storage
      .from(storageBucket)
      .upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upload.error) {
      throw new Error(upload.error.message ?? "Failed to upload generated PDF");
    }

    const { data: updated, error: updateError } = await adminClient
      .from("session_note_pdf_exports")
      .update({
        status: "ready",
        error: null,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        completed_at: nowIso(),
        expires_at: addHoursIso(EXPORT_TTL_HOURS),
      })
      .eq("id", job.id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(updateError.message ?? "Failed to finalize export job");
    }

    const mapped = mapJob(updated as Record<string, unknown>);
    if (!mapped) {
      throw new Error("Export job update returned invalid shape");
    }
    console.info("session-note-pdf-export processing_ready", {
      exportId: mapped.id,
      organizationId: mapped.organization_id,
      storageBucket: mapped.storage_bucket,
      storagePath: mapped.storage_path,
      expiresAt: mapped.expires_at,
    });
    return mapped;
  } catch (error) {
    console.error("session-note-pdf-export processing_failed", {
      exportId: job.id,
      organizationId: job.organization_id,
      message: error instanceof Error ? error.message : String(error),
    });
    await markExportFailed(adminClient, job.id, error);
    throw error;
  }
}

export async function expireReadyExportIfNeeded(
  adminClient: SupabaseClient,
  job: SessionNotePdfExportRow,
): Promise<SessionNotePdfExportRow> {
  if (job.status !== "ready" || !job.expires_at) {
    return job;
  }
  const expiresAtMs = new Date(job.expires_at).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs > Date.now()) {
    return job;
  }

  const { data, error } = await adminClient
    .from("session_note_pdf_exports")
    .update({
      status: "expired",
      error: "Export expired. Please generate a new file.",
    })
    .eq("id", job.id)
    .eq("status", "ready")
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message ?? "Failed to expire export job");
  }

  const mapped = mapJob(data as Record<string, unknown>);
  if (!mapped) {
    throw new Error("Expired export row shape was invalid");
  }
  return mapped;
}
