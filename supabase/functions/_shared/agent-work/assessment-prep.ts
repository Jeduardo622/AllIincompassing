import { createHash } from "node:crypto";
import type {
  WorkExecutionMode,
  WorkItemStatus,
  WorkStepStatus,
} from "./contracts.ts";

export const ASSESSMENT_PREP_BLOCKER_CODES = [
  "scope_wrong_organization",
  "scope_wrong_client",
  "document_missing_or_invalid",
  "template_type_mismatch",
  "extraction_failed",
  "document_state_out_of_contract",
  "review_read_model_unavailable",
  "missing_required_evidence",
  "invalid_required_evidence",
  "missing_owner",
  "owner_not_authorized",
  "authorization_unavailable",
] as const;

export type AssessmentPrepBlockerCode =
  (typeof ASSESSMENT_PREP_BLOCKER_CODES)[number];

export const ASSESSMENT_PREP_PARITY_KINDS = [
  "missing_required_evidence_count_mismatch",
] as const;

export type AssessmentPrepParityKind =
  (typeof ASSESSMENT_PREP_PARITY_KINDS)[number];

export const ASSESSMENT_PREP_STEP_KEYS = [
  "validate_scope",
  "observe_upload",
  "await_extraction",
  "validate_review_evidence",
  "build_review_readiness",
  "assign_clinical_owner",
  "request_clinical_review",
] as const;

export type AssessmentPrepStepKey = (typeof ASSESSMENT_PREP_STEP_KEYS)[number];

export type AgentEvidenceSourceKind =
  | "assessment_document"
  | "assessment_checklist_item"
  | "assessment_structured_section"
  | "assessment_review_event"
  | "assessment_template_layout";

export interface AssessmentPrepEvidencePointer {
  sourceKind: AgentEvidenceSourceKind;
  sourceId: string;
  locator?: string;
  sha256: string;
}

export interface AssessmentPrepMissingEvidencePointer
  extends AssessmentPrepEvidencePointer {
  sourceKind: "assessment_checklist_item" | "assessment_structured_section";
}

export interface AssessmentPrepAuthoritativeSnapshot {
  organizationId: string;
  clientId: string;
  assessmentDocumentId: string;
  templateType: string | null;
  documentState:
    | "missing"
    | "uploaded"
    | "extracting"
    | "extraction_running"
    | "extracted"
    | "drafted"
    | "approved"
    | "rejected"
    | "extraction_failed";
  scopeVerdict:
    | "in_scope"
    | "wrong_client"
    | "wrong_organization"
    | "missing_or_invalid";
  reviewReadModel: {
    loaded: boolean;
    unresolvedRequiredCount: number;
    missingRequiredEvidence: AssessmentPrepMissingEvidencePointer[];
    evidence: AssessmentPrepEvidencePointer[];
  };
  ownerAuthorization: {
    ownerId: string | null;
    authorized: boolean;
    reasonCode:
      | "missing_owner"
      | "owner_not_authorized"
      | "authorization_unavailable"
      | null;
  };
}

export interface AssessmentPrepProjection {
  organizationId: string;
  clientId: string;
  assessmentDocumentId: string;
  templateType: "iehp_fba";
  extractionState: "pending" | "complete" | "failed";
  blockerCodes: AssessmentPrepBlockerCode[];
  evidence: AssessmentPrepEvidencePointer[];
  readinessHash: string;
}

export interface AssessmentPrepWorkflowStep {
  readonly stepKey: AssessmentPrepStepKey;
  readonly executionMode: WorkExecutionMode;
  readonly risk: "clinical";
  readonly dependencies: readonly AssessmentPrepStepKey[];
  readonly completionPredicate: string;
}

export interface AssessmentPrepWorkflowDefinition {
  readonly workflow: "assessment.iehp.prepare_for_clinical_review@1";
  readonly workflowKey: "assessment.iehp.prepare_for_clinical_review";
  readonly version: 1;
  readonly steps: readonly AssessmentPrepWorkflowStep[];
}

export interface AssessmentPrepStepTransition {
  stepKey: AssessmentPrepStepKey;
  dependencies: AssessmentPrepStepKey[];
  executionMode: WorkExecutionMode;
  risk: "clinical";
  targetStatus: WorkStepStatus;
  reasonCode: AssessmentPrepBlockerCode | null;
  completionSatisfied: boolean;
}

export interface AssessmentPrepParityDescriptor {
  kind: AssessmentPrepParityKind;
  reasonCode: "parity_mismatch";
  metadata: {
    expectedCount: number;
    actualCount: number;
  };
}

export interface AssessmentPrepParityEvent {
  eventType: "assessment.iehp.prepare_for_clinical_review.parity_detected";
  metadata: Record<string, string | number>;
}

export interface AssessmentPrepShadowResult {
  workflow: AssessmentPrepWorkflowDefinition;
  projection: AssessmentPrepProjection;
  missingRequiredEvidence: AssessmentPrepMissingEvidencePointer[];
  stepTransitions: AssessmentPrepStepTransition[];
  workItemStatus: WorkItemStatus;
  parity: {
    descriptors: AssessmentPrepParityDescriptor[];
    events: AssessmentPrepParityEvent[];
  };
  generatedClinicalContent: false;
}

function freezeWorkflowStep(
  step: AssessmentPrepWorkflowStep,
): AssessmentPrepWorkflowStep {
  Object.freeze(step.dependencies);
  return Object.freeze(step);
}

const ASSESSMENT_PREP_WORKFLOW_STEPS = Object.freeze([
  freezeWorkflowStep({
    stepKey: "validate_scope",
    executionMode: "deterministic",
    risk: "clinical",
    dependencies: [],
    completionPredicate:
      "scope verdict is in_scope and template type is iehp_fba",
  }),
  freezeWorkflowStep({
    stepKey: "observe_upload",
    executionMode: "deterministic",
    risk: "clinical",
    dependencies: ["validate_scope"],
    completionPredicate:
      "authoritative assessment document is present for the same scope",
  }),
  freezeWorkflowStep({
    stepKey: "await_extraction",
    executionMode: "deterministic",
    risk: "clinical",
    dependencies: ["observe_upload"],
    completionPredicate:
      "document state is exactly extracted and not extraction_failed",
  }),
  freezeWorkflowStep({
    stepKey: "validate_review_evidence",
    executionMode: "deterministic",
    risk: "clinical",
    dependencies: ["await_extraction"],
    completionPredicate:
      "review read model loaded and unresolved required evidence is explicitly enumerated",
  }),
  freezeWorkflowStep({
    stepKey: "build_review_readiness",
    executionMode: "deterministic",
    risk: "clinical",
    dependencies: ["validate_review_evidence"],
    completionPredicate:
      "phi-free readiness projection and readiness hash are computed from authoritative evidence pointers",
  }),
  freezeWorkflowStep({
    stepKey: "assign_clinical_owner",
    executionMode: "human",
    risk: "clinical",
    dependencies: ["build_review_readiness"],
    completionPredicate:
      "owner identifier is valid and upstream authorization is true with no reason code",
  }),
  freezeWorkflowStep({
    stepKey: "request_clinical_review",
    executionMode: "human",
    risk: "clinical",
    dependencies: ["assign_clinical_owner"],
    completionPredicate:
      "all deterministic prerequisites pass and the work item stops at needs_review",
  }),
]);

export const ASSESSMENT_PREP_WORKFLOW: AssessmentPrepWorkflowDefinition = Object
  .freeze({
    workflow: "assessment.iehp.prepare_for_clinical_review@1",
    workflowKey: "assessment.iehp.prepare_for_clinical_review",
    version: 1,
    steps: ASSESSMENT_PREP_WORKFLOW_STEPS,
  });

const PENDING_DOCUMENT_STATES = new Set<string>([
  "uploaded",
  "extracting",
  "extraction_running",
]);

const RECOGNIZED_DOCUMENT_STATES = new Set<string>([
  "missing",
  ...PENDING_DOCUMENT_STATES,
  "extracted",
  "extraction_failed",
]);

export function deriveAssessmentPrepShadow(
  snapshot: AssessmentPrepAuthoritativeSnapshot,
): AssessmentPrepShadowResult {
  const sanitizedMissingEvidence = sanitizeMissingRequiredEvidence(
    snapshot.reviewReadModel.missingRequiredEvidence,
  );
  const blockerCodes = collectBlockerCodes(snapshot, sanitizedMissingEvidence);
  const parity = collectParity(snapshot, sanitizedMissingEvidence.pointers);
  const evidence = normalizeEvidence([
    ...snapshot.reviewReadModel.evidence,
    ...sanitizedMissingEvidence.pointers,
  ]);
  const extractionState = deriveExtractionState(snapshot.documentState);
  const missingRequiredEvidence = sanitizedMissingEvidence.pointers;
  const projection: AssessmentPrepProjection = {
    organizationId: snapshot.organizationId,
    clientId: snapshot.clientId,
    assessmentDocumentId: snapshot.assessmentDocumentId,
    templateType: "iehp_fba",
    extractionState,
    blockerCodes,
    evidence,
    readinessHash: "",
  };
  projection.readinessHash = createReadinessHash(
    snapshot,
    projection,
    missingRequiredEvidence,
    parity.descriptors,
  );

  const stepTransitions = buildStepTransitions(snapshot, blockerCodes);

  return {
    workflow: ASSESSMENT_PREP_WORKFLOW,
    projection,
    missingRequiredEvidence,
    stepTransitions,
    workItemStatus: deriveShadowWorkItemStatus(stepTransitions),
    parity,
    generatedClinicalContent: false,
  };
}

function collectBlockerCodes(
  snapshot: AssessmentPrepAuthoritativeSnapshot,
  sanitizedMissingEvidence: SanitizedMissingRequiredEvidence,
): AssessmentPrepBlockerCode[] {
  const blockers: AssessmentPrepBlockerCode[] = [];
  const ownerBlocker = collectOwnerBlocker(snapshot);

  switch (snapshot.scopeVerdict) {
    case "wrong_organization":
      blockers.push("scope_wrong_organization");
      break;
    case "wrong_client":
      blockers.push("scope_wrong_client");
      break;
    case "missing_or_invalid":
      blockers.push("document_missing_or_invalid");
      break;
    case "in_scope":
      break;
  }

  if (
    snapshot.scopeVerdict === "in_scope" &&
    snapshot.templateType !== "iehp_fba"
  ) {
    blockers.push("template_type_mismatch");
  }

  if (
    snapshot.scopeVerdict === "in_scope" && snapshot.documentState === "missing"
  ) {
    blockers.push("document_missing_or_invalid");
  }

  if (snapshot.documentState === "extraction_failed") {
    blockers.push("extraction_failed");
  }

  if (
    snapshot.documentState === "extracted" &&
    !snapshot.reviewReadModel.loaded
  ) {
    blockers.push("review_read_model_unavailable");
  }

  if (
    snapshot.documentState === "extracted" &&
    snapshot.reviewReadModel.loaded &&
    sanitizedMissingEvidence.rejected
  ) {
    blockers.push("invalid_required_evidence");
  }

  if (
    snapshot.documentState === "extracted" &&
    snapshot.reviewReadModel.loaded &&
    (
      snapshot.reviewReadModel.unresolvedRequiredCount > 0 ||
      sanitizedMissingEvidence.pointers.length > 0 ||
      !hasRequiredReadinessEvidence(snapshot)
    )
  ) {
    blockers.push("missing_required_evidence");
  }

  if (
    snapshot.documentState === "extracted" &&
    snapshot.reviewReadModel.loaded &&
    ownerBlocker
  ) {
    blockers.push(ownerBlocker);
  }

  if (!RECOGNIZED_DOCUMENT_STATES.has(snapshot.documentState)) {
    blockers.push("document_state_out_of_contract");
  }

  return dedupeBlockers(blockers);
}

function collectParity(
  snapshot: AssessmentPrepAuthoritativeSnapshot,
  missingRequiredEvidence: readonly AssessmentPrepMissingEvidencePointer[],
): {
  descriptors: AssessmentPrepParityDescriptor[];
  events: AssessmentPrepParityEvent[];
} {
  const descriptors: AssessmentPrepParityDescriptor[] = [];

  if (
    snapshot.reviewReadModel.unresolvedRequiredCount !==
      missingRequiredEvidence.length
  ) {
    descriptors.push({
      kind: "missing_required_evidence_count_mismatch",
      reasonCode: "parity_mismatch",
      metadata: {
        expectedCount: snapshot.reviewReadModel.unresolvedRequiredCount,
        actualCount: missingRequiredEvidence.length,
      },
    });
  }

  return {
    descriptors,
    events: descriptors.map((descriptor) => ({
      eventType: "assessment.iehp.prepare_for_clinical_review.parity_detected",
      metadata: {
        workflow_key: ASSESSMENT_PREP_WORKFLOW.workflowKey,
        workflow_version: ASSESSMENT_PREP_WORKFLOW.version,
        assessment_document_id: snapshot.assessmentDocumentId,
        reason_code: descriptor.kind,
        expected_count: descriptor.metadata.expectedCount,
        actual_count: descriptor.metadata.actualCount,
      },
    })),
  };
}

function buildStepTransitions(
  snapshot: AssessmentPrepAuthoritativeSnapshot,
  blockerCodes: AssessmentPrepBlockerCode[],
): AssessmentPrepStepTransition[] {
  const transitions: AssessmentPrepStepTransition[] = [];
  const scopeReason = findFirst(blockerCodes, [
    "scope_wrong_organization",
    "scope_wrong_client",
    "document_missing_or_invalid",
    "template_type_mismatch",
  ]);
  const ownerReason = findFirst(blockerCodes, [
    "missing_owner",
    "owner_not_authorized",
    "authorization_unavailable",
  ]);
  const hasMissingRequiredEvidence = blockerCodes.includes(
    "missing_required_evidence",
  );
  const hasInvalidRequiredEvidence = blockerCodes.includes(
    "invalid_required_evidence",
  );

  transitions.push(buildTransition("validate_scope", "completed", null, true));
  if (scopeReason) {
    transitions[0] = buildTransition(
      "validate_scope",
      "failed",
      scopeReason,
      false,
    );
    return completeWithPending(transitions, "validate_scope");
  }

  transitions.push(buildTransition("observe_upload", "completed", null, true));
  if (snapshot.documentState === "missing") {
    transitions[1] = buildTransition(
      "observe_upload",
      "failed",
      "document_missing_or_invalid",
      false,
    );
    return completeWithPending(transitions, "observe_upload");
  }

  if (
    snapshot.documentState === "uploaded" ||
    snapshot.documentState === "extracting" ||
    snapshot.documentState === "extraction_running"
  ) {
    transitions.push(
      buildTransition("await_extraction", "waiting", null, false),
    );
    return completeWithPending(transitions, "await_extraction");
  }

  if (snapshot.documentState === "extraction_failed") {
    transitions.push(
      buildTransition("await_extraction", "failed", "extraction_failed", false),
    );
    return completeWithPending(transitions, "await_extraction");
  }

  if (snapshot.documentState !== "extracted") {
    transitions.push(
      buildTransition(
        "await_extraction",
        "failed",
        "document_state_out_of_contract",
        false,
      ),
    );
    return completeWithPending(transitions, "await_extraction");
  }

  transitions.push(
    buildTransition("await_extraction", "completed", null, true),
  );

  if (!snapshot.reviewReadModel.loaded) {
    transitions.push(
      buildTransition(
        "validate_review_evidence",
        "failed",
        "review_read_model_unavailable",
        false,
      ),
    );
    return completeWithPending(transitions, "validate_review_evidence");
  }

  if (hasInvalidRequiredEvidence) {
    transitions.push(
      buildTransition(
        "validate_review_evidence",
        "failed",
        "invalid_required_evidence",
        false,
      ),
    );
    return completeWithPending(transitions, "validate_review_evidence");
  }

  transitions.push(
    buildTransition("validate_review_evidence", "completed", null, true),
  );
  transitions.push(
    buildTransition("build_review_readiness", "completed", null, true),
  );

  if (ownerReason) {
    transitions.push(
      buildTransition("assign_clinical_owner", "failed", ownerReason, false),
    );
    return completeWithPending(transitions, "assign_clinical_owner");
  }

  transitions.push(
    buildTransition("assign_clinical_owner", "completed", null, true),
  );

  if (hasMissingRequiredEvidence) {
    transitions.push(
      buildTransition(
        "request_clinical_review",
        "failed",
        "missing_required_evidence",
        false,
      ),
    );
    return transitions;
  }

  transitions.push(
    buildTransition("request_clinical_review", "completed", null, true),
  );

  return transitions;
}

function buildTransition(
  stepKey: AssessmentPrepStepKey,
  targetStatus: WorkStepStatus,
  reasonCode: AssessmentPrepBlockerCode | null,
  completionSatisfied: boolean,
): AssessmentPrepStepTransition {
  const workflowStep = ASSESSMENT_PREP_WORKFLOW.steps.find((step) =>
    step.stepKey === stepKey
  );
  if (!workflowStep) {
    throw new Error(`Unknown workflow step: ${stepKey}`);
  }

  return {
    stepKey,
    dependencies: [...workflowStep.dependencies],
    executionMode: workflowStep.executionMode,
    risk: workflowStep.risk,
    targetStatus,
    reasonCode,
    completionSatisfied,
  };
}

function completeWithPending(
  completed: AssessmentPrepStepTransition[],
  stopAfter: AssessmentPrepStepKey,
): AssessmentPrepStepTransition[] {
  const stepIndex = ASSESSMENT_PREP_STEP_KEYS.indexOf(stopAfter);

  for (const stepKey of ASSESSMENT_PREP_STEP_KEYS.slice(stepIndex + 1)) {
    completed.push(buildTransition(stepKey, "pending", null, false));
  }

  return completed;
}

function deriveShadowWorkItemStatus(
  stepTransitions: AssessmentPrepStepTransition[],
): WorkItemStatus {
  if (stepTransitions.every((step) => step.targetStatus === "completed")) {
    return "needs_review";
  }
  if (stepTransitions.some((step) => step.targetStatus === "waiting")) {
    return "waiting";
  }
  if (stepTransitions.some((step) => step.targetStatus === "failed")) {
    return "blocked";
  }
  return "queued";
}

function deriveExtractionState(
  documentState: AssessmentPrepAuthoritativeSnapshot["documentState"],
): AssessmentPrepProjection["extractionState"] {
  if (documentState === "extraction_failed") {
    return "failed";
  }

  if (documentState === "extracted") {
    return "complete";
  }

  return PENDING_DOCUMENT_STATES.has(documentState) ? "pending" : "failed";
}

function dedupeBlockers(
  blockerCodes: AssessmentPrepBlockerCode[],
): AssessmentPrepBlockerCode[] {
  return [...new Set(blockerCodes)];
}

function normalizeEvidence(
  evidence: readonly AssessmentPrepMissingEvidencePointer[],
): AssessmentPrepMissingEvidencePointer[];
function normalizeEvidence(
  evidence: readonly AssessmentPrepEvidencePointer[],
): AssessmentPrepEvidencePointer[];
function normalizeEvidence(
  evidence: readonly AssessmentPrepEvidencePointer[],
): AssessmentPrepEvidencePointer[] {
  const deduped = new Map<string, AssessmentPrepEvidencePointer>();

  for (const entry of evidence) {
    const key = `${entry.sourceKind}:${entry.sourceId}:${
      entry.locator ?? ""
    }:${entry.sha256}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        sourceKind: entry.sourceKind,
        sourceId: entry.sourceId,
        ...(entry.locator ? { locator: entry.locator } : {}),
        sha256: entry.sha256,
      });
    }
  }

  return [...deduped.values()].sort((left, right) =>
    compareStrings(
      `${left.sourceKind}|${left.sourceId}|${
        left.locator ?? ""
      }|${left.sha256}`,
      `${right.sourceKind}|${right.sourceId}|${
        right.locator ?? ""
      }|${right.sha256}`,
    )
  );
}

interface SanitizedMissingRequiredEvidence {
  pointers: AssessmentPrepMissingEvidencePointer[];
  rejected: boolean;
}

function sanitizeMissingRequiredEvidence(
  value: unknown,
): SanitizedMissingRequiredEvidence {
  if (!Array.isArray(value)) {
    return { pointers: [], rejected: true };
  }

  const pointers: AssessmentPrepMissingEvidencePointer[] = [];
  let rejected = false;

  for (const candidate of value) {
    if (!isValidMissingRequiredEvidencePointer(candidate)) {
      rejected = true;
      continue;
    }

    pointers.push({
      sourceKind: candidate.sourceKind,
      sourceId: candidate.sourceId,
      ...(candidate.locator ? { locator: candidate.locator } : {}),
      sha256: candidate.sha256,
    });
  }

  return {
    pointers: normalizeEvidence(pointers),
    rejected,
  };
}

function isValidMissingRequiredEvidencePointer(
  value: unknown,
): value is AssessmentPrepMissingEvidencePointer {
  if (!value || typeof value !== "object") {
    return false;
  }

  const pointer = value as Record<string, unknown>;
  return (
    pointer.sourceKind === "assessment_checklist_item" ||
    pointer.sourceKind === "assessment_structured_section"
  ) && isValidUuid(pointer.sourceId) && isValidSha256(pointer.sha256) &&
    (pointer.locator === undefined || typeof pointer.locator === "string");
}

function hasRequiredReadinessEvidence(
  snapshot: AssessmentPrepAuthoritativeSnapshot,
): boolean {
  const evidence = snapshot.reviewReadModel.evidence;
  const hasDocument = evidence.some((pointer) =>
    pointer.sourceKind === "assessment_document" &&
    pointer.sourceId === snapshot.assessmentDocumentId &&
    isValidEvidencePointer(pointer)
  );
  const hasReadModel = evidence.some((pointer) =>
    pointer.sourceKind === "assessment_template_layout" &&
    isValidEvidencePointer(pointer)
  );

  return evidence.length > 0 && hasDocument && hasReadModel;
}

function isValidEvidencePointer(
  pointer: AssessmentPrepEvidencePointer,
): boolean {
  return isValidUuid(pointer.sourceId) && isValidSha256(pointer.sha256);
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" &&
    value !== "00000000-0000-0000-0000-000000000000" &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
}

function isValidSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function collectOwnerBlocker(
  snapshot: AssessmentPrepAuthoritativeSnapshot,
): AssessmentPrepBlockerCode | null {
  const verdict = snapshot.ownerAuthorization;

  if (!isValidOwnerId(verdict.ownerId)) {
    return "missing_owner";
  }
  if (verdict.reasonCode !== null) {
    return verdict.reasonCode;
  }
  if (!verdict.authorized) {
    return "owner_not_authorized";
  }

  return null;
}

function isValidOwnerId(ownerId: string | null): ownerId is string {
  return isValidUuid(ownerId);
}

function createReadinessHash(
  snapshot: AssessmentPrepAuthoritativeSnapshot,
  projection: Omit<AssessmentPrepProjection, "readinessHash">,
  missingRequiredEvidence: AssessmentPrepEvidencePointer[],
  parity: AssessmentPrepParityDescriptor[],
): string {
  const value = normalizeValue({
    organizationId: snapshot.organizationId,
    clientId: snapshot.clientId,
    assessmentDocumentId: snapshot.assessmentDocumentId,
    templateType: projection.templateType,
    extractionState: projection.extractionState,
    blockerCodes: [...projection.blockerCodes].sort(),
    evidence: projection.evidence,
    missingRequiredEvidence,
    reviewReadModelLoaded: snapshot.reviewReadModel.loaded,
    unresolvedRequiredCount: snapshot.reviewReadModel.unresolvedRequiredCount,
    ownerAuthorization: {
      ownerId: snapshot.ownerAuthorization.ownerId,
      authorized: snapshot.ownerAuthorization.authorized,
      reasonCode: snapshot.ownerAuthorization.reasonCode,
    },
    parity,
  });

  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = normalizeValue(
          (value as Record<string, unknown>)[key],
        );
        return accumulator;
      }, {});
  }

  return value;
}

function findFirst(
  values: readonly AssessmentPrepBlockerCode[],
  candidates: readonly AssessmentPrepBlockerCode[],
): AssessmentPrepBlockerCode | null {
  for (const candidate of candidates) {
    if (values.includes(candidate)) {
      return candidate;
    }
  }

  return null;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
