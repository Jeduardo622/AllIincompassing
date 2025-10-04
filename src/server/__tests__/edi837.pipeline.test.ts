import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClearinghouseSandboxClient,
  SANDBOX_PAYER_FIXTURES,
  InMemoryEdi837Repository,
  ingestClaimDenials,
  runEdi837ExportPipeline,
  runClearinghouseDryRun,
  type ClaimDenialInput,
  type EdiClaim,
} from "../edi837";
import { logger } from "../../lib/logger/logger";

const makeClaim = (suffix: number, overrides?: Partial<EdiClaim>): EdiClaim => {
  const base: EdiClaim = {
    sessionId: `session-${suffix}`,
    serviceDate: `2025-02-${String(10 + suffix).padStart(2, "0")}T13:00:00.000Z`,
    placeOfServiceCode: "11",
    diagnosisCodes: ["F84.0"],
    subscriber: {
      id: `client-${suffix}`,
      firstName: `Taylor${suffix}`,
      lastName: "Jordan",
      relationship: "self",
      dateOfBirth: "2015-08-09",
      gender: "F",
      memberId: `MBR${suffix}`,
      addressLine1: "123 Care Rd",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
    },
    patient: {
      id: `client-${suffix}`,
      firstName: `Taylor${suffix}`,
      lastName: "Jordan",
      relationship: "self",
      dateOfBirth: "2015-08-09",
      gender: "F",
      memberId: `MBR${suffix}`,
      addressLine1: "123 Care Rd",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
    },
    billingProvider: {
      id: "provider-100",
      organizationName: "Apex Therapy",
      firstName: "Morgan",
      lastName: "Lee",
      npi: "1457382911",
      taxonomyCode: "103K00000X",
      taxId: "98-7654321",
      addressLine1: "456 Therapy Way",
      city: "Austin",
      state: "TX",
      postalCode: "78702",
      phone: "5123337890",
    },
    renderingProvider: {
      id: "provider-100",
      firstName: "Morgan",
      lastName: "Lee",
      npi: "1457382911",
      taxonomyCode: "103K00000X",
      taxId: "98-7654321",
      addressLine1: "456 Therapy Way",
      city: "Austin",
      state: "TX",
      postalCode: "78702",
      phone: "5123337890",
    },
    billingRecord: {
      id: `billing-${suffix}`,
      claimNumber: `CLM-${suffix}`,
      amount: 150 + suffix * 10,
      status: "pending",
    },
    serviceLines: [
      {
        lineNumber: 1,
        cptCode: "97153",
        modifiers: [],
        units: 1 + suffix,
        chargeAmount: 75 * (1 + suffix),
        serviceDate: `2025-02-${String(10 + suffix).padStart(2, "0")}`,
      },
      {
        lineNumber: 2,
        cptCode: "97155",
        modifiers: ["KH"],
        units: 1,
        chargeAmount: 80,
        serviceDate: `2025-02-${String(10 + suffix).padStart(2, "0")}`,
      },
    ],
    payer: {
      id: "MEDICAID_TX",
      name: "Texas Medicaid",
    },
  };

  return {
    ...base,
    ...overrides,
    billingRecord: { ...base.billingRecord, ...overrides?.billingRecord },
    subscriber: { ...base.subscriber, ...overrides?.subscriber },
    patient: { ...base.patient, ...overrides?.patient },
    billingProvider: { ...base.billingProvider, ...overrides?.billingProvider },
    renderingProvider: { ...base.renderingProvider, ...overrides?.renderingProvider },
    serviceLines: overrides?.serviceLines ?? base.serviceLines,
    diagnosisCodes: overrides?.diagnosisCodes ?? base.diagnosisCodes,
  };
};

describe("EDI 837 export pipeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports pending claims and records denial ingestion", async () => {
    const repository = new InMemoryEdi837Repository([
      makeClaim(1),
      makeClaim(2),
    ]);

    const exportResult = await runEdi837ExportPipeline({
      repository,
      generatorOptions: {
        senderId: "SUBMITTER",
        receiverId: "CLEARINGHOUSE",
        usageIndicator: "T",
        interchangeControlNumber: "000000900",
        groupControlNumber: "000000901",
        transactionSetControlNumber: "0005",
      },
      now: new Date("2025-02-12T10:15:30.000Z"),
      fileNamePrefix: "837P_JOB",
    });

    expect(exportResult.exported).toBe(true);
    expect(exportResult.claimCount).toBe(2);
    expect(exportResult.file?.fileName).toContain("837P_JOB");
    expect(exportResult.file?.fileName).toContain("000000900");
    expect(repository.getExportFiles()).toHaveLength(1);
    expect(repository.getStatusHistory().filter((status) => status.status === "submitted")).toHaveLength(2);

    const pendingAfterExport = await repository.loadPendingClaims();
    expect(pendingAfterExport).toHaveLength(0);

    const denialPayload: ClaimDenialInput = {
      billingRecordId: "billing-2",
      sessionId: "session-2",
      denialCode: "CO16",
      description: "Missing required attachment",
      payerControlNumber: "PN123",
      receivedAt: "2025-02-15T09:00:00.000Z",
    };

    const denials = await ingestClaimDenials(repository, [denialPayload]);
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({
      billingRecordId: "billing-2",
      denialCode: "CO16",
    });

    const rejectionStatuses = repository.getStatusHistory().filter((status) => status.status === "rejected");
    expect(rejectionStatuses).toHaveLength(1);
    expect(rejectionStatuses[0]).toMatchObject({
      billingRecordId: "billing-2",
      notes: expect.stringContaining("Missing required attachment"),
    });
  });

  it("runs a clearinghouse dry run, logs acknowledgments, and ingests denials", async () => {
    const repository = new InMemoryEdi837Repository([
      makeClaim(1, {
        payer: { id: "MEDICAID_TX", name: "Texas Medicaid" },
        serviceLines: [
          {
            lineNumber: 1,
            cptCode: "97153",
            modifiers: [],
            units: 1,
            chargeAmount: 150,
            serviceDate: "2025-02-11",
          },
          {
            lineNumber: 2,
            cptCode: "97155",
            modifiers: [],
            units: 1,
            chargeAmount: 95,
            serviceDate: "2025-02-11",
          },
        ],
      }),
      makeClaim(2, {
        payer: { id: "BCBS_NY", name: "BlueCross BlueShield NY" },
        serviceLines: [
          {
            lineNumber: 1,
            cptCode: "97153",
            modifiers: [],
            units: 1,
            chargeAmount: 200,
            serviceDate: "2025-02-12",
          },
        ],
      }),
    ]);

    const infoSpy = vi.spyOn(logger, "info");
    const warnSpy = vi.spyOn(logger, "warn");

    const clearinghouse = new ClearinghouseSandboxClient(SANDBOX_PAYER_FIXTURES, {
      now: () => new Date("2025-02-13T14:30:00.000Z"),
    });

    const result = await runClearinghouseDryRun({
      repository,
      generatorOptions: {
        senderId: "SUBMITTER",
        receiverId: "CLEARINGHOUSE",
        usageIndicator: "T",
        interchangeControlNumber: "000000910",
        groupControlNumber: "000000911",
        transactionSetControlNumber: "0006",
      },
      clearinghouseClient: clearinghouse,
      now: new Date("2025-02-12T10:15:30.000Z"),
      fileNamePrefix: "837P_JOB",
      auditContext: { triggeredBy: "dry-run" },
    });

    expect(result.exported).toBe(true);
    expect(result.acknowledgment).toBeDefined();
    expect(result.acknowledgment?.status).toBe("accepted_with_errors");
    expect(result.denialRecords).toHaveLength(1);
    expect(result.denialRecords[0]).toMatchObject({
      billingRecordId: "billing-1",
      denialCode: "CO16",
    });

    const statusHistory = repository.getStatusHistory();
    const acknowledgmentStatuses = statusHistory.filter((status) =>
      (status.notes ?? "").includes("Clearinghouse ack"),
    );
    expect(acknowledgmentStatuses).toHaveLength(2);

    const rejectionStatuses = statusHistory.filter((status) => status.status === "rejected");
    expect(rejectionStatuses).toHaveLength(1);
    expect(rejectionStatuses[0].billingRecordId).toBe("billing-1");

    expect(infoSpy).toHaveBeenCalledWith(
      "Clearinghouse acknowledgment received",
      expect.objectContaining({
        metadata: expect.objectContaining({
          ackId: result.acknowledgment?.id,
          status: "accepted_with_errors",
          payerSummaries: expect.arrayContaining([
            expect.objectContaining({ payerId: "MEDICAID_TX", denied: 1 }),
          ]),
          context: { triggeredBy: "dry-run" },
        }),
      }),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      "Clearinghouse denial recorded",
      expect.objectContaining({
        metadata: expect.objectContaining({
          billingRecordId: "billing-1",
          denialCode: "CO16",
          ackId: result.acknowledgment?.id,
          context: { triggeredBy: "dry-run" },
        }),
      }),
    );
  });
});
