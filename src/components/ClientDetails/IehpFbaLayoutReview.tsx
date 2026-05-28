import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callApi } from "../../lib/api";
import { showError, showSuccess } from "../../lib/toast";
import type { AssessmentDocumentRecord } from "../../lib/assessment-documents";
import { parseApiErrorMessage, parseJson } from "./ProgramsGoalsTab.helpers";

type ReviewStatus = "not_started" | "drafted" | "verified" | "approved";
type StructuredReviewStatus = ReviewStatus | "rejected";

interface TemplatePage {
  page_number: number;
  title: string;
  layout_json?: Record<string, unknown>;
}

interface TemplateField {
  page_number: number;
  section_key: string;
  field_key: string;
  label: string;
  field_type: string;
  mode: "AUTO" | "ASSISTED" | "MANUAL";
  required: boolean;
  source: string;
  layout_json?: Record<string, unknown>;
  repeat_group_key?: string | null;
}

interface ChecklistValue {
  id: string;
  placeholder_key: string;
  section_key: string;
  label: string;
  mode: "AUTO" | "ASSISTED" | "MANUAL";
  required: boolean;
  status: ReviewStatus;
  value_text: string | null;
  value_json?: unknown;
  review_notes: string | null;
}

interface StructuredValue {
  id: string;
  field_key: string;
  section_index: number;
  payload: Record<string, unknown>;
  source_span?: Record<string, unknown> | null;
  status: StructuredReviewStatus;
  required: boolean;
  review_notes: string | null;
}

interface TemplateLayoutResponse {
  template_version: {
    version_key: string;
    source_document_name: string;
    page_count: number;
  };
  pages: TemplatePage[];
  fields: TemplateField[];
  values: {
    checklist_items: ChecklistValue[];
    structured_sections: StructuredValue[];
  };
  unresolved_required_count: number;
  extracted_value_count: number;
}

interface FieldEdit {
  valueText: string;
  reviewNotes: string;
  status: ReviewStatus;
}

interface StructuredEdit {
  payloadText: string;
  reviewNotes: string;
  status: StructuredReviewStatus;
}

interface PageReviewSummary {
  needsAttention: number;
  inDraft: number;
  approved: number;
  total: number;
}

const EMPTY_LAYOUT: TemplateLayoutResponse = {
  template_version: {
    version_key: "",
    source_document_name: "",
    page_count: 0,
  },
  pages: [],
  fields: [],
  values: {
    checklist_items: [],
    structured_sections: [],
  },
  unresolved_required_count: 0,
  extracted_value_count: 0,
};

const STATUS_OPTIONS: ReviewStatus[] = ["not_started", "drafted", "verified", "approved"];
const STRUCTURED_STATUS_OPTIONS: StructuredReviewStatus[] = ["not_started", "drafted", "verified", "approved", "rejected"];
const PAGE_FIELD_KEY_OVERRIDES: Record<string, number> = {
  IEHP_FBA_REASON_FOR_REFERRAL: 1,
};

const formatPayloadPreview = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const behaviorTargetsFromPayload = (payload: Record<string, unknown> | undefined): string[] => {
  const targets = payload?.targets;
  if (!Array.isArray(targets)) return [];
  return targets
    .map((target) => (typeof target === "string" ? target.trim() : ""))
    .filter((target) => target.length > 0);
};

const formatStatusLabel = (status: ReviewStatus | StructuredReviewStatus): string => {
  if (status === "not_started") return "Not started";
  if (status === "drafted") return "In draft";
  if (status === "verified") return "Verified";
  if (status === "approved") return "Approved";
  return "Rejected";
};

const statusChipClass = (status: ReviewStatus | StructuredReviewStatus): string => {
  if (status === "approved") return "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30";
  if (status === "verified") return "bg-sky-500/15 text-sky-300 border border-sky-400/30";
  if (status === "drafted") return "bg-indigo-500/20 text-indigo-200 border border-indigo-400/30";
  if (status === "rejected") return "bg-rose-500/15 text-rose-300 border border-rose-400/30";
  return "bg-slate-500/15 text-slate-300 border border-slate-400/30";
};

const assessmentProcedureRowsFromPayload = (payload: Record<string, unknown> | undefined): Array<{ procedure: string; raw_text: string }> => {
  const rows = payload?.rows;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return { procedure: "", raw_text: "" };
      const procedure = typeof (row as { procedure?: unknown }).procedure === "string" ? (row as { procedure: string }).procedure.trim() : "";
      const rawText = typeof (row as { raw_text?: unknown }).raw_text === "string" ? (row as { raw_text: string }).raw_text.trim() : "";
      return { procedure, raw_text: rawText };
    })
    .filter((row) => row.procedure.length > 0 || row.raw_text.length > 0);
};

const readableNarrativeFromPayload = (payload: Record<string, unknown> | undefined): string => {
  if (!payload || typeof payload !== "object") return "";
  const rawText = payload.raw_text;
  if (typeof rawText === "string" && rawText.trim().length > 0) return rawText.trim();
  return "";
};

const stringifyReadablePayloadValue = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const formatGenericStructuredReadableText = (payload: Record<string, unknown> | undefined): string => {
  if (!payload || typeof payload !== "object") return "No extracted staff-readable content available.";

  const label = stringifyReadablePayloadValue(payload.label);
  const rawText = stringifyReadablePayloadValue(payload.raw_text);
  const clinicalValue = stringifyReadablePayloadValue(payload.clinical_value);
  const enteredValuePresent = payload.entered_value_present;
  const templatePlaceholder = payload.template_placeholder;

  const lines: string[] = [];
  if (label) lines.push(label);
  if (rawText) lines.push(rawText);
  else if (clinicalValue) lines.push(clinicalValue);
  else if (enteredValuePresent === false) lines.push("No extracted field value was found in the source document.");
  else if (templatePlaceholder === true) lines.push("Template field placeholder preserved for staff review.");
  else lines.push("No extracted staff-readable content available.");

  return lines.join("\n");
};

const formatStructuredReadableText = (section: StructuredValue): string => {
  if (section.field_key === "IEHP_FBA_BEHAVIOR_SKILL_TARGETS") {
    const targets = behaviorTargetsFromPayload(section.payload);
    const heading = "Behaviors and Functional Skills to be Addressed";
    if (targets.length === 0) return `${heading}\n- none selected`;
    return `${heading}\n${targets.map((target) => `- ${target}`).join("\n")}`;
  }
  if (section.field_key === "IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE") {
    const rows = assessmentProcedureRowsFromPayload(section.payload);
    const heading = "Assessment Procedures";
    if (rows.length === 0) {
      const narrative = readableNarrativeFromPayload(section.payload);
      if (narrative.length > 0) return `${heading}\n${narrative}`;
      return `${heading}\n- none extracted`;
    }
    return `${heading}\n${rows.map((row) => `- ${row.procedure}: ${row.raw_text || "not provided"}`).join("\n")}`;
  }
  const narrative = readableNarrativeFromPayload(section.payload);
  if (narrative.length > 0) return narrative;
  return formatGenericStructuredReadableText(section.payload);
};

const formatStructuredCopyText = (section: StructuredValue): string => formatStructuredReadableText(section);

const shouldShowNarrativeRenderer = (fieldKey: string): boolean =>
  [
    "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
    "IEHP_FBA_HOUSEHOLD_MEMBERS",
    "IEHP_FBA_SCHOOL_INFORMATION_BLOCK",
    "IEHP_FBA_HEALTH_MEDICAL_SUMMARY",
  ].includes(fieldKey);

const renderStructuredReadablePreview = (section: StructuredValue): JSX.Element => {
  if (section.field_key === "IEHP_FBA_BEHAVIOR_SKILL_TARGETS") {
    const targets = behaviorTargetsFromPayload(section.payload);
    return (
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-200">Selected Behavior Targets</p>
        {targets.length === 0 ? (
          <p className="text-xs text-slate-300">None selected.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-4 text-xs text-slate-100">
            {targets.map((target) => (
              <li key={target}>{target}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (section.field_key === "IEHP_FBA_ASSESSMENT_PROCEDURES_TABLE") {
    const rows = assessmentProcedureRowsFromPayload(section.payload);
    const narrative = readableNarrativeFromPayload(section.payload);
    return (
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-200">Assessment Procedures</p>
        {rows.length === 0 ? (
          <p className="text-xs leading-relaxed text-slate-100 whitespace-pre-wrap">
            {narrative || "No procedure rows extracted."}
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={`${row.procedure}-${index}`} className="rounded border border-slate-600/60 bg-slate-900/50 px-2 py-1">
                <p className="text-xs font-semibold text-slate-100">{row.procedure}</p>
                <p className="text-xs text-slate-300">{row.raw_text || "Not provided"}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (shouldShowNarrativeRenderer(section.field_key)) {
    const narrative = readableNarrativeFromPayload(section.payload);
    return (
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-200">Extracted Narrative</p>
        <p className="text-xs leading-relaxed text-slate-100 whitespace-pre-wrap">{narrative || "No narrative extracted."}</p>
      </div>
    );
  }

  return <p className="text-xs leading-relaxed text-slate-100 whitespace-pre-wrap">{formatStructuredReadableText(section)}</p>;
};

const getFieldInputRows = (fieldType: string): number => {
  if (fieldType === "textarea" || fieldType === "goal_blocks" || fieldType === "recommendation_table") return 5;
  if (fieldType === "repeatable_table" || fieldType === "schedule_table" || fieldType === "checkbox_grid" || fieldType === "table") return 4;
  return 2;
};

const getStructuredSectionPageNumber = (section: StructuredValue): number | null => {
  const pageNumber = section.source_span?.page_number;
  return typeof pageNumber === "number" ? pageNumber : null;
};

const pluralizeExtractedSectionCount = (count: number): string => `${count} extracted section${count === 1 ? "" : "s"}`;

const structuredSectionDisplayTitle = (section: StructuredValue): string => {
  const label = stringifyReadablePayloadValue(section.payload?.label);
  return label || `${section.field_key} section ${section.section_index + 1}`;
};

const emptyPageMessage = (pageNumber: number, title: string | undefined): string => {
  if (pageNumber === 16 || /school goals/i.test(title ?? "")) {
    return "No school-specific goals were extracted for this IEHP document.";
  }
  return "This template page is represented for layout parity. No mapped checklist field lands on this page yet.";
};

const isManualRequiredReviewItem = (field: TemplateField, item: ChecklistValue | undefined): boolean =>
  field.required && field.mode === "MANUAL" && (!item || item.status === "not_started");

const emptyPageReviewSummary = (): PageReviewSummary => ({
  needsAttention: 0,
  inDraft: 0,
  approved: 0,
  total: 0,
});

const isAttentionReviewStatus = (status: ReviewStatus | StructuredReviewStatus | "missing"): boolean =>
  status === "missing" || status === "not_started" || status === "rejected";

const addStatusToPageReviewSummary = (summary: PageReviewSummary, status: ReviewStatus | StructuredReviewStatus | "missing"): void => {
  summary.total += 1;
  if (isAttentionReviewStatus(status)) {
    summary.needsAttention += 1;
    return;
  }
  if (status === "approved") {
    summary.approved += 1;
    return;
  }
  summary.inDraft += 1;
};

export function IehpFbaLayoutReview({
  assessmentDocument,
  organizationId,
}: {
  assessmentDocument: AssessmentDocumentRecord;
  organizationId: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const attentionTargetRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [activePage, setActivePage] = useState(1);
  const [pendingAttentionFocusPage, setPendingAttentionFocusPage] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<string, FieldEdit>>({});
  const [structuredEdits, setStructuredEdits] = useState<Record<string, StructuredEdit>>({});
  const [rawPreviewBySectionId, setRawPreviewBySectionId] = useState<Record<string, boolean>>({});
  const [expandedFieldByKey, setExpandedFieldByKey] = useState<Record<string, boolean>>({});
  const [expandedStructuredSectionById, setExpandedStructuredSectionById] = useState<Record<string, boolean>>({});

  const queryKey = ["assessment-template-layout", assessmentDocument.id, organizationId ?? "MISSING_ORG"] as const;
  const { data = EMPTY_LAYOUT, isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await callApi(
        `/api/assessment-template-layout?assessment_document_id=${encodeURIComponent(assessmentDocument.id)}`,
      );
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to load IEHP template layout"));
      }
      return parseJson<TemplateLayoutResponse>(response);
    },
    enabled: Boolean(assessmentDocument.id && organizationId),
  });

  const checklistByKey = useMemo(() => {
    const map = new Map<string, ChecklistValue>();
    data.values.checklist_items.forEach((item) => map.set(item.placeholder_key, item));
    return map;
  }, [data.values.checklist_items]);

  const structuredByKey = useMemo(() => {
    const map = new Map<string, StructuredValue[]>();
    data.values.structured_sections.forEach((section) => {
      const existing = map.get(section.field_key) ?? [];
      map.set(section.field_key, [...existing, section]);
    });
    return map;
  }, [data.values.structured_sections]);

  const fieldPageByKey = useMemo(() => {
    const map = new Map<string, number>();
    data.fields.forEach((field) => {
      map.set(field.field_key, PAGE_FIELD_KEY_OVERRIDES[field.field_key] ?? field.page_number);
    });
    return map;
  }, [data.fields]);

  const fieldsByPage = useMemo(() => {
    const map = new Map<number, TemplateField[]>();
    data.fields.forEach((field) => {
      const effectivePageNumber = fieldPageByKey.get(field.field_key) ?? field.page_number;
      const existing = map.get(effectivePageNumber) ?? [];
      map.set(effectivePageNumber, [...existing, field]);
    });
    return map;
  }, [data.fields, fieldPageByKey]);

  const activePageFields = fieldsByPage.get(activePage) ?? [];
  const activePageMeta = data.pages.find((page) => page.page_number === activePage);
  const activePageFieldKeys = useMemo(() => new Set(activePageFields.map((field) => field.field_key)), [activePageFields]);
  const activePageLooseStructuredSections = useMemo(
    () =>
      data.values.structured_sections.filter((section) => {
        const pageNumber = getStructuredSectionPageNumber(section);
        return pageNumber === activePage && !activePageFieldKeys.has(section.field_key);
      }),
    [activePage, activePageFieldKeys, data.values.structured_sections],
  );

  const pageReviewSummaries = useMemo(() => {
    const summaries = new Map<number, PageReviewSummary>();
    const ensureSummary = (pageNumber: number) => {
      const existing = summaries.get(pageNumber);
      if (existing) return existing;
      const next = emptyPageReviewSummary();
      summaries.set(pageNumber, next);
      return next;
    };

    data.pages.forEach((page) => ensureSummary(page.page_number));
    data.fields.forEach((field) => {
      const pageNumber = PAGE_FIELD_KEY_OVERRIDES[field.field_key] ?? field.page_number;
      const item = checklistByKey.get(field.field_key);
      const status = isManualRequiredReviewItem(field, item) ? "not_started" : item?.status ?? "missing";
      addStatusToPageReviewSummary(ensureSummary(pageNumber), status);
    });
    data.values.structured_sections.forEach((section) => {
      const pageNumber = getStructuredSectionPageNumber(section) ?? fieldPageByKey.get(section.field_key);
      if (pageNumber === undefined) return;
      addStatusToPageReviewSummary(ensureSummary(pageNumber), section.status);
    });

    return summaries;
  }, [checklistByKey, data.fields, data.pages, data.values.structured_sections, fieldPageByKey]);

  const activePageReviewSummary = pageReviewSummaries.get(activePage) ?? emptyPageReviewSummary();
  const nextNeedsAttentionPage = useMemo(() => {
    if (data.pages.length === 0) return null;
    const pageNumbers = data.pages.map((page) => page.page_number);
    const activeIndex = Math.max(pageNumbers.indexOf(activePage), 0);
    for (let offset = 1; offset <= pageNumbers.length; offset += 1) {
      const pageNumber = pageNumbers[(activeIndex + offset) % pageNumbers.length];
      if ((pageReviewSummaries.get(pageNumber)?.needsAttention ?? 0) > 0) {
        return pageNumber;
      }
    }
    return null;
  }, [activePage, data.pages, pageReviewSummaries]);

  const activePageAttentionTargetKey = useMemo(() => {
    for (const field of activePageFields) {
      const item = checklistByKey.get(field.field_key);
      const fieldStatus = isManualRequiredReviewItem(field, item) ? "not_started" : item?.status ?? "missing";
      const structuredSections = (structuredByKey.get(field.field_key) ?? []).filter((section) => {
        const pageNumber = getStructuredSectionPageNumber(section);
        return pageNumber === null || pageNumber === activePage;
      });
      if (isAttentionReviewStatus(fieldStatus) || structuredSections.some((section) => isAttentionReviewStatus(section.status))) {
        return `field-${field.field_key}`;
      }
    }

    const looseSection = activePageLooseStructuredSections.find((section) => isAttentionReviewStatus(section.status));
    return looseSection ? `structured-${looseSection.id}` : null;
  }, [activePage, activePageFields, activePageLooseStructuredSections, checklistByKey, structuredByKey]);

  useEffect(() => {
    if (data.pages.length === 0 || data.pages.some((page) => page.page_number === activePage)) return;
    setActivePage(data.pages[0].page_number);
  }, [activePage, data.pages]);

  useEffect(() => {
    if (pendingAttentionFocusPage !== activePage || !activePageAttentionTargetKey) return;
    const target = attentionTargetRefs.current[activePageAttentionTargetKey];
    if (!target) return;
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    target.focus({ preventScroll: true });
    setPendingAttentionFocusPage(null);
  }, [activePage, activePageAttentionTargetKey, pendingAttentionFocusPage]);

  const saveField = useMutation({
    mutationFn: async (field: TemplateField) => {
      const item = checklistByKey.get(field.field_key);
      if (!item) {
        throw new Error("No checklist row exists for this IEHP field.");
      }
      const edit = edits[field.field_key] ?? {
        valueText: item.value_text ?? "",
        reviewNotes: item.review_notes ?? "",
        status: item.status,
      };
      const response = await callApi("/api/assessment-checklist", {
        method: "PATCH",
        body: JSON.stringify({
          item_id: item.id,
          status: edit.status,
          review_notes: edit.reviewNotes,
          value_text: edit.valueText,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to save IEHP field"));
      }
      return response.json();
    },
    onSuccess: async (_result, field) => {
      showSuccess(`${field.label} saved.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["assessment-checklist", assessmentDocument.id, organizationId ?? "MISSING_ORG"] }),
      ]);
    },
    onError: (error) => {
      showError(error instanceof Error ? error.message : "Failed to save IEHP field");
    },
  });

  const saveStructuredSection = useMutation({
    mutationFn: async (section: StructuredValue) => {
      const edit = structuredEdits[section.id] ?? {
        payloadText: formatPayloadPreview(section.payload),
        reviewNotes: section.review_notes ?? "",
        status: section.status,
      };
      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(edit.payloadText || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Structured payload must be a JSON object.");
        }
        payload = parsed as Record<string, unknown>;
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "Structured payload must be valid JSON.");
      }
      const response = await callApi("/api/assessment-checklist", {
        method: "PATCH",
        body: JSON.stringify({
          structured_section_id: section.id,
          status: edit.status,
          review_notes: edit.reviewNotes,
          payload,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to save IEHP structured section"));
      }
      return response.json();
    },
    onSuccess: async () => {
      showSuccess("IEHP structured section saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["assessment-checklist", assessmentDocument.id, organizationId ?? "MISSING_ORG"] }),
      ]);
    },
    onError: (error) => {
      showError(error instanceof Error ? error.message : "Failed to save IEHP structured section");
    },
  });

  const setFieldDisposition = useMutation({
    mutationFn: async ({
      field,
      status,
      structuredSections,
    }: {
      field: TemplateField;
      status: ReviewStatus;
      structuredSections: StructuredValue[];
    }) => {
      const item = checklistByKey.get(field.field_key);
      if (!item) {
        throw new Error("No checklist row exists for this IEHP field.");
      }
      const edit = edits[field.field_key] ?? {
        valueText: item.value_text ?? "",
        reviewNotes: item.review_notes ?? "",
        status: item.status,
      };
      const responses = await Promise.all([
        callApi("/api/assessment-checklist", {
          method: "PATCH",
          body: JSON.stringify({
            item_id: item.id,
            status,
            review_notes: edit.reviewNotes,
            value_text: edit.valueText,
          }),
        }),
        ...(status === "approved"
          ? structuredSections
              .filter((section) => section.status !== "approved")
              .map((section) =>
                callApi("/api/assessment-checklist", {
                  method: "PATCH",
                  body: JSON.stringify({
                    structured_section_id: section.id,
                    status: "approved",
                    review_notes: section.review_notes ?? "",
                    payload: section.payload,
                  }),
                }),
              )
          : []),
      ]);
      const failedResponse = responses.find((response) => !response.ok);
      if (failedResponse) {
        throw new Error(await parseApiErrorMessage(failedResponse, "Failed to update IEHP review status"));
      }
      return Promise.all(responses.map((response) => response.json()));
    },
    onSuccess: async (_result, { field, status }) => {
      showSuccess(`${field.label} marked ${formatStatusLabel(status).toLowerCase()}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["assessment-checklist", assessmentDocument.id, organizationId ?? "MISSING_ORG"] }),
      ]);
    },
    onError: (error) => {
      showError(error instanceof Error ? error.message : "Failed to update IEHP review status");
    },
  });

  const setLooseStructuredSectionDisposition = useMutation({
    mutationFn: async ({ section, status }: { section: StructuredValue; status: StructuredReviewStatus }) => {
      const response = await callApi("/api/assessment-checklist", {
        method: "PATCH",
        body: JSON.stringify({
          structured_section_id: section.id,
          status,
          review_notes: section.review_notes ?? "",
          payload: section.payload,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiErrorMessage(response, "Failed to update IEHP structured section"));
      }
      return response.json();
    },
    onSuccess: async () => {
      showSuccess("IEHP structured section updated.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["assessment-checklist", assessmentDocument.id, organizationId ?? "MISSING_ORG"] }),
      ]);
    },
    onError: (error) => {
      showError(error instanceof Error ? error.message : "Failed to update IEHP structured section");
    },
  });

  const copyStructuredSection = async (section: StructuredValue) => {
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard is unavailable in this browser.");
      }
      await navigator.clipboard.writeText(formatStructuredCopyText(section));
      showSuccess("Structured section copied.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to copy structured section");
    }
  };

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading IEHP document-style review...</p>;
  }
  if (isError) {
    return (
      <p className="text-sm text-rose-600 dark:text-rose-300">
        IEHP document-style review failed to load. Use the checklist fallback only after confirming template metadata.
      </p>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-950 p-3 text-slate-100">
      <div className="rounded-md border border-cyan-700/40 bg-cyan-950/40 p-3 text-xs text-cyan-100">
        <p className="font-semibold">IEHP FBA document-style review</p>
        <p>
          Template: {data.template_version.source_document_name || "IEHP FBA"} • Version:{" "}
          {data.template_version.version_key || "local manifest"} • Pages: {data.pages.length}/30
        </p>
        <p>
          Extracted checklist values: {data.extracted_value_count}/{data.values.checklist_items.length} • Unresolved required rows:{" "}
          {data.unresolved_required_count}
        </p>
      </div>

      <div className="rounded-md border border-slate-700 bg-slate-900/80 p-3 text-sm text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Page {activePage} review summary</p>
            <p className="text-xs text-slate-400">{activePageReviewSummary.total} rows on this page. Use this snapshot to find rows that still need staff review.</p>
          </div>
          <button
            type="button"
            aria-label="Jump to next page needing attention"
            onClick={() => {
              if (nextNeedsAttentionPage === null) return;
              setPendingAttentionFocusPage(nextNeedsAttentionPage);
              setActivePage(nextNeedsAttentionPage);
            }}
            disabled={nextNeedsAttentionPage === null}
            className="rounded border border-slate-500 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {nextNeedsAttentionPage === null ? "No fields need attention" : `Jump to page ${nextNeedsAttentionPage} needs attention`}
          </button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded border border-amber-400/30 bg-amber-500/10 px-3 py-2">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-amber-200">Needs attention</span>
            <span className="text-lg font-bold text-amber-100">{activePageReviewSummary.needsAttention}</span>
          </div>
          <div className="rounded border border-indigo-400/30 bg-indigo-500/10 px-3 py-2">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-indigo-200">In draft / review</span>
            <span className="text-lg font-bold text-indigo-100">{activePageReviewSummary.inDraft}</span>
          </div>
          <div className="rounded border border-emerald-400/30 bg-emerald-500/10 px-3 py-2">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-emerald-200">Approved</span>
            <span className="text-lg font-bold text-emerald-100">{activePageReviewSummary.approved}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="IEHP FBA page navigation" className="max-h-[44rem] space-y-1 overflow-auto rounded-md border border-slate-700 bg-slate-900 p-2">
          {data.pages.map((page) => {
            const pageFields = fieldsByPage.get(page.page_number) ?? [];
            const pageStructured = data.values.structured_sections.filter(
              (section) => getStructuredSectionPageNumber(section) === page.page_number,
            );
            const approved = pageFields.filter((field) => checklistByKey.get(field.field_key)?.status === "approved").length;
            const approvedStructured = pageStructured.filter((section) => section.status === "approved").length;
            const totalRows = pageFields.length + pageStructured.length;
            return (
              <button
                key={page.page_number}
                type="button"
                onClick={() => setActivePage(page.page_number)}
                className={`w-full rounded px-2 py-2 text-left text-xs ${
                  activePage === page.page_number
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                }`}
              >
                <span className="block font-semibold">Page {page.page_number}</span>
                <span className="block truncate">{page.title}</span>
                <span className="block text-[11px] opacity-80">
                  {approved + approvedStructured}/{totalRows} approved
                </span>
              </button>
            );
          })}
        </nav>

        <section className="overflow-auto rounded-lg border border-slate-700 bg-slate-900/60 p-3">
          <div className="mx-auto min-h-[58rem] max-w-[52rem] bg-slate-900 p-8 text-slate-100 shadow-xl">
            <div className="mb-5 border-b border-slate-300 pb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Inland Empire Health Plan Functional Behavioral Assessment Report
              </p>
              <h4 className="mt-1 text-xl font-bold">
                Page {activePage}: {activePageMeta?.title ?? "IEHP FBA"}
              </h4>
            </div>

            {activePageFields.length === 0 && activePageLooseStructuredSections.length === 0 ? (
              <div className="rounded border border-dashed border-slate-600 p-4 text-sm text-slate-300">
                {emptyPageMessage(activePage, activePageMeta?.title)}
              </div>
            ) : (
              <div className="space-y-4">
                {activePageFields.map((field) => {
                  const item = checklistByKey.get(field.field_key);
                  const edit = edits[field.field_key] ?? {
                    valueText: item?.value_text ?? formatPayloadPreview(item?.value_json),
                    reviewNotes: item?.review_notes ?? "",
                    status: item?.status ?? "not_started",
                  };
                  const structuredSections = (structuredByKey.get(field.field_key) ?? []).filter((section) => {
                    const pageNumber = getStructuredSectionPageNumber(section);
                    return pageNumber === null || pageNumber === activePage;
                  });
                  const locked = item?.status === "approved";
                  const manualRequired = isManualRequiredReviewItem(field, item);
                  const fieldStatus = manualRequired ? "not_started" : item?.status ?? "missing";
                  const fieldAttentionTargetKey = `field-${field.field_key}`;
                  const fieldNeedsAttention = isAttentionReviewStatus(fieldStatus) || structuredSections.some((section) => isAttentionReviewStatus(section.status));
                  const highlightAttentionTarget = activePageAttentionTargetKey === fieldAttentionTargetKey && fieldNeedsAttention;
                  const expanded = Boolean(expandedFieldByKey[field.field_key]);
                  const fieldValuePreview = edit.valueText.trim();
                  const dispositionDisabled = setFieldDisposition.isLoading || locked || !item;
                  return (
                    <div
                      key={field.field_key}
                      ref={(node) => {
                        attentionTargetRefs.current[fieldAttentionTargetKey] = node;
                      }}
                      tabIndex={-1}
                      data-testid={`review-attention-target-${fieldAttentionTargetKey}`}
                      className={`rounded-md border bg-slate-800/70 p-3 focus:outline-none ${
                        highlightAttentionTarget ? "border-amber-300 ring-2 ring-amber-300/70" : "border-slate-600"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-100">
                            {field.label}
                          </p>
                          {structuredSections.length > 0 && (
                            <p className="mt-1 text-[11px] font-semibold text-slate-300">{pluralizeExtractedSectionCount(structuredSections.length)}</p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {field.required && (
                            <span className="rounded border border-slate-500 px-2 py-1 text-[11px] font-semibold text-slate-300">Required</span>
                          )}
                          <span className={`rounded px-2 py-1 text-[11px] font-semibold ${statusChipClass(manualRequired ? "not_started" : item?.status ?? "not_started")}`}>
                            {manualRequired ? "Manual review required" : formatStatusLabel(item?.status ?? "not_started")}
                          </span>
                        </div>
                      </div>

                      {manualRequired && (
                        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                          This required IEHP field is intentionally manual unless reliable document evidence is present.
                        </p>
                      )}

                      <div className="mt-3 space-y-2 rounded border border-slate-700 bg-slate-900/50 p-2 text-xs text-slate-100">
                        {fieldValuePreview ? (
                          <p className="max-h-24 overflow-hidden whitespace-pre-wrap leading-relaxed">{fieldValuePreview}</p>
                        ) : structuredSections.length === 0 ? (
                          <p className="text-slate-400">No extracted wording is available yet.</p>
                        ) : null}
                        {structuredSections.slice(0, 2).map((section) => (
                          <div key={`preview-${section.id}`} className="rounded border border-slate-700 bg-slate-950/40 px-2 py-2">
                            {renderStructuredReadablePreview(section)}
                          </div>
                        ))}
                        {structuredSections.length > 2 && (
                          <p className="text-[11px] text-slate-400">{structuredSections.length - 2} more extracted sections hidden until expanded.</p>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {!manualRequired && !locked && (
                          <>
                            <button
                              type="button"
                              onClick={() => setFieldDisposition.mutate({ field, status: "approved", structuredSections })}
                              disabled={dispositionDisabled}
                              className="rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                            >
                              Approve {field.label}
                            </button>
                            <button
                              type="button"
                              onClick={() => setFieldDisposition.mutate({ field, status: item?.status ?? "not_started", structuredSections: [] })}
                              disabled={dispositionDisabled}
                              className="rounded border border-amber-400/50 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/10 disabled:opacity-50"
                            >
                              Needs review {field.label}
                            </button>
                          </>
                        )}
                        {manualRequired && (
                          <button
                            type="button"
                            onClick={() => setExpandedFieldByKey((current) => ({ ...current, [field.field_key]: true }))}
                            className="rounded border border-amber-400/50 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/10"
                          >
                            Review {field.label}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedFieldByKey((current) => ({
                              ...current,
                              [field.field_key]: !current[field.field_key],
                            }))
                          }
                          className="rounded border border-slate-500 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700"
                        >
                          {expanded ? `Collapse ${field.label}` : `Expand ${field.label}`}
                        </button>
                      </div>

                      {expanded && (
                        <div className="mt-3 space-y-3">
                          <p className="text-[11px] text-slate-400">
                            {field.field_key} • {field.mode} • {field.field_type} • required: {String(field.required)}
                          </p>
                          <textarea
                            id={`iehp-${field.field_key}`}
                            aria-label={field.label}
                            value={edit.valueText}
                            rows={getFieldInputRows(field.field_type)}
                            disabled={locked || !item}
                            onChange={(event) =>
                              setEdits((current) => ({
                                ...current,
                                [field.field_key]: {
                                  ...edit,
                                  valueText: event.target.value,
                                },
                              }))
                            }
                            className="w-full rounded border border-slate-600 bg-slate-950 p-2 text-sm text-slate-100 disabled:bg-slate-800"
                            placeholder={field.field_type.includes("table") ? "Enter table rows or structured summary for reviewer confirmation." : "Field value"}
                          />

                          {structuredSections.length > 0 && (
                            <div className="mt-2 space-y-2 rounded bg-slate-900/80 p-2 text-xs text-slate-200">
                              <p className="font-semibold">Structured extracted sections</p>
                              {structuredSections.map((section) => {
                                const structuredEdit = structuredEdits[section.id] ?? {
                                  payloadText: formatPayloadPreview(section.payload),
                                  reviewNotes: section.review_notes ?? "",
                                  status: section.status,
                                };
                                const structuredLocked = section.status === "approved";
                                return (
                                  <div key={section.id} className="rounded border border-slate-600 bg-slate-800 p-2">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-semibold text-slate-100">
                                        Section {section.section_index + 1} • required: {String(section.required)}
                                      </span>
                                      <div className="flex items-center gap-2">
                                        <span className={`rounded px-2 py-1 text-[11px] font-semibold ${statusChipClass(section.status)}`}>{formatStatusLabel(section.status)}</span>
                                        <button
                                          type="button"
                                          onClick={() => void copyStructuredSection(section)}
                                          className="rounded border border-slate-500 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                                        >
                                          Copy extracted
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setRawPreviewBySectionId((current) => ({
                                              ...current,
                                              [section.id]: !current[section.id],
                                            }))
                                          }
                                          className="rounded border border-slate-500 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                                        >
                                          {rawPreviewBySectionId[section.id] ? "Hide technical details" : "Show technical details"}
                                        </button>
                                        {structuredLocked && (
                                          <span className="rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-200">locked after approval</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="mb-2 rounded border border-slate-600 bg-slate-900/60 px-2 py-2 text-[11px] text-slate-100">
                                      {renderStructuredReadablePreview(section)}
                                    </div>
                                    {rawPreviewBySectionId[section.id] && (
                                      <div className="mb-2 space-y-2 rounded border border-slate-600 bg-slate-900/80 p-2">
                                        <div>
                                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Technical details</p>
                                          <p className="text-[11px] text-slate-400">Raw JSON is hidden by default so staff can focus on the readable extracted content above.</p>
                                        </div>
                                        <pre
                                          data-testid={`raw-json-${section.id}`}
                                          className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-700 bg-slate-950 p-2 text-[11px] text-slate-300"
                                        >
                                          {formatPayloadPreview(section.payload)}
                                        </pre>
                                        <label className="block text-[11px] font-semibold text-slate-300" htmlFor={`structured-payload-${section.id}`}>
                                          Editable JSON payload
                                        </label>
                                        <textarea
                                          id={`structured-payload-${section.id}`}
                                          value={structuredEdit.payloadText}
                                          rows={4}
                                          disabled={structuredLocked}
                                          onChange={(event) =>
                                            setStructuredEdits((current) => ({
                                              ...current,
                                              [section.id]: {
                                                ...structuredEdit,
                                                payloadText: event.target.value,
                                              },
                                            }))
                                          }
                                          className="w-full rounded border border-slate-600 bg-slate-950 p-2 font-mono text-xs text-slate-100 disabled:bg-slate-800"
                                          aria-label={`${field.label} structured section ${section.section_index + 1} payload`}
                                        />
                                      </div>
                                    )}
                                    <div className="mt-2 grid gap-2 md:grid-cols-[10rem_1fr_auto]">
                                      <select
                                        value={structuredEdit.status}
                                        disabled={structuredLocked}
                                        onChange={(event) =>
                                          setStructuredEdits((current) => ({
                                            ...current,
                                            [section.id]: {
                                              ...structuredEdit,
                                              status: event.target.value as StructuredReviewStatus,
                                            },
                                          }))
                                        }
                                        className="rounded border border-slate-600 bg-slate-950 p-2 text-sm disabled:bg-slate-800"
                                        aria-label={`${field.label} structured section ${section.section_index + 1} status`}
                                      >
                                        {STRUCTURED_STATUS_OPTIONS.map((status) => (
                                          <option key={status} value={status}>
                                            {formatStatusLabel(status)}
                                          </option>
                                        ))}
                                      </select>
                                      <input
                                        value={structuredEdit.reviewNotes}
                                        disabled={structuredLocked}
                                        onChange={(event) =>
                                          setStructuredEdits((current) => ({
                                            ...current,
                                            [section.id]: {
                                              ...structuredEdit,
                                              reviewNotes: event.target.value,
                                            },
                                          }))
                                        }
                                        className="rounded border border-slate-600 bg-slate-950 p-2 text-sm disabled:bg-slate-800"
                                        placeholder="Structured section review notes"
                                        aria-label={`${field.label} structured section ${section.section_index + 1} review notes`}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => saveStructuredSection.mutate(section)}
                                        disabled={saveStructuredSection.isLoading || structuredLocked}
                                        className="rounded bg-indigo-700 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-50"
                                      >
                                        Save extracted section
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          <div className="mt-2 grid gap-2 md:grid-cols-[10rem_1fr_auto]">
                            <select
                              value={edit.status}
                              disabled={locked || !item}
                              onChange={(event) =>
                                setEdits((current) => ({
                                  ...current,
                                  [field.field_key]: {
                                    ...edit,
                                    status: event.target.value as ReviewStatus,
                                  },
                                }))
                              }
                              className="rounded border border-slate-600 bg-slate-950 p-2 text-sm disabled:bg-slate-800"
                              aria-label={`${field.label} review status`}
                            >
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status} value={status}>
                                  {formatStatusLabel(status)}
                                </option>
                              ))}
                            </select>
                            <input
                              value={edit.reviewNotes}
                              disabled={locked || !item}
                              onChange={(event) =>
                                setEdits((current) => ({
                                  ...current,
                                  [field.field_key]: {
                                    ...edit,
                                    reviewNotes: event.target.value,
                                  },
                                }))
                              }
                              className="rounded border border-slate-600 bg-slate-950 p-2 text-sm disabled:bg-slate-800"
                              placeholder="Review notes"
                              aria-label={`${field.label} review notes`}
                            />
                            <button
                              type="button"
                              onClick={() => saveField.mutate(field)}
                              disabled={saveField.isLoading || locked || !item}
                              className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
                            >
                              Save field
                            </button>
                          </div>
                        </div>
                      )}
                      {locked && <p className="mt-2 text-[11px] text-slate-400">Approved IEHP rows stay locked for clinical review integrity.</p>}
                    </div>
                  );
                })}
                {activePageLooseStructuredSections.length > 0 && (
                  <div className="rounded-md border border-slate-600 bg-slate-800/70 p-3">
                    <div className="mb-2">
                      <p className="text-sm font-semibold text-slate-100">Page-specific structured sections</p>
                      <p className="text-[11px] text-slate-400">
                        Extracted content placed on this IEHP page by document source metadata.
                      </p>
                    </div>
                    <div className="space-y-2 rounded bg-slate-900/80 p-2 text-xs text-slate-200">
                      {activePageLooseStructuredSections.map((section) => {
                        const structuredEdit = structuredEdits[section.id] ?? {
                          payloadText: formatPayloadPreview(section.payload),
                          reviewNotes: section.review_notes ?? "",
                          status: section.status,
                        };
                        const structuredLocked = section.status === "approved";
                        const structuredAttentionTargetKey = `structured-${section.id}`;
                        const highlightAttentionTarget = activePageAttentionTargetKey === structuredAttentionTargetKey && isAttentionReviewStatus(section.status);
                        const expanded = Boolean(expandedStructuredSectionById[section.id]);
                        const sectionTitle = structuredSectionDisplayTitle(section);
                        return (
                          <div
                            key={section.id}
                            ref={(node) => {
                              attentionTargetRefs.current[structuredAttentionTargetKey] = node;
                            }}
                            tabIndex={-1}
                            data-testid={`review-attention-target-${structuredAttentionTargetKey}`}
                            className={`rounded border bg-slate-800 p-2 focus:outline-none ${
                              highlightAttentionTarget ? "border-amber-300 ring-2 ring-amber-300/70" : "border-slate-600"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-slate-100">{sectionTitle}</span>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded px-2 py-1 text-[11px] font-semibold ${statusChipClass(section.status)}`}>{formatStatusLabel(section.status)}</span>
                                {!structuredLocked && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setLooseStructuredSectionDisposition.mutate({ section, status: "approved" })}
                                      disabled={setLooseStructuredSectionDisposition.isLoading}
                                      className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                                    >
                                      Approve {sectionTitle}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setLooseStructuredSectionDisposition.mutate({ section, status: "rejected" })}
                                      disabled={setLooseStructuredSectionDisposition.isLoading}
                                      className="rounded border border-amber-400/50 px-2 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/10 disabled:opacity-50"
                                    >
                                      Needs review {sectionTitle}
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedStructuredSectionById((current) => ({
                                      ...current,
                                      [section.id]: !current[section.id],
                                    }))
                                  }
                                  className="rounded border border-slate-500 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                                >
                                  {expanded ? `Collapse ${sectionTitle}` : `Expand ${sectionTitle}`}
                                </button>
                                {structuredLocked && (
                                  <span className="rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-200">locked after approval</span>
                                )}
                              </div>
                            </div>
                            <div className="mt-2 rounded border border-slate-600 bg-slate-900/60 px-2 py-2 text-[11px] text-slate-100">
                              {renderStructuredReadablePreview(section)}
                            </div>
                            {expanded && (
                              <div className="mt-2 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void copyStructuredSection(section)}
                                    className="rounded border border-slate-500 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                                  >
                                    Copy extracted
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRawPreviewBySectionId((current) => ({
                                        ...current,
                                        [section.id]: !current[section.id],
                                      }))
                                    }
                                    className="rounded border border-slate-500 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                                  >
                                    {rawPreviewBySectionId[section.id] ? "Hide technical details" : "Show technical details"}
                                  </button>
                                </div>
                                {rawPreviewBySectionId[section.id] && (
                                  <div className="space-y-2 rounded border border-slate-600 bg-slate-900/80 p-2">
                                    <div>
                                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Technical details</p>
                                      <p className="text-[11px] text-slate-400">Raw JSON is hidden by default so staff can focus on the readable extracted content above.</p>
                                    </div>
                                    <pre
                                      data-testid={`raw-json-${section.id}`}
                                      className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-700 bg-slate-950 p-2 text-[11px] text-slate-300"
                                    >
                                      {formatPayloadPreview(section.payload)}
                                    </pre>
                                    <label className="block text-[11px] font-semibold text-slate-300" htmlFor={`structured-payload-${section.id}`}>
                                      Editable JSON payload
                                    </label>
                                    <textarea
                                      id={`structured-payload-${section.id}`}
                                      value={structuredEdit.payloadText}
                                      rows={4}
                                      disabled={structuredLocked}
                                      onChange={(event) =>
                                        setStructuredEdits((current) => ({
                                          ...current,
                                          [section.id]: {
                                            ...structuredEdit,
                                            payloadText: event.target.value,
                                          },
                                        }))
                                      }
                                      className="w-full rounded border border-slate-600 bg-slate-950 p-2 font-mono text-xs text-slate-100 disabled:bg-slate-800"
                                      aria-label={`${section.field_key} structured section ${section.section_index + 1} payload`}
                                    />
                                  </div>
                                )}
                                <div className="grid gap-2 md:grid-cols-[10rem_1fr_auto]">
                                  <select
                                    value={structuredEdit.status}
                                    disabled={structuredLocked}
                                    onChange={(event) =>
                                      setStructuredEdits((current) => ({
                                        ...current,
                                        [section.id]: {
                                          ...structuredEdit,
                                          status: event.target.value as StructuredReviewStatus,
                                        },
                                      }))
                                    }
                                    className="rounded border border-slate-600 bg-slate-950 p-2 text-sm disabled:bg-slate-800"
                                    aria-label={`${section.field_key} structured section ${section.section_index + 1} status`}
                                  >
                                    {STRUCTURED_STATUS_OPTIONS.map((status) => (
                                      <option key={status} value={status}>
                                        {formatStatusLabel(status)}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    value={structuredEdit.reviewNotes}
                                    disabled={structuredLocked}
                                    onChange={(event) =>
                                      setStructuredEdits((current) => ({
                                        ...current,
                                        [section.id]: {
                                          ...structuredEdit,
                                          reviewNotes: event.target.value,
                                        },
                                      }))
                                    }
                                    className="rounded border border-slate-600 bg-slate-950 p-2 text-sm disabled:bg-slate-800"
                                    placeholder="Structured section review notes"
                                    aria-label={`${section.field_key} structured section ${section.section_index + 1} review notes`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => saveStructuredSection.mutate(section)}
                                    disabled={saveStructuredSection.isLoading || structuredLocked}
                                    className="rounded bg-indigo-700 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-50"
                                  >
                                    Save extracted section
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
