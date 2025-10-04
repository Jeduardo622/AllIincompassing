import { randomUUID } from "crypto";

import {
  type ClearinghouseAcknowledgment,
  type ClearinghouseAcknowledgmentStatus,
  type ClearinghouseClient,
  type ClearinghousePayerSummary,
  type ClearinghouseSubmissionPayload,
  type ClearinghouseSubmissionResult,
  type EdiClaim,
} from "./types";

export interface SandboxDenialRule {
  code: string;
  reason: string;
  matches: (claim: EdiClaim) => boolean;
}

export interface SandboxPayerFixture {
  payerId: string;
  payerName: string;
  acknowledgmentStatus?: ClearinghouseAcknowledgmentStatus;
  denialRules?: SandboxDenialRule[];
}

const fallbackRandomId = (): string => `ack_${Math.random().toString(36).slice(2, 10)}`;

const generateAckId = (): string => {
  try {
    return `ack_${randomUUID()}`;
  } catch {
    return fallbackRandomId();
  }
};

export const SANDBOX_PAYER_FIXTURES: SandboxPayerFixture[] = [
  {
    payerId: "MEDICAID_TX",
    payerName: "Texas Medicaid",
    acknowledgmentStatus: "accepted",
    denialRules: [
      {
        code: "CO16",
        reason: "Missing KH modifier for adaptive behavior",
        matches: (claim) =>
          claim.serviceLines.some(
            (line) => line.cptCode === "97155" && !line.modifiers.includes("KH"),
          ),
      },
    ],
  },
  {
    payerId: "AETNA_COMMERCIAL",
    payerName: "Aetna Commercial",
    acknowledgmentStatus: "accepted",
    denialRules: [
      {
        code: "CO45",
        reason: "Charge exceeds payer maximum",
        matches: (claim) =>
          claim.serviceLines.reduce((total, line) => total + Number(line.chargeAmount ?? 0), 0) > 500,
      },
    ],
  },
  {
    payerId: "BCBS_NY",
    payerName: "BlueCross BlueShield NY",
    acknowledgmentStatus: "accepted",
    denialRules: [],
  },
];

const ensureFixtureMap = (
  fixtures: SandboxPayerFixture[],
): Map<string, SandboxPayerFixture> => {
  const map = new Map<string, SandboxPayerFixture>();
  fixtures.forEach((fixture) => {
    map.set(fixture.payerId, {
      ...fixture,
      denialRules: fixture.denialRules ?? [],
    });
  });
  return map;
};

const derivePayerId = (claim: EdiClaim): string => claim.payer?.id ?? "DEFAULT";

const buildSummary = (
  existing: ClearinghousePayerSummary | undefined,
  payerId: string,
  payerName: string,
): ClearinghousePayerSummary => ({
  payerId,
  payerName,
  accepted: existing?.accepted ?? 0,
  denied: existing?.denied ?? 0,
});

const evaluateDenials = (
  fixtures: Map<string, SandboxPayerFixture>,
  payload: ClearinghouseSubmissionPayload,
): {
  denials: ClearinghouseSubmissionResult["denials"];
  summaries: ClearinghousePayerSummary[];
} => {
  const summaryMap = new Map<string, ClearinghousePayerSummary>();
  const denials: ClearinghouseSubmissionResult["denials"] = [];

  payload.claims.forEach((claim) => {
    const payerId = derivePayerId(claim);
    const fixture = fixtures.get(payerId) ?? {
      payerId,
      payerName: claim.payer?.name ?? "Unknown Payer",
      acknowledgmentStatus: "accepted" as ClearinghouseAcknowledgmentStatus,
      denialRules: [],
    };

    const summary = buildSummary(summaryMap.get(fixture.payerId), fixture.payerId, fixture.payerName);

    const matchingRule = fixture.denialRules?.find((rule) => rule.matches(claim));
    if (matchingRule) {
      summary.denied += 1;
      denials.push({
        billingRecordId: claim.billingRecord.id,
        sessionId: claim.sessionId,
        denialCode: matchingRule.code,
        description: matchingRule.reason,
        payerControlNumber:
          `${fixture.payerId}-${
            payload.transaction.claimControlNumbers[claim.billingRecord.id] ?? claim.billingRecord.claimNumber
          }`,
        receivedAt: payload.transaction.createdAt,
      });
    } else {
      summary.accepted += 1;
    }

    summaryMap.set(fixture.payerId, summary);
  });

  return { denials, summaries: Array.from(summaryMap.values()) };
};

const resolveBaseStatus = (
  fixtures: Map<string, SandboxPayerFixture>,
  summaries: ClearinghousePayerSummary[],
): ClearinghouseAcknowledgmentStatus => {
  if (summaries.length === 0) {
    return "accepted";
  }

  const statuses = summaries.map((summary) => fixtures.get(summary.payerId)?.acknowledgmentStatus ?? "accepted");
  if (statuses.includes("rejected")) {
    return "rejected";
  }
  if (statuses.includes("accepted_with_errors")) {
    return "accepted_with_errors";
  }
  return "accepted";
};

const resolveAcknowledgmentStatus = (
  summaries: ClearinghousePayerSummary[],
  defaultStatus: ClearinghouseAcknowledgmentStatus,
): ClearinghouseAcknowledgmentStatus => {
  const totalDenied = summaries.reduce((total, summary) => total + summary.denied, 0);
  const totalAccepted = summaries.reduce((total, summary) => total + summary.accepted, 0);

  if (totalDenied === 0) {
    return defaultStatus;
  }

  if (totalAccepted === 0) {
    return "rejected";
  }

  return "accepted_with_errors";
};

const buildAcknowledgment = (
  payload: ClearinghouseSubmissionPayload,
  summaries: ClearinghousePayerSummary[],
  status: ClearinghouseAcknowledgmentStatus,
  ackId: string,
  receivedAt: string,
): ClearinghouseAcknowledgment => {
  const totalAccepted = summaries.reduce((total, summary) => total + summary.accepted, 0);
  const totalDenied = summaries.reduce((total, summary) => total + summary.denied, 0);
  const notes = `${totalAccepted} accepted, ${totalDenied} denied`;

  return {
    id: ackId,
    status,
    receivedAt,
    notes,
    payerSummaries: summaries,
    raw: {
      fileName: payload.file.fileName,
      interchangeControlNumber: payload.transaction.interchangeControlNumber,
    },
  };
};

export class ClearinghouseSandboxClient implements ClearinghouseClient {
  private readonly fixtures: Map<string, SandboxPayerFixture>;

  private readonly now: () => Date;

  constructor(fixtures: SandboxPayerFixture[], options?: { now?: () => Date }) {
    if (fixtures.length === 0) {
      throw new Error("At least one payer fixture is required for the clearinghouse sandbox");
    }
    this.fixtures = ensureFixtureMap(fixtures);
    this.now = options?.now ?? (() => new Date());
  }

  async submit837(payload: ClearinghouseSubmissionPayload): Promise<ClearinghouseSubmissionResult> {
    const ackId = generateAckId();
    const receivedAt = this.now().toISOString();

    const { denials, summaries } = evaluateDenials(this.fixtures, payload);
    const defaultStatus = resolveBaseStatus(this.fixtures, summaries);
    const status = resolveAcknowledgmentStatus(
      summaries,
      defaultStatus,
    );

    const acknowledgment = buildAcknowledgment(payload, summaries, status, ackId, receivedAt);

    const normalizedDenials = denials.map((denial) => ({ ...denial, receivedAt }));

    return {
      acknowledgment,
      denials: normalizedDenials,
      rawResponse: {
        acknowledgment,
        denials: normalizedDenials,
      },
    };
  }
}
