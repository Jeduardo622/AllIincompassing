import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import {
  createProtectedRoute,
  corsHeaders,
  RouteOptions,
  type UserContext,
} from "../_shared/auth-middleware.ts";
import { createRequestClient } from "../_shared/database.ts";
import { MissingOrgContextError, orgScopedQuery, requireOrg } from "../_shared/org.ts";

interface RequestBody {
  noteIds?: string[];
  clientId?: string;
}

const FONT_SIZE = 11;
const LINE_HEIGHT = 16;
const PAGE_MARGIN = 48;

const wrapText = (text: string, maxWidth: number, font: any, fontSize: number) => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    if (width <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
};

const drawSection = (page: any, title: string, text: string, font: any, boldFont: any, y: number) => {
  page.drawText(title, { x: PAGE_MARGIN, y, size: FONT_SIZE, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
  const lines = wrapText(text, page.getWidth() - PAGE_MARGIN * 2, font, FONT_SIZE);
  let cursorY = y - LINE_HEIGHT;
  lines.forEach((line) => {
    page.drawText(line, { x: PAGE_MARGIN, y: cursorY, size: FONT_SIZE, font, color: rgb(0.2, 0.2, 0.2) });
    cursorY -= LINE_HEIGHT;
  });
  return cursorY - LINE_HEIGHT / 2;
};

export default createProtectedRoute(async (req: Request, userContext: UserContext) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const db = createRequestClient(req);
    const orgId = await requireOrg(db);

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const noteIds = Array.isArray(body.noteIds) ? body.noteIds.filter((id) => typeof id === "string") : [];
    const clientId = typeof body.clientId === "string" ? body.clientId : null;

    if (!clientId || noteIds.length === 0) {
      return new Response(JSON.stringify({ error: "clientId and noteIds are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await orgScopedQuery(db, "client_session_notes", orgId)
      .select(
        `
          id,
          session_date,
          start_time,
          end_time,
          service_code,
          goals_addressed,
          narrative,
          therapists:therapist_id (full_name),
          clients:client_id (full_name)
        `
      )
      .eq("client_id", clientId)
      .in("id", noteIds);

    if (error) {
      return new Response(JSON.stringify({ error: "Failed to load session notes" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const notes = data ?? [];
    if (notes.length === 0) {
      return new Response(JSON.stringify({ error: "No session notes found for export" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      const meta = `${note.session_date} · ${note.start_time} - ${note.end_time} · ${note.therapists?.full_name ?? "Unknown Therapist"}`;
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

    const pdfBytes = await pdfDoc.save();
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="session-notes-${clientId}.pdf"`,
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
