import { hashEdiContent, build837PTransaction } from "./generator";
import {
  type ClaimDenialInput,
  type ClaimDenialRecord,
  type Edi837GeneratorOptions,
  type Edi837Repository,
  type Edi837Transaction,
  type EdiClaimStatusUpdate,
  type EdiExportFileRecord,
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
    return { exported: false, claimCount: 0 };
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
