import { z } from "zod";
import { callApi } from "../../lib/api";
import { parseJsonResponse } from "../../lib/sdk/contracts";
import { toNormalizedApiError, type NormalizedApiError } from "../../lib/sdk/errors";
import type { PayrollScope } from "./api";

const PAYROLL_ADMINISTRATION_ENDPOINT = "/api/payroll-administration";
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "organization_id",
  "organizationId",
  "org_id",
  "orgId",
  "actor_id",
  "actorId",
  "actor_user_id",
  "actorUserId",
]);

const snapshotDateSchema = z.string().date();
const timestampSchema = z.string().min(1);
const idempotencyKeySchema = z.string().min(1);
const externalIdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/);
const payrollCapabilitySchema = z.enum([
  "time.clock_self",
  "time.view_self",
  "time.request_correction_self",
  "time.review_assigned",
  "time.approve_assigned",
  "session_attendance.record_assigned",
  "payroll.configure_employment",
  "payroll.resolve_exceptions",
  "payroll.lock_period",
  "payroll.reopen_period",
  "payroll.export_period",
  "payroll.view_compensation",
]);
const cadenceSchema = z.enum(["weekly", "biweekly", "monthly"]);
const generationCadenceSchema = z.enum(["weekly", "biweekly"]);

const administrationCapabilitiesSchema = z.object({
  canConfigureEmployment: z.boolean(),
  canResolveExceptions: z.boolean(),
  canLockPeriod: z.boolean(),
  canReopenPeriod: z.boolean(),
  canGeneratePeriods: z.boolean(),
  canViewCompensation: z.boolean(),
  canManagePolicyMutations: z.literal(false),
}).strict();

const administrationReadSchema = z.object({
  state: z.literal("ok"),
  selectedLocalDate: snapshotDateSchema,
  capabilities: administrationCapabilitiesSchema,
  orgSettings: z.array(z.object({
    id: z.string().uuid(),
    externalPayrollOrganizationId: externalIdentifierSchema,
    timezone: z.string().min(1),
    workdayStartsAt: z.string().min(1),
    workweekStartsOn: z.number().int(),
    effectiveFrom: snapshotDateSchema,
    effectiveThrough: snapshotDateSchema.nullable(),
  }).strict()),
  policies: z.array(z.object({
    id: z.string().uuid(),
    jurisdiction: z.string().min(1),
    policyName: z.string().min(1),
    activationStatus: z.string().min(1),
    supportsMonthlyNonexempt: z.boolean(),
    effectiveFrom: snapshotDateSchema,
    effectiveThrough: snapshotDateSchema.nullable(),
    mutationsReadOnlyInV1: z.literal(true),
  }).strict()),
  employments: z.array(z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    employeeNumber: externalIdentifierSchema,
    payrollEmployeeId: externalIdentifierSchema,
    classification: z.string().min(1),
    homeJurisdiction: z.string().min(1),
    timezone: z.string().min(1),
    activeFrom: snapshotDateSchema,
    activeThrough: snapshotDateSchema.nullable(),
    compensation: z.object({
      hourlyRateCents: z.number().int(),
      effectiveFrom: timestampSchema,
      effectiveThrough: timestampSchema.nullable(),
    }).strict().nullable().optional(),
  }).strict()),
  payGroups: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    cadence: cadenceSchema,
    timezone: z.string().min(1),
    effectiveFrom: snapshotDateSchema,
    effectiveThrough: snapshotDateSchema.nullable(),
  }).strict()),
  generationVersions: z.array(z.object({
    id: z.string().uuid(),
    payGroupId: z.string().uuid(),
    cadence: cadenceSchema,
    startsOn: snapshotDateSchema,
    timezone: z.string().min(1),
    effectiveFrom: snapshotDateSchema,
    effectiveThrough: snapshotDateSchema.nullable(),
  }).strict()),
  payPeriods: z.array(z.object({
    id: z.string().uuid(),
    payGroupId: z.string().uuid(),
    startsOn: snapshotDateSchema,
    endsOn: snapshotDateSchema,
    lockedAt: timestampSchema.nullable(),
    exportedAt: timestampSchema.nullable(),
  }).strict()),
  bounds: z.object({
    orgSettings: z.number().int(),
    policies: z.number().int(),
    employments: z.number().int(),
    payGroups: z.number().int(),
    generationVersions: z.number().int(),
    payPeriods: z.number().int(),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (!value.capabilities.canViewCompensation) {
    value.employments.forEach((employment, index) => {
      if (employment.compensation !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["employments", index, "compensation"],
          message: "Compensation requires payroll.view_compensation.",
        });
      }
    });
  }
});

const administrationMutationResponseSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_org_settings"), organizationSettingsId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("supersede_org_settings"), organizationSettingsId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("create_employment"), employmentProfileId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("deactivate_employment"), employmentProfileId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("add_rate_version"), rateVersionId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("create_manager_assignment"), managerAssignmentId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("deactivate_manager_assignment"), managerAssignmentId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("grant_capability"), capabilityGrantId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("revoke_capability"), capabilityGrantId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("create_pay_group"), payGroupId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("deactivate_pay_group"), payGroupId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("create_pay_group_assignment"), payGroupAssignmentId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("deactivate_pay_group_assignment"), payGroupAssignmentId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("set_generation_version"), generationVersionId: z.string().uuid(), payGroupId: z.string().uuid(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ action: z.literal("generate_periods"), payGroupId: z.string().uuid(), generatedCount: z.number().int(), replayed: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict(),
]);

const configurationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_org_settings"), effectiveFrom: snapshotDateSchema, effectiveThrough: snapshotDateSchema.nullable().optional(), externalPayrollOrganizationId: externalIdentifierSchema, timezone: z.string().min(1), workdayStartsAt: z.string().min(1).optional(), workweekStartsOn: z.number().int().min(0).max(6).optional() }).strict(),
  z.object({ action: z.literal("supersede_org_settings"), effectiveFrom: snapshotDateSchema, effectiveThrough: snapshotDateSchema.nullable().optional(), externalPayrollOrganizationId: externalIdentifierSchema, timezone: z.string().min(1), workdayStartsAt: z.string().min(1).optional(), workweekStartsOn: z.number().int().min(0).max(6).optional() }).strict(),
  z.object({ action: z.literal("create_employment"), userId: z.string().uuid(), employeeNumber: externalIdentifierSchema, payrollEmployeeId: externalIdentifierSchema, classification: z.string().min(1).optional(), homeJurisdiction: z.string().min(1).optional(), timezone: z.string().min(1), activeFrom: snapshotDateSchema, activeThrough: snapshotDateSchema.nullable().optional(), therapistId: z.string().uuid().nullable().optional() }).strict(),
  z.object({ action: z.literal("deactivate_employment"), employmentProfileId: z.string().uuid(), effectiveThrough: snapshotDateSchema }).strict(),
  z.object({ action: z.literal("add_rate_version"), employmentProfileId: z.string().uuid(), hourlyRateCents: z.number().int(), effectiveFrom: timestampSchema, effectiveThrough: timestampSchema.nullable().optional() }).strict(),
  z.object({ action: z.literal("create_manager_assignment"), employmentProfileId: z.string().uuid(), managerUserId: z.string().uuid(), effectiveFrom: timestampSchema, effectiveThrough: timestampSchema.nullable().optional() }).strict(),
  z.object({ action: z.literal("deactivate_manager_assignment"), managerAssignmentId: z.string().uuid(), effectiveThrough: timestampSchema }).strict(),
  z.object({ action: z.literal("grant_capability"), userId: z.string().uuid(), capability: payrollCapabilitySchema, effectiveFrom: timestampSchema, effectiveThrough: timestampSchema.nullable().optional() }).strict(),
  z.object({ action: z.literal("revoke_capability"), userId: z.string().uuid(), capability: payrollCapabilitySchema, effectiveThrough: timestampSchema }).strict(),
  z.object({ action: z.literal("create_pay_group"), name: z.string().min(1), cadence: cadenceSchema, timezone: z.string().min(1), effectiveFrom: snapshotDateSchema.optional(), effectiveThrough: snapshotDateSchema.nullable().optional() }).strict(),
  z.object({ action: z.literal("deactivate_pay_group"), payGroupId: z.string().uuid(), effectiveThrough: snapshotDateSchema }).strict(),
  z.object({ action: z.literal("create_pay_group_assignment"), employmentProfileId: z.string().uuid(), payGroupId: z.string().uuid(), effectiveFrom: snapshotDateSchema, effectiveThrough: snapshotDateSchema.nullable().optional() }).strict(),
  z.object({ action: z.literal("deactivate_pay_group_assignment"), payGroupAssignmentId: z.string().uuid(), effectiveThrough: snapshotDateSchema }).strict(),
  z.object({ action: z.literal("set_generation_version"), payGroupId: z.string().uuid(), cadence: generationCadenceSchema, effectiveFrom: snapshotDateSchema, effectiveThrough: snapshotDateSchema.nullable().optional(), startsOn: snapshotDateSchema, timezone: z.string().min(1) }).strict(),
  z.object({ action: z.literal("generate_periods"), payGroupId: z.string().uuid(), from: snapshotDateSchema, to: snapshotDateSchema }).strict(),
]);

export type PayrollAdministrationReadResponse = z.infer<typeof administrationReadSchema>;
export type PayrollAdministrationCapabilities = z.infer<typeof administrationCapabilitiesSchema>;
export type PayrollAdministrationActionInput = z.infer<typeof configurationActionSchema>;
export type PayrollAdministrationMutationResponse = z.infer<typeof administrationMutationResponseSchema>;

const containsForbiddenAuthority = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenAuthority(entry));
  }
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
    FORBIDDEN_AUTHORITY_KEYS.has(key) || containsForbiddenAuthority(nested)
  );
};

const assertNoAuthorityFields = (value: unknown): void => {
  if (containsForbiddenAuthority(value)) {
    throw new Error("Authority fields are not allowed in payroll requests.");
  }
};

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
      error: `Payroll confirmation key mismatch for ${requestedKey}.`,
      data: {
        requestedKey,
        responseHeaderKey: headerKey || null,
        responseBodyKey: bodyKey || null,
      },
    },
    502,
    "Payroll confirmation key mismatch.",
  );
};

export const hasAnyPayrollAdministrationCapability = (
  capabilities: PayrollAdministrationCapabilities,
): boolean =>
  capabilities.canConfigureEmployment
  || capabilities.canResolveExceptions
  || capabilities.canLockPeriod
  || capabilities.canReopenPeriod
  || capabilities.canGeneratePeriods
  || capabilities.canViewCompensation;

export async function fetchPayrollAdministration(
  scope: PayrollScope,
): Promise<PayrollAdministrationReadResponse> {
  const response = await callApi(PAYROLL_ADMINISTRATION_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "get_administration",
      selectedLocalDate: snapshotDateSchema.parse(scope.localDate),
    }),
  });

  if (!response.ok) {
    throw await parseFailure(response, "Failed to fetch payroll administration.");
  }

  const parsed = await parseJsonResponse(response.clone(), administrationReadSchema);
  if (!parsed) {
    throw toNormalizedApiError(
      { code: "invalid_response", error: "Invalid payroll administration response." },
      502,
      "Invalid payroll administration response.",
    );
  }
  return parsed;
}

export async function executePayrollAdministrationAction(input: {
  idempotencyKey: string;
  action: PayrollAdministrationActionInput;
}): Promise<PayrollAdministrationMutationResponse> {
  assertNoAuthorityFields(input.action);
  const action = configurationActionSchema.parse(input.action);
  const requestedKey = idempotencyKeySchema.parse(input.idempotencyKey.trim());
  const response = await callApi(PAYROLL_ADMINISTRATION_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": requestedKey,
    },
    body: JSON.stringify(action),
  });

  if (!response.ok) {
    throw await parseFailure(response, "Payroll administration request failed.");
  }

  const parsed = await parseJsonResponse(response.clone(), administrationMutationResponseSchema);
  if (!parsed) {
    throw toNormalizedApiError(
      { code: "invalid_response", error: "Invalid payroll administration response." },
      502,
      "Invalid payroll administration response.",
    );
  }

  const headerKey = response.headers.get("Idempotency-Key")?.trim() ?? "";
  if (headerKey !== requestedKey || parsed.idempotencyKey !== requestedKey) {
    buildMutationMismatchError(requestedKey, headerKey, parsed.idempotencyKey);
  }

  return parsed;
}

export const isRetryablePayrollAdministrationError = (error: unknown): boolean => {
  const status = typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : null;
  return status !== null && RETRYABLE_STATUSES.has(status);
};
