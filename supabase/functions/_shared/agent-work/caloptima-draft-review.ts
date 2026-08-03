import { createHash } from "node:crypto";
import type {
  WorkExecutionMode,
  WorkItemStatus,
  WorkStepStatus,
} from "./contracts.ts";
import { deriveWorkItemStatus } from "./state-machine.ts";

export const CALOPTIMA_DRAFT_REVIEW_BLOCKER_CODES = [
  "scope_wrong_organization",
  "scope_wrong_client",
  "scope_missing_or_invalid",
  "template_type_mismatch",
  "required_checklist_not_approved",
  "required_structured_not_approved",
  "approved_goal_section_missing",
  "draft_program_packet_missing",
  "draft_goal_packet_missing",
  "packet_reference_invalid",
  "packet_review_flags_invalid",
  "packet_evidence_missing",
  "missing_owner",
  "owner_not_authorized",
  "authorization_unavailable",
] as const;

export type CalOptimaDraftReviewBlockerCode =
  (typeof CALOPTIMA_DRAFT_REVIEW_BLOCKER_CODES)[number];

export const CALOPTIMA_DRAFT_REVIEW_PARITY_KINDS = [
  "required_checklist_approval_count_mismatch",
  "required_structured_approval_count_mismatch",
  "approved_goal_section_count_mismatch",
] as const;

export type CalOptimaDraftReviewParityKind =
  (typeof CALOPTIMA_DRAFT_REVIEW_PARITY_KINDS)[number];

export const CALOPTIMA_DRAFT_REVIEW_STEP_KEYS = [
  "validate_scope",
  "await_approved_evidence",
  "suggest_draft_packet",
  "snapshot_draft_packet",
  "assign_clinical_owner",
  "request_draft_review",
] as const;

export type CalOptimaDraftReviewStepKey =
  (typeof CALOPTIMA_DRAFT_REVIEW_STEP_KEYS)[number];

export interface ApprovedEvidenceRecord {
  recordId: string;
  sha256: string;
  sectionKind?: "goal";
}

export interface DraftPacketRecord {
  packetRecordId: string;
  sourceRecordId: string;
  evidenceSha256: string;
  reviewFlags: string[];
}

export interface CalOptimaDraftReviewAuthoritativeSnapshot {
  organizationId: string;
  clientId: string;
  actorId: string;
  targetDocumentId: string;
  templateType: string | null;
  scopeVerdict:
    | "in_scope"
    | "wrong_client"
    | "wrong_organization"
    | "missing_or_invalid";
  approvals: {
    requiredChecklist: {
      expectedApprovedCount: number;
      approved: ApprovedEvidenceRecord[];
    };
    requiredStructured: {
      expectedApprovedCount: number;
      approved: ApprovedEvidenceRecord[];
    };
    approvedGoalSections: {
      expectedCount: number;
      approved: ApprovedEvidenceRecord[];
    };
  };
  draftPackets: {
    programRecords: DraftPacketRecord[];
    goalRecords: DraftPacketRecord[];
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

export interface CalOptimaDraftReviewProjection {
  organizationId: string;
  clientId: string;
  targetDocumentId: string;
  templateType: "caloptima_fba";
  blockerCodes: CalOptimaDraftReviewBlockerCode[];
  approvedCounts: {
    requiredChecklist: number;
    requiredStructured: number;
    approvedGoalSections: number;
  };
  packetCounts: {
    programRecords: number;
    goalRecords: number;
  };
  canonicalEvidenceHash: string;
  canonicalPacketHash: string;
  readinessHash: string;
}

export interface CalOptimaDraftReviewModelSuggestion {
  stepKey: "suggest_draft_packet";
  executionMode: "model_suggested";
  authoritative: false;
  allowedTools: readonly [];
  reasonCodes: readonly string[];
}

export interface CalOptimaDraftReviewWorkflowStep {
  readonly stepKey: CalOptimaDraftReviewStepKey;
  readonly executionMode: WorkExecutionMode;
  readonly risk: "clinical";
  readonly dependencies: readonly CalOptimaDraftReviewStepKey[];
  readonly completionPredicate: string;
}

export interface CalOptimaDraftReviewWorkflowDefinition {
  readonly workflow: "assessment.caloptima.prepare_draft_review@1";
  readonly workflowKey: "assessment.caloptima.prepare_draft_review";
  readonly version: 1;
  readonly steps: readonly CalOptimaDraftReviewWorkflowStep[];
}

export interface CalOptimaDraftReviewStepTransition {
  stepKey: CalOptimaDraftReviewStepKey;
  dependencies: CalOptimaDraftReviewStepKey[];
  executionMode: WorkExecutionMode;
  risk: "clinical";
  targetStatus: WorkStepStatus;
  reasonCode: CalOptimaDraftReviewBlockerCode | null;
  completionSatisfied: boolean;
}

export interface CalOptimaDraftReviewParityDescriptor {
  kind: CalOptimaDraftReviewParityKind;
  reasonCode: "parity_mismatch";
  metadata: {
    expectedCount: number;
    actualCount: number;
  };
}

export interface CalOptimaDraftReviewParityEvent {
  eventType: "assessment.caloptima.prepare_draft_review.parity_detected";
  metadata: Record<string, string | number>;
}

export interface CalOptimaDraftReviewEffectDescriptor {
  descriptor: "assessment.caloptima.prepare_draft_review.effect@1";
  organizationId: string;
  actorId: string;
  workflow: "assessment.caloptima.prepare_draft_review@1";
  stepKey: "request_draft_review";
  targetDocumentId: string;
  canonicalPacketHash: string;
  canonicalEvidenceHash: string;
  effectKey: string;
}

export interface CalOptimaDraftReviewResult {
  workflow: CalOptimaDraftReviewWorkflowDefinition;
  projection: CalOptimaDraftReviewProjection;
  stepTransitions: CalOptimaDraftReviewStepTransition[];
  workItemStatus: WorkItemStatus;
  parity: {
    descriptors: CalOptimaDraftReviewParityDescriptor[];
    events: CalOptimaDraftReviewParityEvent[];
  };
  effect: CalOptimaDraftReviewEffectDescriptor;
  modelSuggestion: CalOptimaDraftReviewModelSuggestion;
  generatedClinicalContent: false;
  mutationAuthority: false;
  promotionAuthority: false;
}

function freezeWorkflowStep(
  step: CalOptimaDraftReviewWorkflowStep,
): CalOptimaDraftReviewWorkflowStep {
  Object.freeze(step.dependencies);
  return Object.freeze(step);
}

const CALOPTIMA_DRAFT_REVIEW_WORKFLOW_STEPS = Object.freeze([
  freezeWorkflowStep({
    stepKey: "validate_scope",
    executionMode: "deterministic",
    risk: "clinical",
    dependencies: [],
    completionPredicate:
      "scope verdict is in_scope and template type is caloptima_fba",
  }),
  freezeWorkflowStep({
    stepKey: "await_approved_evidence",
    executionMode: "deterministic",
    risk: "clinical",
    dependencies: ["validate_scope"],
    completionPredicate:
      "all required checklist and structured rows are approved and at least one approved goal section exists",
  }),
  freezeWorkflowStep({
    stepKey: "suggest_draft_packet",
    executionMode: "model_suggested",
    risk: "clinical",
    dependencies: ["await_approved_evidence"],
    completionPredicate:
      "advisory-only guarded model suggestion is captured with no tools and no authority to modify canonical packets",
  }),
  freezeWorkflowStep({
    stepKey: "snapshot_draft_packet",
    executionMode: "deterministic",
    risk: "clinical",
    dependencies: ["suggest_draft_packet"],
    completionPredicate:
      "nonempty program and goal draft packets are present and every packet record is evidence-linked with bounded review flags",
  }),
  freezeWorkflowStep({
    stepKey: "assign_clinical_owner",
    executionMode: "human",
    risk: "clinical",
    dependencies: ["snapshot_draft_packet"],
    completionPredicate:
      "current owner authorization is valid for the exact organization and document scope",
  }),
  freezeWorkflowStep({
    stepKey: "request_draft_review",
    executionMode: "human",
    risk: "clinical",
    dependencies: ["assign_clinical_owner"],
    completionPredicate:
      "pure readiness projection is frozen and the work item stops at needs_review",
  }),
]);

export const CALOPTIMA_DRAFT_REVIEW_WORKFLOW:
  CalOptimaDraftReviewWorkflowDefinition = Object.freeze({
    workflow: "assessment.caloptima.prepare_draft_review@1",
    workflowKey: "assessment.caloptima.prepare_draft_review",
    version: 1,
    steps: CALOPTIMA_DRAFT_REVIEW_WORKFLOW_STEPS,
  });

const EMPTY_ALLOWED_TOOLS = Object.freeze([]) as [];
const EMPTY_REASON_CODES = Object.freeze([]) as readonly string[];

const ALLOWED_REVIEW_FLAGS = new Set([
  "missing_baseline",
  "weak_measurement_definition",
  "unsupported_parent_goal",
  "ambiguous_mastery_threshold",
  "evidence_gap",
  "duplicate_risk",
  "clinician_confirmation_needed",
]);

export function deriveCalOptimaDraftReview(
  snapshot: CalOptimaDraftReviewAuthoritativeSnapshot,
): CalOptimaDraftReviewResult {
  const approvals = sanitizeApprovals(snapshot);
  const packetValidation = validatePackets(snapshot, approvals);
  const blockerCodes = collectBlockerCodes(snapshot, approvals, packetValidation);
  const parity = collectParity(snapshot, approvals);
  const projectionBase = {
    organizationId: snapshot.organizationId,
    clientId: snapshot.clientId,
    targetDocumentId: snapshot.targetDocumentId,
    templateType: "caloptima_fba" as const,
    blockerCodes,
    approvedCounts: {
      requiredChecklist: approvals.requiredChecklist.length,
      requiredStructured: approvals.requiredStructured.length,
      approvedGoalSections: approvals.approvedGoalSections.length,
    },
    packetCounts: {
      programRecords: packetValidation.programRecords.length,
      goalRecords: packetValidation.goalRecords.length,
    },
    canonicalEvidenceHash: createCanonicalEvidenceHash(snapshot, approvals),
    canonicalPacketHash: createCanonicalPacketHash(packetValidation),
    readinessHash: "",
  };
  const projection: CalOptimaDraftReviewProjection = {
    ...projectionBase,
    readinessHash: "",
  };
  projection.readinessHash = createReadinessHash(snapshot, projection, parity);
  const effect = createEffectDescriptor(snapshot, projection);
  const stepTransitions = buildStepTransitions(snapshot, blockerCodes);

  return {
    workflow: CALOPTIMA_DRAFT_REVIEW_WORKFLOW,
    projection,
    stepTransitions,
    workItemStatus: deriveShadowWorkItemStatus(stepTransitions),
    parity,
    effect,
    modelSuggestion: {
      stepKey: "suggest_draft_packet",
      executionMode: "model_suggested",
      authoritative: false,
      allowedTools: EMPTY_ALLOWED_TOOLS,
      reasonCodes: EMPTY_REASON_CODES,
    },
    generatedClinicalContent: false,
    mutationAuthority: false,
    promotionAuthority: false,
  };
}

function sanitizeApprovals(snapshot: CalOptimaDraftReviewAuthoritativeSnapshot): {
  requiredChecklist: ApprovedEvidenceRecord[];
  requiredStructured: ApprovedEvidenceRecord[];
  approvedGoalSections: ApprovedEvidenceRecord[];
} {
  const requiredChecklist = normalizeApprovedRecords(
    snapshot.approvals.requiredChecklist.approved,
  );
  const requiredStructured = normalizeApprovedRecords(
    snapshot.approvals.requiredStructured.approved,
  );
  const approvedGoalSections = normalizeApprovedRecords(
    snapshot.approvals.approvedGoalSections.approved,
  );

  return {
    requiredChecklist,
    requiredStructured,
    approvedGoalSections,
  };
}

function collectBlockerCodes(
  snapshot: CalOptimaDraftReviewAuthoritativeSnapshot,
  approvals: ReturnType<typeof sanitizeApprovals>,
  packetValidation: ReturnType<typeof validatePackets>,
): CalOptimaDraftReviewBlockerCode[] {
  const blockers: CalOptimaDraftReviewBlockerCode[] = [];
  const ownerBlocker = collectOwnerBlocker(snapshot.ownerAuthorization);
  const scopeReady = snapshot.scopeVerdict === "in_scope" &&
    snapshot.templateType === "caloptima_fba";

  switch (snapshot.scopeVerdict) {
    case "wrong_organization":
      blockers.push("scope_wrong_organization");
      break;
    case "wrong_client":
      blockers.push("scope_wrong_client");
      break;
    case "missing_or_invalid":
      blockers.push("scope_missing_or_invalid");
      break;
    case "in_scope":
      break;
  }

  if (
    snapshot.scopeVerdict === "in_scope" && snapshot.templateType !== "caloptima_fba"
  ) {
    blockers.push("template_type_mismatch");
  }

  if (
    scopeReady &&
    approvals.requiredChecklist.length <
      snapshot.approvals.requiredChecklist.expectedApprovedCount
  ) {
    blockers.push("required_checklist_not_approved");
  }

  if (
    scopeReady &&
    approvals.requiredStructured.length <
      snapshot.approvals.requiredStructured.expectedApprovedCount
  ) {
    blockers.push("required_structured_not_approved");
  }

  if (
    scopeReady &&
    approvals.approvedGoalSections.length <
      snapshot.approvals.approvedGoalSections.expectedCount
  ) {
    blockers.push("approved_goal_section_missing");
  }

  const approvalsReady = scopeReady &&
    approvals.requiredChecklist.length >=
      snapshot.approvals.requiredChecklist.expectedApprovedCount &&
    approvals.requiredStructured.length >=
      snapshot.approvals.requiredStructured.expectedApprovedCount &&
    approvals.approvedGoalSections.length >=
      snapshot.approvals.approvedGoalSections.expectedCount;
  const hasPacketContractFailure = packetValidation.invalidReference ||
    packetValidation.invalidFlags ||
    packetValidation.missingEvidence;

  if (
    approvalsReady &&
    !hasPacketContractFailure &&
    packetValidation.programRecords.length === 0
  ) {
    blockers.push("draft_program_packet_missing");
  }

  if (
    approvalsReady &&
    !hasPacketContractFailure &&
    packetValidation.goalRecords.length === 0
  ) {
    blockers.push("draft_goal_packet_missing");
  }

  if (approvalsReady && packetValidation.invalidReference) {
    blockers.push("packet_reference_invalid");
  }
  if (approvalsReady && packetValidation.invalidFlags) {
    blockers.push("packet_review_flags_invalid");
  }
  if (approvalsReady && packetValidation.missingEvidence) {
    blockers.push("packet_evidence_missing");
  }

  const packetsReady = approvalsReady &&
    packetValidation.programRecords.length > 0 &&
    packetValidation.goalRecords.length > 0 &&
    !packetValidation.invalidReference &&
    !packetValidation.invalidFlags &&
    !packetValidation.missingEvidence;

  if (
    packetsReady &&
    ownerBlocker
  ) {
    blockers.push(ownerBlocker);
  }

  return dedupeBlockers(blockers);
}

function collectParity(
  snapshot: CalOptimaDraftReviewAuthoritativeSnapshot,
  approvals: ReturnType<typeof sanitizeApprovals>,
): {
  descriptors: CalOptimaDraftReviewParityDescriptor[];
  events: CalOptimaDraftReviewParityEvent[];
} {
  const descriptors: CalOptimaDraftReviewParityDescriptor[] = [];

  if (
    snapshot.approvals.requiredChecklist.expectedApprovedCount !==
      approvals.requiredChecklist.length
  ) {
    descriptors.push({
      kind: "required_checklist_approval_count_mismatch",
      reasonCode: "parity_mismatch",
      metadata: {
        expectedCount: snapshot.approvals.requiredChecklist.expectedApprovedCount,
        actualCount: approvals.requiredChecklist.length,
      },
    });
  }

  if (
    snapshot.approvals.requiredStructured.expectedApprovedCount !==
      approvals.requiredStructured.length
  ) {
    descriptors.push({
      kind: "required_structured_approval_count_mismatch",
      reasonCode: "parity_mismatch",
      metadata: {
        expectedCount: snapshot.approvals.requiredStructured.expectedApprovedCount,
        actualCount: approvals.requiredStructured.length,
      },
    });
  }

  if (
    snapshot.approvals.approvedGoalSections.expectedCount !==
      approvals.approvedGoalSections.length
  ) {
    descriptors.push({
      kind: "approved_goal_section_count_mismatch",
      reasonCode: "parity_mismatch",
      metadata: {
        expectedCount: snapshot.approvals.approvedGoalSections.expectedCount,
        actualCount: approvals.approvedGoalSections.length,
      },
    });
  }

  return {
    descriptors,
    events: descriptors.map((descriptor) => ({
      eventType: "assessment.caloptima.prepare_draft_review.parity_detected",
      metadata: {
        workflow_key: CALOPTIMA_DRAFT_REVIEW_WORKFLOW.workflowKey,
        workflow_version: CALOPTIMA_DRAFT_REVIEW_WORKFLOW.version,
        target_document_id: snapshot.targetDocumentId,
        reason_code: descriptor.kind,
        expected_count: descriptor.metadata.expectedCount,
        actual_count: descriptor.metadata.actualCount,
      },
    })),
  };
}

function buildStepTransitions(
  snapshot: CalOptimaDraftReviewAuthoritativeSnapshot,
  blockerCodes: CalOptimaDraftReviewBlockerCode[],
): CalOptimaDraftReviewStepTransition[] {
  const transitions: CalOptimaDraftReviewStepTransition[] = [];
  const scopeReason = findFirst(blockerCodes, [
    "scope_wrong_organization",
    "scope_wrong_client",
    "scope_missing_or_invalid",
    "template_type_mismatch",
  ]);
  const approvalReason = findFirst(blockerCodes, [
    "required_checklist_not_approved",
    "required_structured_not_approved",
    "approved_goal_section_missing",
  ]);
  const packetFailureReason = findFirst(blockerCodes, [
    "packet_reference_invalid",
    "packet_review_flags_invalid",
    "packet_evidence_missing",
  ]);
  const packetWaitingReason = findFirst(blockerCodes, [
    "draft_program_packet_missing",
    "draft_goal_packet_missing",
  ]);
  const ownerReason = findFirst(blockerCodes, [
    "missing_owner",
    "owner_not_authorized",
    "authorization_unavailable",
  ]);

  transitions.push(buildTransition("validate_scope", "completed", null, true));
  if (scopeReason) {
    transitions[0] = buildTransition("validate_scope", "failed", scopeReason, false);
    return completeWithPending(transitions, "validate_scope");
  }

  transitions.push(
    buildTransition("await_approved_evidence", "completed", null, true),
  );
  if (approvalReason) {
    transitions[1] = buildTransition(
      "await_approved_evidence",
      "waiting",
      approvalReason,
      false,
    );
    return completeWithPending(transitions, "await_approved_evidence");
  }

  transitions.push(
    buildTransition("suggest_draft_packet", "completed", null, true),
  );
  transitions.push(
    buildTransition("snapshot_draft_packet", "completed", null, true),
  );
  if (packetFailureReason) {
    transitions[3] = buildTransition(
      "snapshot_draft_packet",
      "failed",
      packetFailureReason,
      false,
    );
    return completeWithPending(transitions, "snapshot_draft_packet");
  }
  if (packetWaitingReason) {
    transitions[3] = buildTransition(
      "snapshot_draft_packet",
      "waiting",
      packetWaitingReason,
      false,
    );
    return completeWithPending(transitions, "snapshot_draft_packet");
  }

  transitions.push(
    buildTransition("assign_clinical_owner", "completed", null, true),
  );
  if (ownerReason) {
    transitions[4] = buildTransition(
      "assign_clinical_owner",
      "failed",
      ownerReason,
      false,
    );
    return completeWithPending(transitions, "assign_clinical_owner");
  }

  transitions.push(
    buildTransition("request_draft_review", "completed", null, true),
  );

  return transitions;
}

function buildTransition(
  stepKey: CalOptimaDraftReviewStepKey,
  targetStatus: WorkStepStatus,
  reasonCode: CalOptimaDraftReviewBlockerCode | null,
  completionSatisfied: boolean,
): CalOptimaDraftReviewStepTransition {
  const workflowStep = CALOPTIMA_DRAFT_REVIEW_WORKFLOW.steps.find((step) =>
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
  completed: CalOptimaDraftReviewStepTransition[],
  stopAfter: CalOptimaDraftReviewStepKey,
): CalOptimaDraftReviewStepTransition[] {
  const stepIndex = CALOPTIMA_DRAFT_REVIEW_STEP_KEYS.indexOf(stopAfter);

  for (const stepKey of CALOPTIMA_DRAFT_REVIEW_STEP_KEYS.slice(stepIndex + 1)) {
    completed.push(buildTransition(stepKey, "pending", null, false));
  }

  return completed;
}

function deriveShadowWorkItemStatus(
  stepTransitions: CalOptimaDraftReviewStepTransition[],
): WorkItemStatus {
  return deriveWorkItemStatus(stepTransitions.map((step, index) => ({
    id: `caloptima-draft-review-${index}`,
    stepKey: step.stepKey,
    status: step.targetStatus,
    executionMode: step.executionMode,
    stateVersion: 0,
    attemptCount: 0,
    maxAttempts: 3,
    wakeAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    requiredRole: null,
    approvalHash: null,
    inputHash: null,
    outputHash: null,
    lastErrorClass: step.targetStatus === "failed" ? "validation" : null,
  })));
}

function normalizeApprovedRecords(
  records: readonly ApprovedEvidenceRecord[],
): ApprovedEvidenceRecord[] {
  const deduped = new Map<string, ApprovedEvidenceRecord>();

  for (const candidate of records) {
    if (!isValidUuid(candidate?.recordId) || !isValidSha256(candidate?.sha256)) {
      continue;
    }

    const sectionKind = candidate.sectionKind === "goal" ? "goal" : undefined;
    const key = `${candidate.recordId}:${candidate.sha256}:${sectionKind ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        recordId: candidate.recordId,
        sha256: candidate.sha256,
        ...(sectionKind ? { sectionKind } : {}),
      });
    }
  }

  return [...deduped.values()].sort((left, right) =>
    compareStrings(
      `${left.recordId}|${left.sha256}|${left.sectionKind ?? ""}`,
      `${right.recordId}|${right.sha256}|${right.sectionKind ?? ""}`,
    )
  );
}

function validatePackets(
  snapshot: CalOptimaDraftReviewAuthoritativeSnapshot,
  approvals: ReturnType<typeof sanitizeApprovals>,
): {
  programRecords: DraftPacketRecord[];
  goalRecords: DraftPacketRecord[];
  invalidReference: boolean;
  invalidFlags: boolean;
  missingEvidence: boolean;
} {
  const validEvidenceByRecordId = new Map<string, string>();
  for (const record of [
    ...approvals.requiredChecklist,
    ...approvals.requiredStructured,
    ...approvals.approvedGoalSections,
  ]) {
    validEvidenceByRecordId.set(record.recordId, record.sha256);
  }

  return {
    programRecords: normalizePacketRecords(
      snapshot.draftPackets.programRecords,
      validEvidenceByRecordId,
    ),
    goalRecords: normalizePacketRecords(
      snapshot.draftPackets.goalRecords,
      validEvidenceByRecordId,
    ),
    invalidReference:
      hasPacketReferenceError(snapshot.draftPackets.programRecords, validEvidenceByRecordId) ||
      hasPacketReferenceError(snapshot.draftPackets.goalRecords, validEvidenceByRecordId),
    invalidFlags:
      hasPacketFlagError(snapshot.draftPackets.programRecords) ||
      hasPacketFlagError(snapshot.draftPackets.goalRecords),
    missingEvidence:
      hasPacketEvidenceError(snapshot.draftPackets.programRecords) ||
      hasPacketEvidenceError(snapshot.draftPackets.goalRecords),
  };
}

function normalizePacketRecords(
  records: readonly DraftPacketRecord[],
  validEvidenceByRecordId: ReadonlyMap<string, string>,
): DraftPacketRecord[] {
  const deduped = new Map<string, DraftPacketRecord>();

  for (const candidate of records) {
    if (
      !isValidUuid(candidate?.packetRecordId) ||
      !isValidUuid(candidate?.sourceRecordId) ||
      !isValidSha256(candidate?.evidenceSha256) ||
      !Array.isArray(candidate?.reviewFlags)
    ) {
      continue;
    }

    const expectedEvidenceHash = validEvidenceByRecordId.get(candidate.sourceRecordId);
    if (!expectedEvidenceHash || expectedEvidenceHash !== candidate.evidenceSha256) {
      continue;
    }

    const normalizedFlags = normalizeReviewFlags(candidate.reviewFlags);
    if (normalizedFlags === null) {
      continue;
    }

    const key = `${candidate.packetRecordId}:${candidate.sourceRecordId}:${
      candidate.evidenceSha256
    }:${normalizedFlags.join(",")}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        packetRecordId: candidate.packetRecordId,
        sourceRecordId: candidate.sourceRecordId,
        evidenceSha256: candidate.evidenceSha256,
        reviewFlags: normalizedFlags,
      });
    }
  }

  return [...deduped.values()].sort((left, right) =>
    compareStrings(
      `${left.packetRecordId}|${left.sourceRecordId}|${left.evidenceSha256}|${
        left.reviewFlags.join(",")
      }`,
      `${right.packetRecordId}|${right.sourceRecordId}|${right.evidenceSha256}|${
        right.reviewFlags.join(",")
      }`,
    )
  );
}

function hasPacketReferenceError(
  records: readonly DraftPacketRecord[],
  validEvidenceByRecordId: ReadonlyMap<string, string>,
): boolean {
  return records.some((candidate) => {
    if (
      !isValidUuid(candidate?.packetRecordId) ||
      !isValidUuid(candidate?.sourceRecordId)
    ) {
      return true;
    }

    return !validEvidenceByRecordId.has(candidate.sourceRecordId);
  });
}

function hasPacketFlagError(records: readonly DraftPacketRecord[]): boolean {
  return records.some((candidate) => {
    if (!Array.isArray(candidate?.reviewFlags)) {
      return true;
    }

    return normalizeReviewFlags(candidate.reviewFlags) === null;
  });
}

function hasPacketEvidenceError(records: readonly DraftPacketRecord[]): boolean {
  return records.some((candidate) => !isValidSha256(candidate?.evidenceSha256));
}

function normalizeReviewFlags(flags: readonly string[]): string[] | null {
  if (!Array.isArray(flags)) {
    return null;
  }

  const deduped = new Set<string>();
  for (const candidate of flags) {
    if (typeof candidate !== "string" || !ALLOWED_REVIEW_FLAGS.has(candidate)) {
      return null;
    }
    deduped.add(candidate);
  }

  return [...deduped].sort(compareStrings);
}

function collectOwnerBlocker(
  ownerAuthorization: CalOptimaDraftReviewAuthoritativeSnapshot["ownerAuthorization"],
): CalOptimaDraftReviewBlockerCode | null {
  if (!isValidUuid(ownerAuthorization.ownerId)) {
    return "missing_owner";
  }
  if (ownerAuthorization.reasonCode !== null) {
    return ownerAuthorization.reasonCode;
  }
  if (!ownerAuthorization.authorized) {
    return "owner_not_authorized";
  }

  return null;
}

function createCanonicalEvidenceHash(
  snapshot: CalOptimaDraftReviewAuthoritativeSnapshot,
  approvals: ReturnType<typeof sanitizeApprovals>,
): string {
  const value = normalizeValue({
    organizationId: snapshot.organizationId,
    clientId: snapshot.clientId,
    targetDocumentId: snapshot.targetDocumentId,
    requiredChecklist: approvals.requiredChecklist.map((record) => ({
      recordId: record.recordId,
      sha256: record.sha256,
    })),
    requiredStructured: approvals.requiredStructured.map((record) => ({
      recordId: record.recordId,
      sha256: record.sha256,
      ...(record.sectionKind ? { sectionKind: record.sectionKind } : {}),
    })),
    approvedGoalSections: approvals.approvedGoalSections.map((record) => ({
      recordId: record.recordId,
      sha256: record.sha256,
    })),
  });

  return hashValue(value);
}

function createCanonicalPacketHash(
  packetValidation: ReturnType<typeof validatePackets>,
): string {
  const value = normalizeValue({
    programRecords: packetValidation.programRecords.map((record) => ({
      packetRecordId: record.packetRecordId,
      sourceRecordId: record.sourceRecordId,
      evidenceSha256: record.evidenceSha256,
      reviewFlags: [...record.reviewFlags],
    })),
    goalRecords: packetValidation.goalRecords.map((record) => ({
      packetRecordId: record.packetRecordId,
      sourceRecordId: record.sourceRecordId,
      evidenceSha256: record.evidenceSha256,
      reviewFlags: [...record.reviewFlags],
    })),
  });

  return hashValue(value);
}

function createReadinessHash(
  snapshot: CalOptimaDraftReviewAuthoritativeSnapshot,
  projection: CalOptimaDraftReviewProjection,
  parity: {
    descriptors: CalOptimaDraftReviewParityDescriptor[];
    events: CalOptimaDraftReviewParityEvent[];
  },
): string {
  return hashValue(normalizeValue({
    organizationId: snapshot.organizationId,
    clientId: snapshot.clientId,
    actorId: snapshot.actorId,
    targetDocumentId: snapshot.targetDocumentId,
    templateType: projection.templateType,
    blockerCodes: [...projection.blockerCodes].sort(),
    approvedCounts: projection.approvedCounts,
    packetCounts: projection.packetCounts,
    canonicalEvidenceHash: projection.canonicalEvidenceHash,
    canonicalPacketHash: projection.canonicalPacketHash,
    ownerAuthorization: {
      ownerId: snapshot.ownerAuthorization.ownerId,
      authorized: snapshot.ownerAuthorization.authorized,
      reasonCode: snapshot.ownerAuthorization.reasonCode,
    },
    parity: parity.descriptors,
  }));
}

function createEffectDescriptor(
  snapshot: CalOptimaDraftReviewAuthoritativeSnapshot,
  projection: Pick<
    CalOptimaDraftReviewProjection,
    "canonicalPacketHash" | "canonicalEvidenceHash"
  >,
): CalOptimaDraftReviewEffectDescriptor {
  const effectKey = hashValue(normalizeValue({
    organizationId: snapshot.organizationId,
    actorId: snapshot.actorId,
    workflow: CALOPTIMA_DRAFT_REVIEW_WORKFLOW.workflow,
    stepKey: "request_draft_review",
    targetDocumentId: snapshot.targetDocumentId,
    canonicalPacketHash: projection.canonicalPacketHash,
    canonicalEvidenceHash: projection.canonicalEvidenceHash,
  }));

  return {
    descriptor: "assessment.caloptima.prepare_draft_review.effect@1",
    organizationId: snapshot.organizationId,
    actorId: snapshot.actorId,
    workflow: CALOPTIMA_DRAFT_REVIEW_WORKFLOW.workflow,
    stepKey: "request_draft_review",
    targetDocumentId: snapshot.targetDocumentId,
    canonicalPacketHash: projection.canonicalPacketHash,
    canonicalEvidenceHash: projection.canonicalEvidenceHash,
    effectKey,
  };
}

function hashValue(value: unknown): string {
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
  values: readonly CalOptimaDraftReviewBlockerCode[],
  candidates: readonly CalOptimaDraftReviewBlockerCode[],
): CalOptimaDraftReviewBlockerCode | null {
  for (const candidate of candidates) {
    if (values.includes(candidate)) {
      return candidate;
    }
  }

  return null;
}

function dedupeBlockers(
  blockerCodes: readonly CalOptimaDraftReviewBlockerCode[],
): CalOptimaDraftReviewBlockerCode[] {
  return [...new Set(blockerCodes)];
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" &&
    value !== "00000000-0000-0000-0000-000000000000" &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
}

function isValidSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}
