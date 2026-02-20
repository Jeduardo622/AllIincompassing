import { callApi } from "./api";

export type AssessmentTemplateType = "caloptima_fba" | "iehp_fba";

export interface RegisterAssessmentDocumentPayload {
  client_id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  bucket_id: string;
  object_path: string;
  template_type?: AssessmentTemplateType;
}

export interface AssessmentDocumentRecord {
  id: string;
  organization_id: string;
  client_id: string;
  template_type: AssessmentTemplateType;
  file_name: string;
  mime_type: string;
  file_size: number;
  bucket_id: string;
  object_path: string;
  status: "uploaded" | "extracting" | "extracted" | "drafted" | "approved" | "rejected" | "extraction_failed";
  extracted_at?: string | null;
  extraction_error?: string | null;
  created_at: string;
}

export async function registerAssessmentDocument(
  payload: RegisterAssessmentDocumentPayload,
): Promise<AssessmentDocumentRecord> {
  const response = await callApi("/api/assessment-documents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error("Failed to register assessment document");
  }
  return (await response.json()) as AssessmentDocumentRecord;
}
