import { hashEdiContent, build837PTransaction } from "./generator";
import { logger } from "../../lib/logger/logger";
import {
  type ClaimDenialInput,
  type ClaimDenialRecord,
  type ClearinghouseAcknowledgment,
  type ClearinghouseClient,
  type ClearinghouseSubmissionResult,
  type Edi837GeneratorOptions,
  type Edi837Repository,
  type Edi837Transaction,
  type EdiClaim,
  type EdiClaimStatusUpdate,
  type EdiExportFileRecord,
  type ClearinghouseSubmissionPayload,
} from "./types";

export interface RunEdiExportParams {
  repository: Edi837Repository;
  generatorOptions: Edi837GeneratorOptions;
  fileNamePrefix?: string;
  now?: Date;
}

export interface RunEdiExportResult {
  exported: boolean;
  transaction?: Edi837Transaction;
  file?: EdiExportFileRecord;
  claimCount: number;
  claims?: EdiClaim[];
}

export interface RunClearinghouseDryRunParams extends RunEdiExportParams {
  clearinghouseClient: ClearinghouseClient;
  auditContext?: Record<string, unknown>;
}

export interface RunClearinghouseDryRunResult extends RunEdiExportResult {
  acknowledgment?: ClearinghouseAcknowledgment;
  denialRecords: ClaimDenialRecord[];
  rawClearinghouseResponse?: Record<string, unknown>;
}

const buildFileName = (prefix: string, controlNumber: string, timestamp: Date): string => {
  const iso = timestamp.toISOString().replace(/[:.]/g, "").slice(0, 15);
  return `${prefix}_${iso}_${controlNumber}.txt`;
};

export const runEdi837ExportPipeline = async ({
  repository,
  generatorOptions,
  fileNamePrefix = "837P",
  now = new Date(),
}: RunEdiExportParams): Promise<RunEdiExportResult> => {
  const claims = await repository.loadPendingClaims();
  if (claims.length === 0) {
    return { exported: false, claimCount: 0, claims: [] };
  }

  const transaction = build837PTransaction(claims, generatorOptions);
  const checksum = hashEdiContent(transaction.content);
  const fileName = buildFileName(fileNamePrefix, transaction.interchangeControlNumber, now);

  const fileRecord = await repository.saveExportFile({
    content: transaction.content,
    fileName,
    interchangeControlNumber: transaction.interchangeControlNumber,
    groupControlNumber: transaction.groupControlNumber,
    transactionSetControlNumber: transaction.transactionSetControlNumber,
    claimCount: claims.length,
    checksum,
  });

  const statusUpdates: EdiClaimStatusUpdate[] = claims.map((claim) => ({
    billingRecordId: claim.billingRecord.id,
    sessionId: claim.sessionId,
    status: "submitted",
    exportFileId: fileRecord.id,
    claimControlNumber: transaction.claimControlNumbers[claim.billingRecord.id],
    effectiveAt: transaction.createdAt,
    notes: `Submitted via EDI export ${fileRecord.fileName}`,
  }));

  await repository.recordClaimStatuses(statusUpdates);

  return {
    exported: true,
    transaction,
    file: fileRecord,
    claimCount: claims.length,
    claims,
  };
};

const buildClearinghouseSubmissionPayload = (
  result: Required<Pick<RunEdiExportResult, "transaction" | "file" | "claims">>
): ClearinghouseSubmissionPayload => ({
  transaction: result.transaction,
  file: result.file,
  claims: result.claims,
});

const buildAcknowledgmentStatusUpdates = (
  result: Required<Pick<RunEdiExportResult, "transaction" | "file" | "claims">>,
  acknowledgment: ClearinghouseAcknowledgment,
): EdiClaimStatusUpdate[] => {
  const noteBase = [`Clearinghouse ack ${acknowledgment.id}`, acknowledgment.status];
  if (acknowledgment.notes) {
    noteBase.push(acknowledgment.notes);
  }
  const note = noteBase.join(" - ");

  return result.claims.map((claim) => ({
    billingRecordId: claim.billingRecord.id,
    sessionId: claim.sessionId,
    status: "submitted",
    exportFileId: result.file.id,
    claimControlNumber: result.transaction.claimControlNumbers[claim.billingRecord.id],
    effectiveAt: acknowledgment.receivedAt,
    notes: note,
  }));
};

const logAcknowledgmentAudit = (
  acknowledgment: ClearinghouseAcknowledgment,
  context?: Record<string, unknown>,
): void => {
  logger.info("Clearinghouse acknowledgment received", {
    metadata: {
      ackId: acknowledgment.id,
      status: acknowledgment.status,
      receivedAt: acknowledgment.receivedAt,
      notes: acknowledgment.notes ?? null,
      payerSummaries: acknowledgment.payerSummaries,
      context: context ?? null,
    },
  });
};

const logDenialAudit = (
  records: ClaimDenialRecord[],
  acknowledgment: ClearinghouseAcknowledgment,
  context?: Record<string, unknown>,
): void => {
  records.forEach((record) => {
    logger.warn("Clearinghouse denial recorded", {
      metadata: {
        ackId: acknowledgment.id,
        status: acknowledgment.status,
        billingRecordId: record.billingRecordId,
        sessionId: record.sessionId,
        denialCode: record.denialCode,
        description: record.description ?? null,
        payerControlNumber: record.payerControlNumber ?? null,
        receivedAt: record.receivedAt,
        recordedAt: record.recordedAt,
        context: context ?? null,
      },
    });
  });
};

export const runClearinghouseDryRun = async ({
  repository,
  generatorOptions,
  clearinghouseClient,
  fileNamePrefix,
  now,
  auditContext,
}: RunClearinghouseDryRunParams): Promise<RunClearinghouseDryRunResult> => {
  const exportResult = await runEdi837ExportPipeline({
    repository,
    generatorOptions,
    fileNamePrefix,
    now,
  });

  if (!exportResult.exported || !exportResult.transaction || !exportResult.file || !exportResult.claims) {
    return {
      ...exportResult,
      denialRecords: [],
    };
  }

  const submissionPayload = buildClearinghouseSubmissionPayload({
    transaction: exportResult.transaction,
    file: exportResult.file,
    claims: exportResult.claims,
  });

  const submission: ClearinghouseSubmissionResult = await clearinghouseClient.submit837(submissionPayload);

  const acknowledgmentUpdates = buildAcknowledgmentStatusUpdates(
    {
      transaction: exportResult.transaction,
      file: exportResult.file,
      claims: exportResult.claims,
    },
    submission.acknowledgment,
  );
  await repository.recordClaimStatuses(acknowledgmentUpdates);

  const denialRecords = await ingestClaimDenials(repository, submission.denials);

  logAcknowledgmentAudit(submission.acknowledgment, auditContext);
  if (denialRecords.length > 0) {
    logDenialAudit(denialRecords, submission.acknowledgment, auditContext);
  }

  return {
    ...exportResult,
    acknowledgment: submission.acknowledgment,
    denialRecords,
    rawClearinghouseResponse: submission.rawResponse,
  };
};

export const ingestClaimDenials = async (
  repository: Edi837Repository,
  denials: ClaimDenialInput[],
): Promise<ClaimDenialRecord[]> => {
  if (denials.length === 0) {
    return [];
  }

  const records = await repository.ingestClaimDenials(denials);
  if (records.length === 0) {
    return records;
  }

  const updates: EdiClaimStatusUpdate[] = records.map((record) => ({
    billingRecordId: record.billingRecordId,
    sessionId: record.sessionId,
    status: "rejected",
    effectiveAt: record.receivedAt,
    notes: `Denial ${record.denialCode}${record.description ? ` - ${record.description}` : ""}`,
  }));

  await repository.recordClaimStatuses(updates);

  return records;
};
