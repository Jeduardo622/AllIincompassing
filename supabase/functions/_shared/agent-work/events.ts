export type SanitizedEventPrimitive = string | number;
export type SanitizedEventMetadata = Record<string, SanitizedEventPrimitive>;

type MetadataValidator = {
  readonly kind: "uuid" | "sha256" | "machine" | "workflow" | "enum" | "count";
  readonly max?: number;
  readonly values?: readonly string[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MACHINE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const WORKFLOW_TOKEN_PATTERN =
  /^[a-z0-9][a-z0-9._:-]{0,95}(?:@[a-z0-9][a-z0-9._:-]{0,31})?$/;

const ALLOWED_KEYS: Readonly<Record<string, MetadataValidator>> = {
  organization_id: { kind: "uuid" },
  client_id: { kind: "uuid" },
  work_item_id: { kind: "uuid" },
  step_id: { kind: "uuid" },
  attempt_id: { kind: "uuid" },
  actor_id: { kind: "uuid" },
  approval_hash: { kind: "sha256" },
  evidence_hash: { kind: "sha256" },
  workflow: { kind: "workflow" },
  action: { kind: "enum", values: ["claim_step", "transition_step", "record_projection"] },
  tool: { kind: "machine" },
  runtime_mode: { kind: "enum", values: ["disabled", "shadow", "advisory", "active"] },
  status: {
    kind: "enum",
    values: [
      "queued",
      "running",
      "waiting",
      "needs_review",
      "blocked",
      "completed",
      "failed",
      "cancelled",
      "pending",
      "ready",
      "needs_approval",
      "skipped",
    ],
  },
  outcome: {
    kind: "enum",
    values: ["approved", "rejected", "queued", "running", "waiting", "completed", "failed", "cancelled", "blocked"],
  },
  reason_code: { kind: "machine" },
  result_code: { kind: "machine" },
  retry_count: { kind: "count", max: 100 },
  duration_ms: { kind: "count", max: 86_400_000 },
  token_count: { kind: "count", max: 1_000_000 },
  prompt_token_count: { kind: "count", max: 1_000_000 },
  completion_token_count: { kind: "count", max: 1_000_000 },
  item_count: { kind: "count", max: 100_000 },
};

export class EventMetadataError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EventMetadataError";
    this.code = code;
  }
}

export function sanitizeEventMetadata(
  value: Record<string, unknown> | null | undefined,
): SanitizedEventMetadata {
  if (value == null) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new EventMetadataError(
      "event_metadata_type_forbidden",
      "Event metadata must be an object.",
    );
  }

  const sanitized: SanitizedEventMetadata = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const validator = ALLOWED_KEYS[key];
    if (!validator) {
      throw new EventMetadataError(
        "event_metadata_key_forbidden",
        `Event metadata key "${key}" is not allowed.`,
      );
    }

    if (typeof rawValue === "object" || typeof rawValue === "boolean" || rawValue == null) {
      throw new EventMetadataError(
        "event_metadata_type_forbidden",
        `Event metadata key "${key}" must use a primitive PHI-free value.`,
      );
    }

    const primitiveValue = rawValue as SanitizedEventPrimitive;
    validateMetadataValue(key, primitiveValue, validator);
    sanitized[key] = primitiveValue;
  }

  return sanitized;
}

function validateMetadataValue(
  key: string,
  value: SanitizedEventPrimitive,
  validator: MetadataValidator,
): void {
  switch (validator.kind) {
    case "uuid":
      if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        throw forbiddenValue(key, value);
      }
      return;
    case "sha256":
      if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
        throw forbiddenValue(key, value);
      }
      return;
    case "machine":
      if (typeof value !== "string" || !MACHINE_TOKEN_PATTERN.test(value)) {
        throw forbiddenValue(key, value);
      }
      return;
    case "workflow":
      if (typeof value !== "string" || !WORKFLOW_TOKEN_PATTERN.test(value)) {
        throw forbiddenValue(key, value);
      }
      return;
    case "enum":
      if (
        typeof value !== "string" ||
        !(validator.values?.includes(value) ?? false)
      ) {
        throw forbiddenValue(key, value);
      }
      return;
    case "count":
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > (validator.max ?? Number.MAX_SAFE_INTEGER)
      ) {
        throw forbiddenValue(key, value);
      }
      return;
  }
}

function forbiddenValue(key: string, value: SanitizedEventPrimitive): EventMetadataError {
  return new EventMetadataError(
    "event_metadata_value_forbidden",
    `Event metadata key "${key}" received a forbidden value ${JSON.stringify(value)}.`,
  );
}
