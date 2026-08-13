import { z } from "zod";
import { callApi } from "../../lib/api";
import { parseJsonResponse } from "../../lib/sdk/contracts";
import { toNormalizedApiError, type NormalizedApiError } from "../../lib/sdk/errors";
const PAYROLL_EXPORT_ENDPOINT = "/api/payroll-export";
const idempotencyKeySchema = z.string().min(1);
const payrollSnapshotHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const exportAdapterVersionSchema = z.literal("provider-neutral-v1");
const exportRunSchema = z.object({
  runId: z.string().uuid(),
  payPeriodId: z.string().uuid(),
  adapterVersion: exportAdapterVersionSchema,
  replayed: z.boolean(),
  createdAt: z.string().min(1),
  exportedAt: z.string().min(1),
  reconciliationStatus: z.literal("reconciled"),
  checksumSha256: payrollSnapshotHashSchema,
  rowCount: z.number().int().nonnegative(),
  totalRegularSeconds: z.number().int().nonnegative(),
  totalOvertimeSeconds: z.number().int().nonnegative(),
  totalDoubleTimeSeconds: z.number().int().nonnegative(),
  totalMealPremiumCents: z.number().int().nonnegative(),
  totalGrossEarningsCents: z.number().int().nonnegative(),
  sourceSnapshotCount: z.number().int().nonnegative(),
  adjustsRunId: z.string().uuid().nullable(),
  idempotencyKey: idempotencyKeySchema,
}).strict();
const createOrReuseExportRequestSchema = z.object({
  payPeriodId: z.string().uuid(),
  adapterVersion: exportAdapterVersionSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export type PayrollExportRun = z.infer<typeof exportRunSchema>;

const parseFailure = async (
  response: Response,
  fallbackMessage: string,
): Promise<NormalizedApiError> => {
  let payload: Record<string, unknown> | null = null;
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    payload = null;
  }
  return toNormalizedApiError(payload, response.status, fallbackMessage);
};

const buildMutationMismatchError = (
  requestedKey: string,
  headerKey: string,
  bodyKey: string,
): never => {
  throw toNormalizedApiError(
    {
      code: "idempotency_mismatch",
      error: `Payroll export confirmation key mismatch for ${requestedKey}.`,
      data: {
        requestedKey,
        responseHeaderKey: headerKey || null,
        responseBodyKey: bodyKey || null,
      },
    },
    502,
    "Payroll export confirmation key mismatch.",
  );
};

const invalidExportResponseError = (message: string) => toNormalizedApiError(
  { code: "invalid_response", error: message },
  502,
  message,
);

const parseDownloadFilename = (contentDisposition: string | null): string | null => {
  if (!contentDisposition) {
    return null;
  }
  const starMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (starMatch?.[1]) {
    return decodeURIComponent(starMatch[1]);
  }
  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }
  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
};

export async function createOrReusePayrollExport(input: {
  idempotencyKey: string;
  payPeriodId: string;
  adapterVersion: "provider-neutral-v1";
}): Promise<PayrollExportRun> {
  const requestedKey = idempotencyKeySchema.parse(input.idempotencyKey.trim());
  const payload = createOrReuseExportRequestSchema.parse({
    payPeriodId: input.payPeriodId,
    adapterVersion: input.adapterVersion,
    idempotencyKey: requestedKey,
  });

  const response = await callApi(PAYROLL_EXPORT_ENDPOINT, {
    method: "POST",
    headers: new Headers({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await parseFailure(response, "Payroll export request failed.");
  }

  const parsed = await parseJsonResponse(response.clone(), exportRunSchema);
  if (!parsed) {
    throw invalidExportResponseError("Invalid payroll export response.");
  }

  const headerKey = response.headers.get("Idempotency-Key")?.trim() ?? "";
  if (headerKey !== requestedKey || parsed.idempotencyKey !== requestedKey) {
    buildMutationMismatchError(requestedKey, headerKey, parsed.idempotencyKey);
  }

  return parsed;
}

export async function downloadPayrollExportCsv(runId: string): Promise<{
  filename: string;
  blob: Blob;
}> {
  const parsedRunId = z.string().uuid().parse(runId);
  const response = await callApi(`${PAYROLL_EXPORT_ENDPOINT}?runId=${encodeURIComponent(parsedRunId)}`, {
    method: "GET",
  });

  if (!response.ok) {
    throw await parseFailure(response, "Payroll export download failed.");
  }

  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("text/csv")) {
    throw invalidExportResponseError("Payroll export download did not return CSV.");
  }

  const filename = parseDownloadFilename(response.headers.get("Content-Disposition"));
  if (!filename) {
    throw invalidExportResponseError("Payroll export download metadata missing.");
  }

  return {
    filename,
    blob: new Blob([await response.text()], { type: contentType }),
  };
}
