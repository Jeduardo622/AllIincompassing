import { describe, expect, it } from "vitest";
import { build837PTransaction, hashEdiContent } from "../edi837";
import type { EdiClaim } from "../edi837";

const createSampleClaim = (): EdiClaim => ({
  sessionId: "session-123",
  serviceDate: "2025-01-02T15:00:00.000Z",
  placeOfServiceCode: "11",
  diagnosisCodes: ["F84.0", "R62.5"],
  subscriber: {
    id: "client-001",
    firstName: "Jamie",
    lastName: "Smith",
    middleName: "A",
    memberId: "MEM123",
    dateOfBirth: "2014-05-06",
    gender: "F",
    relationship: "self",
    addressLine1: "123 Main St",
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    phone: "5125550000",
  },
  patient: {
    id: "client-001",
    firstName: "Jamie",
    lastName: "Smith",
    middleName: "A",
    memberId: "MEM123",
    dateOfBirth: "2014-05-06",
    gender: "F",
    relationship: "self",
    addressLine1: "123 Main St",
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    phone: "5125550000",
  },
  billingProvider: {
    id: "provider-01",
    organizationName: "Apex Therapy",
    firstName: "Alex",
    lastName: "Doe",
    npi: "1234567890",
    taxonomyCode: "103K00000X",
    taxId: "12-3456789",
    addressLine1: "456 Care Way",
    city: "Austin",
    state: "TX",
    postalCode: "78702",
    phone: "5125559999",
  },
  renderingProvider: {
    id: "provider-01",
    firstName: "Alex",
    lastName: "Doe",
    npi: "1234567890",
    taxonomyCode: "103K00000X",
    taxId: "12-3456789",
    addressLine1: "456 Care Way",
    city: "Austin",
    state: "TX",
    postalCode: "78702",
    phone: "5125559999",
  },
  billingRecord: {
    id: "billing-001",
    claimNumber: "CLM1",
    amount: 120,
    status: "pending",
  },
  serviceLines: [
    {
      lineNumber: 1,
      cptCode: "97153",
      modifiers: ["GT"],
      units: 2,
      chargeAmount: 120,
      serviceDate: "2025-01-02",
      description: "Adaptive behavior treatment",
      billedMinutes: 60,
    },
  ],
});

describe("build837PTransaction", () => {
  it("creates a professional 837 envelope with required segments", () => {
    const claim = createSampleClaim();
    const transaction = build837PTransaction([claim], {
      senderId: "SENDERID",
      receiverId: "RECEIVERID",
      usageIndicator: "T",
      interchangeControlNumber: "000000123",
      groupControlNumber: "000000456",
      transactionSetControlNumber: "0001",
    });

    expect(transaction.interchangeControlNumber).toBe("000000123");
    expect(transaction.claimControlNumbers).toEqual({ "billing-001": "CLM1" });

    const segments = transaction.content.split("~").filter(Boolean);
    expect(segments[0]).toMatch(/^ISA\*00\*/);
    expect(segments.some((segment) => segment.startsWith("GS*HC*SENDERID*RECEIVERID*"))).toBe(true);
    expect(segments).toContain("ST*837*0001*005010X222A1");
    expect(segments).toContain("NM1*85*2*APEX THERAPY*****XX*1234567890");
    expect(segments.some((segment) => /^NM1\*82\*1\*DOE\*ALEX\*/.test(segment))).toBe(true);
    expect(segments).toContain("CLM*CLM1*120.00***11:B:1*Y*A*Y*I*P*11");
    expect(segments).toContain("SV1*HC:97153:GT*120.00*UN*2***1");
    expect(segments).toContain("DTP*472*D8*20250102");

    const digest = hashEdiContent(transaction.content);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
