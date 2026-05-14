export const ASSESSMENT_PLAN_PDF_BUCKET_ID = "client-documents";

interface AssessmentPlanPdfOutputTarget {
  bucketId: string;
  objectPath: string;
  clientId: string;
  assessmentDocumentId: string;
}

export const isAllowedAssessmentPlanPdfOutputTarget = ({
  bucketId,
  objectPath,
  clientId,
  assessmentDocumentId,
}: AssessmentPlanPdfOutputTarget): boolean => {
  if (bucketId !== ASSESSMENT_PLAN_PDF_BUCKET_ID) return false;

  const prefix = `clients/${clientId}/assessments/generated-caloptima-plan-${assessmentDocumentId}-`;
  if (!objectPath.startsWith(prefix) || !objectPath.endsWith(".pdf")) return false;

  const generatedSuffix = objectPath.slice(prefix.length, -".pdf".length);
  return /^\d{8,}$/.test(generatedSuffix);
};
