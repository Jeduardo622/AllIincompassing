import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type AssessmentTemplateFieldMode = "AUTO" | "ASSISTED" | "MANUAL";

export interface AssessmentTemplateVersion {
  id: string | null;
  template_type: "iehp_fba";
  version_key: string;
  source_document_name: string;
  page_count: number;
  source_sha256: string | null;
  status: "draft" | "active" | "retired";
}

export interface AssessmentTemplatePage {
  id?: string | null;
  template_version_id?: string | null;
  page_number: number;
  title: string;
  layout_json: Record<string, unknown>;
}

export interface AssessmentTemplateField {
  id?: string | null;
  template_version_id?: string | null;
  page_number: number;
  section_key: string;
  field_key: string;
  label: string;
  field_type: string;
  mode: AssessmentTemplateFieldMode;
  required: boolean;
  source: string;
  layout_json: Record<string, unknown>;
  repeat_group_key?: string | null;
}

export interface IehpLayoutManifest {
  template_type: "iehp_fba";
  version_key: string;
  source_document_name: string;
  source_sha256: string | null;
  page_count: number;
  table_count: number;
  pages: AssessmentTemplatePage[];
  fields: AssessmentTemplateField[];
}

let cachedIehpLayoutManifest: IehpLayoutManifest | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toLayoutJson = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const normalizePage = (value: unknown): AssessmentTemplatePage | null => {
  if (!isRecord(value)) return null;
  if (typeof value.page_number !== "number" || typeof value.title !== "string") return null;
  return {
    page_number: value.page_number,
    title: value.title,
    layout_json: toLayoutJson(value.layout_json),
  };
};

const normalizeField = (value: unknown): AssessmentTemplateField | null => {
  if (!isRecord(value)) return null;
  const mode = value.mode;
  if (mode !== "AUTO" && mode !== "ASSISTED" && mode !== "MANUAL") return null;
  if (
    typeof value.page_number !== "number" ||
    typeof value.section_key !== "string" ||
    typeof value.field_key !== "string" ||
    typeof value.label !== "string" ||
    typeof value.field_type !== "string" ||
    typeof value.required !== "boolean" ||
    typeof value.source !== "string"
  ) {
    return null;
  }
  return {
    page_number: value.page_number,
    section_key: value.section_key,
    field_key: value.field_key,
    label: value.label,
    field_type: value.field_type,
    mode,
    required: value.required,
    source: value.source,
    layout_json: toLayoutJson(value.layout_json),
    repeat_group_key: typeof value.repeat_group_key === "string" ? value.repeat_group_key : null,
  };
};

export const loadIehpLayoutManifest = async (): Promise<IehpLayoutManifest> => {
  if (cachedIehpLayoutManifest) {
    return cachedIehpLayoutManifest;
  }

  const manifestPath = resolve(process.cwd(), "docs", "fill_docs", "iehp_fba_layout_manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const pages = Array.isArray(parsed.pages) ? parsed.pages.map(normalizePage).filter(Boolean) : [];
  const fields = Array.isArray(parsed.fields) ? parsed.fields.map(normalizeField).filter(Boolean) : [];

  if (
    parsed.template_type !== "iehp_fba" ||
    typeof parsed.version_key !== "string" ||
    typeof parsed.source_document_name !== "string" ||
    typeof parsed.page_count !== "number" ||
    typeof parsed.table_count !== "number" ||
    pages.length !== parsed.page_count ||
    fields.length === 0
  ) {
    throw new Error("IEHP FBA layout manifest is missing required metadata.");
  }

  cachedIehpLayoutManifest = {
    template_type: "iehp_fba",
    version_key: parsed.version_key,
    source_document_name: parsed.source_document_name,
    source_sha256: typeof parsed.source_sha256 === "string" ? parsed.source_sha256 : null,
    page_count: parsed.page_count,
    table_count: parsed.table_count,
    pages,
    fields,
  };
  return cachedIehpLayoutManifest;
};

