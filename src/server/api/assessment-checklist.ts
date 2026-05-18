import { z } from "zod";
import {
  CORS_HEADERS,
  fetchJson,
  getAccessToken,
  getAccessTokenSubject,
  getSupabaseConfig,
  json,
  resolveOrgAndRole,
} from "./shared";

const reviewStatusSchema = z.enum(["not_started", "drafted", "verified", "approved", "rejected"]);

const checklistUpdateSchema = z.object({
  item_id: z.string().uuid().optional(),
  structured_section_id: z.string().uuid().optional(),
  status: reviewStatusSchema.optional(),
  review_notes: z.string().optional(),
  value_text: z.string().optional(),
  value_json: z.record(z.unknown()).or(z.array(z.unknown())).nullable().optional(),
  payload: z.record(z.unknown()).optional(),
}).refine((value) => Boolean(value.item_id) !== Boolean(value.structured_section_id), {
  message: "Exactly one of item_id or structured_section_id is required",
});

const isUuid = (value: string): boolean => z.string().uuid().safeParse(value).success;

interface ChecklistRow {
  id: string;
  assessment_document_id: string;
  organization_id: string;
  client_id: string;
  status: ReviewStatus;
}

type ReviewStatus = z.infer<typeof reviewStatusSchema>;

const statusOrder: Record<Exclude<ReviewStatus, "rejected">, number> = {
  not_started: 0,
  drafted: 1,
  verified: 2,
  approved: 3,
};

const canTransitionStatus = (current: ReviewStatus, next: ReviewStatus): boolean => {
  if (next === "rejected") {
    return current !== "approved";
  }
  if (current === "rejected") {
    return true;
  }
  return statusOrder[next] >= statusOrder[current];
};

export async function assessmentChecklistHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...CORS_HEADERS } });
  }

  const accessToken = getAccessToken(request);
  if (!accessToken) {
    return json({ error: "Missing authorization token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const { organizationId, isTherapist, isAdmin, isSuperAdmin } = await resolveOrgAndRole(accessToken);
  if (!organizationId || (!isTherapist && !isAdmin && !isSuperAdmin)) {
    return json({ error: "Forbidden" }, 403);
  }

  const { supabaseUrl, anonKey } = getSupabaseConfig();
  const headers = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };

  if (request.method === "GET") {
    const url = new URL(request.url);
    const assessmentDocumentId = url.searchParams.get("assessment_document_id");
    if (!assessmentDocumentId) {
      return json({ error: "assessment_document_id is required" }, 400);
    }
    if (!isUuid(assessmentDocumentId)) {
      return json({ error: "assessment_document_id must be a valid UUID" }, 400);
    }

    const [checklistResult, structuredResult] = await Promise.all([
      fetchJson(`${supabaseUrl}/rest/v1/assessment_checklist_items?select=*&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(assessmentDocumentId)}&order=section_key.asc,created_at.asc`, {
        method: "GET",
        headers,
      }),
      fetchJson(`${supabaseUrl}/rest/v1/assessment_structured_sections?select=*&organization_id=eq.${encodeURIComponent(
        organizationId,
      )}&assessment_document_id=eq.${encodeURIComponent(
        assessmentDocumentId,
      )}&order=section_key.asc,field_key.asc,section_index.asc`, {
        method: "GET",
        headers,
      }),
    ]);
    if (!checklistResult.ok) {
      return json({ error: "Failed to load checklist items" }, checklistResult.status || 500);
    }
    if (!structuredResult.ok) {
      return json({ error: "Failed to load structured assessment sections" }, structuredResult.status || 500);
    }
    return json({
      items: checklistResult.data ?? [],
      structured_sections: structuredResult.data ?? [],
    });
  }

  if (request.method === "PATCH") {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = checklistUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      return json({ error: "Invalid request body" }, 400);
    }

    if (parsed.data.structured_section_id) {
      const lookupUrl = `${supabaseUrl}/rest/v1/assessment_structured_sections?select=id,assessment_document_id,organization_id,client_id,status&id=eq.${encodeURIComponent(
        parsed.data.structured_section_id,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`;
      const lookup = await fetchJson<ChecklistRow[]>(lookupUrl, { method: "GET", headers });
      const existing = Array.isArray(lookup.data) ? lookup.data[0] : null;
      if (!lookup.ok || !existing) {
        return json({ error: "Structured section not found in organization scope" }, 404);
      }

      const nextStatus = parsed.data.status;
      if (nextStatus && !canTransitionStatus(existing.status, nextStatus)) {
        return json(
          {
            error:
              existing.status === "approved"
                ? "Approved structured sections cannot be downgraded."
                : `Invalid structured section status transition: ${existing.status} -> ${nextStatus}`,
          },
          400,
        );
      }
      if (existing.status === "approved" && parsed.data.payload !== undefined) {
        return json(
          { error: "Approved structured section payloads are locked. Reject and recreate a reviewed section before changing clinical content." },
          400,
        );
      }

      const actorId = getAccessTokenSubject(accessToken);
      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        reviewed_by: actorId,
        reviewed_at: new Date().toISOString(),
      };
      if (parsed.data.status !== undefined) {
        updatePayload.status = parsed.data.status;
      }
      if (parsed.data.review_notes !== undefined) {
        updatePayload.review_notes = parsed.data.review_notes;
      }
      if (parsed.data.payload !== undefined) {
        updatePayload.payload = parsed.data.payload;
      }

      const updateUrl = `${supabaseUrl}/rest/v1/assessment_structured_sections?id=eq.${encodeURIComponent(
        existing.id,
      )}&organization_id=eq.${encodeURIComponent(organizationId)}`;
      const updateResult = await fetchJson<Array<Record<string, unknown>>>(updateUrl, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResult.ok || !Array.isArray(updateResult.data) || !updateResult.data[0]) {
        return json({ error: "Failed to update structured section" }, updateResult.status || 500);
      }

      await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          assessment_document_id: existing.assessment_document_id,
          organization_id: organizationId,
          client_id: existing.client_id,
          item_type: "structured_section",
          item_id: existing.id,
          action: "structured_section_updated",
          from_status: existing.status,
          to_status: parsed.data.status ?? existing.status,
          notes: parsed.data.review_notes ?? null,
          actor_id: actorId,
        }),
      });

      return json(updateResult.data[0]);
    }

    const lookupUrl = `${supabaseUrl}/rest/v1/assessment_checklist_items?select=id,assessment_document_id,organization_id,client_id,status&id=eq.${encodeURIComponent(
      parsed.data.item_id ?? "",
    )}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`;
    const lookup = await fetchJson<ChecklistRow[]>(lookupUrl, { method: "GET", headers });
    const existing = Array.isArray(lookup.data) ? lookup.data[0] : null;
    if (!lookup.ok || !existing) {
      return json({ error: "Checklist item not found in organization scope" }, 404);
    }

    const nextStatus = parsed.data.status;
    if (nextStatus === "rejected") {
      return json({ error: "Checklist rows do not support rejected status." }, 400);
    }
    if (nextStatus && !canTransitionStatus(existing.status, nextStatus)) {
      return json(
        {
          error:
            existing.status === "approved"
              ? "Approved checklist rows cannot be downgraded. Edit notes or field value without lowering status."
              : `Invalid checklist status transition: ${existing.status} -> ${nextStatus}`,
        },
        400,
      );
    }

    const actorId = getAccessTokenSubject(accessToken);
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      last_reviewed_by: actorId,
      last_reviewed_at: new Date().toISOString(),
    };
    if (parsed.data.status !== undefined) {
      updatePayload.status = parsed.data.status;
    }
    if (parsed.data.review_notes !== undefined) {
      updatePayload.review_notes = parsed.data.review_notes;
    }
    if (parsed.data.value_text !== undefined) {
      updatePayload.value_text = parsed.data.value_text;
    }
    if (parsed.data.value_json !== undefined) {
      updatePayload.value_json = parsed.data.value_json;
    }

    const updateUrl = `${supabaseUrl}/rest/v1/assessment_checklist_items?id=eq.${encodeURIComponent(
      existing.id,
    )}&organization_id=eq.${encodeURIComponent(organizationId)}`;
    const updateResult = await fetchJson<Array<Record<string, unknown>>>(updateUrl, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(updatePayload),
    });

    if (!updateResult.ok || !Array.isArray(updateResult.data) || !updateResult.data[0]) {
      return json({ error: "Failed to update checklist item" }, updateResult.status || 500);
    }

    await fetchJson(`${supabaseUrl}/rest/v1/assessment_review_events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        assessment_document_id: existing.assessment_document_id,
        organization_id: organizationId,
        client_id: existing.client_id,
        item_type: "checklist_item",
        item_id: existing.id,
        action: "checklist_item_updated",
        from_status: existing.status,
        to_status: parsed.data.status ?? existing.status,
        notes: parsed.data.review_notes ?? null,
        actor_id: actorId,
      }),
    });

    return json(updateResult.data[0]);
  }

  return json({ error: "Method not allowed" }, 405);
}
