const IEHP_OPTIONAL_FINAL_OUTPUT_KEYS = new Set([
  "IEHP_FBA_ADAPTIVE_MEASURE_SUMMARIES",
  "IEHP_FBA_ASSESSOR_PHONE",
  "IEHP_FBA_REFERRING_PROVIDER",
]);

export const isOptionalIehpFinalOutputKey = (fieldKey: string | null | undefined): boolean =>
  typeof fieldKey === "string" && IEHP_OPTIONAL_FINAL_OUTPUT_KEYS.has(fieldKey);

export const normalizeIehpRequiredFlag = (
  fieldKey: string | null | undefined,
  required: boolean | null | undefined,
): boolean => Boolean(required) && !isOptionalIehpFinalOutputKey(fieldKey);
