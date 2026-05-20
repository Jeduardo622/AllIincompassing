import { useMemo, useState } from "react";
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

const formatPayloadPreview = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getFieldInputRows = (fieldType: string): number => {
  if (fieldType === "textarea" || fieldType === "goal_blocks" || fieldType === "recommendation_table") return 5;
  if (fieldType === "repeatable_table" || fieldType === "schedule_table" || fieldType === "checkbox_grid" || fieldType === "table") return 4;
  return 2;
};

export function IehpFbaLayoutReview({
  assessmentDocument,
  organizationId,
}: {
  assessmentDocument: AssessmentDocumentRecord;
  organizationId: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const [activePage, setActivePage] = useState(1);
  const [edits, setEdits] = useState<Record<string, FieldEdit>>({});
  const [structuredEdits, setStructuredEdits] = useState<Record<string, StructuredEdit>>({});

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

  const fieldsByPage = useMemo(() => {
    const map = new Map<number, TemplateField[]>();
    data.fields.forEach((field) => {
      const existing = map.get(field.page_number) ?? [];
      map.set(field.page_number, [...existing, field]);
    });
    return map;
  }, [data.fields]);

  const activePageFields = fieldsByPage.get(activePage) ?? [];
  const activePageMeta = data.pages.find((page) => page.page_number === activePage);

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
    <div className="space-y-4">
      <div className="rounded-md border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100">
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

      <div className="grid gap-4 xl:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="IEHP FBA page navigation" className="max-h-[44rem] space-y-1 overflow-auto rounded-md border border-gray-200 p-2 dark:border-gray-700">
          {data.pages.map((page) => {
            const pageFields = fieldsByPage.get(page.page_number) ?? [];
            const approved = pageFields.filter((field) => checklistByKey.get(field.field_key)?.status === "approved").length;
            return (
              <button
                key={page.page_number}
                type="button"
                onClick={() => setActivePage(page.page_number)}
                className={`w-full rounded px-2 py-2 text-left text-xs ${
                  activePage === page.page_number
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                }`}
              >
                <span className="block font-semibold">Page {page.page_number}</span>
                <span className="block truncate">{page.title}</span>
                <span className="block text-[11px] opacity-80">
                  {approved}/{pageFields.length} approved
                </span>
              </button>
            );
          })}
        </nav>

        <section className="overflow-auto rounded-lg border border-gray-300 bg-gray-100 p-3 dark:border-gray-700 dark:bg-gray-900/60">
          <div className="mx-auto min-h-[58rem] max-w-[52rem] bg-white p-8 text-slate-950 shadow-xl">
            <div className="mb-5 border-b border-slate-300 pb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Inland Empire Health Plan Functional Behavioral Assessment Report
              </p>
              <h4 className="mt-1 text-xl font-bold">
                Page {activePage}: {activePageMeta?.title ?? "IEHP FBA"}
              </h4>
            </div>

            {activePageFields.length === 0 ? (
              <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                This template page is represented for layout parity. No mapped checklist field lands on this page yet.
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
                  const structuredSections = structuredByKey.get(field.field_key) ?? [];
                  const locked = item?.status === "approved";
                  return (
                    <div key={field.field_key} className="rounded-md border border-slate-300 p-3">
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <label htmlFor={`iehp-${field.field_key}`} className="text-sm font-semibold text-slate-900">
                            {field.label}
                          </label>
                          <p className="text-[11px] text-slate-500">
                            {field.field_key} • {field.mode} • {field.field_type} • required: {String(field.required)}
                          </p>
                        </div>
                        <span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                          {item?.status ?? "missing row"}
                        </span>
                      </div>

                      <textarea
                        id={`iehp-${field.field_key}`}
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
                        className="w-full rounded border border-slate-300 bg-white p-2 text-sm text-slate-950 disabled:bg-slate-100"
                        placeholder={field.field_type.includes("table") ? "Enter table rows or structured summary for reviewer confirmation." : "Field value"}
                      />

                      {structuredSections.length > 0 && (
                        <div className="mt-2 space-y-2 rounded bg-slate-50 p-2 text-xs text-slate-700">
                          <p className="font-semibold">Structured extracted sections</p>
                          {structuredSections.map((section) => {
                            const structuredEdit = structuredEdits[section.id] ?? {
                              payloadText: formatPayloadPreview(section.payload),
                              reviewNotes: section.review_notes ?? "",
                              status: section.status,
                            };
                            const structuredLocked = section.status === "approved";
                            return (
                              <div key={section.id} className="rounded border border-slate-200 bg-white p-2">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold">
                                    Section {section.section_index + 1} • {section.status} • required: {String(section.required)}
                                  </span>
                                  {structuredLocked && (
                                    <span className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600">locked after approval</span>
                                  )}
                                </div>
                                <textarea
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
                                  className="w-full rounded border border-slate-300 bg-white p-2 font-mono text-xs text-slate-950 disabled:bg-slate-100"
                                  aria-label={`${field.label} structured section ${section.section_index + 1} payload`}
                                />
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
                                    className="rounded border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-100"
                                    aria-label={`${field.label} structured section ${section.section_index + 1} status`}
                                  >
                                    {STRUCTURED_STATUS_OPTIONS.map((status) => (
                                      <option key={status} value={status}>
                                        {status}
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
                                    className="rounded border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-100"
                                    placeholder="Structured section review notes"
                                    aria-label={`${field.label} structured section ${section.section_index + 1} review notes`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => saveStructuredSection.mutate(section)}
                                    disabled={saveStructuredSection.isLoading || structuredLocked}
                                    className="rounded bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                                  >
                                    Save section
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
                          className="rounded border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-100"
                          aria-label={`${field.label} review status`}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {status}
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
                          className="rounded border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-100"
                          placeholder="Review notes"
                          aria-label={`${field.label} review notes`}
                        />
                        <button
                          type="button"
                          onClick={() => saveField.mutate(field)}
                          disabled={saveField.isLoading || locked || !item}
                          className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                      {locked && (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Approved IEHP rows stay locked for clinical review integrity.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
