import { WORK_STEP_STATUSES } from "./contracts.ts";

export type SanitizedEventPrimitive = string | number | boolean;
export type SanitizedEventMetadata = Record<string, SanitizedEventPrimitive>;

type MetadataValidator = {
  readonly kind:
    | "uuid"
    | "sha256"
    | "machine"
    | "workflow"
    | "enum"
    | "count"
    | "boolean";
  readonly min?: number;
  readonly max?: number;
  readonly values?: readonly string[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MACHINE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const WORKFLOW_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,95}$/;

const TRANSITION_METADATA_KEYS: Readonly<Record<string, MetadataValidator>> = {
  worker_id: { kind: "machine" },
  attempt_id: { kind: "uuid" },
  result_code: { kind: "machine", max: 63 },
  evidence_hash: { kind: "sha256" },
  duration_ms: { kind: "count", min: 0, max: 86_400_000 },
  retry_count: { kind: "count", min: 0, max: 100 },
};

const STORED_METADATA_KEYS: Readonly<Record<string, MetadataValidator>> = {
  ...TRANSITION_METADATA_KEYS,
  workflow_key: { kind: "workflow" },
  workflow_version: { kind: "count", min: 1, max: 1_000_000 },
  assessment_document_id: { kind: "uuid" },
  lease_seconds: { kind: "count", min: 15, max: 900 },
  attempt_number: { kind: "count", min: 1, max: 1_000_000 },
  approval_id: { kind: "uuid" },
  to_status: { kind: "enum", values: WORK_STEP_STATUSES },
  reason_code: { kind: "machine", max: 63 },
  request_reason_code: { kind: "machine", max: 63 },
  decision: {
    kind: "enum",
    values: ["approve", "approved", "reject", "rejected"],
  },
  clinical_review_handoff: { kind: "boolean" },
  msg_id: { kind: "count", min: 1, max: Number.MAX_SAFE_INTEGER },
  retry_scheduled: { kind: "boolean" },
  poison: { kind: "boolean" },
  delay_seconds: { kind: "count", min: 0, max: 86_400 },
  correlation_id: { kind: "machine" },
};

export class EventMetadataError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EventMetadataError";
    this.code = code;
  }
}

export function sanitizeTransitionEventMetadata(
  value: Record<string, unknown> | null | undefined,
): SanitizedEventMetadata {
  const metadata = validateMetadataObject(
    value ?? {},
    TRANSITION_METADATA_KEYS,
  );
  return { ...metadata };
}

export function validateStoredEventMetadata<T extends Record<string, unknown>>(
  value: T,
): T {
  validateMetadataObject(value, STORED_METADATA_KEYS);
  return value;
}

function validateMetadataObject(
  value: unknown,
  allowedKeys: Readonly<Record<string, MetadataValidator>>,
): SanitizedEventMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EventMetadataError(
      "event_metadata_type_forbidden",
      "Event metadata must be an object.",
    );
  }

  const validated: SanitizedEventMetadata = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const validator = allowedKeys[key];
    if (!validator) {
      throw new EventMetadataError(
        "event_metadata_key_forbidden",
        "Event metadata contains a forbidden key.",
      );
    }

    if (
      typeof rawValue !== "string" && typeof rawValue !== "number" &&
      typeof rawValue !== "boolean"
    ) {
      throw new EventMetadataError(
        "event_metadata_type_forbidden",
        `Event metadata key "${key}" must use a primitive PHI-free value.`,
      );
    }

    validateMetadataValue(key, rawValue, validator);
    validated[key] = rawValue;
  }

  return validated;
}

function validateMetadataValue(
  key: string,
  value: SanitizedEventPrimitive,
  validator: MetadataValidator,
): void {
  switch (validator.kind) {
    case "uuid":
      if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        throw forbiddenValue(key);
      }
      return;
    case "sha256":
      if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
        throw forbiddenValue(key);
      }
      return;
    case "machine":
      if (
        typeof value !== "string" ||
        !MACHINE_TOKEN_PATTERN.test(value) ||
        value.length > (validator.max ?? 128)
      ) {
        throw forbiddenValue(key);
      }
      return;
    case "workflow":
      if (typeof value !== "string" || !WORKFLOW_TOKEN_PATTERN.test(value)) {
        throw forbiddenValue(key);
      }
      return;
    case "enum":
      if (
        typeof value !== "string" ||
        !(validator.values?.includes(value) ?? false)
      ) {
        throw forbiddenValue(key);
      }
      return;
    case "count":
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < (validator.min ?? 0) ||
        value > (validator.max ?? Number.MAX_SAFE_INTEGER)
      ) {
        throw forbiddenValue(key);
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") {
        throw forbiddenValue(key);
      }
      return;
  }
}

function forbiddenValue(key: string): EventMetadataError {
  return new EventMetadataError(
    "event_metadata_value_forbidden",
    `Event metadata key "${key}" received a forbidden value.`,
  );
}
