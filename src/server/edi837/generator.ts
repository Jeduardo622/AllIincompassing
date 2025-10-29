import { createHash } from "node:crypto";
import {
  type Edi837GeneratorOptions,
  type Edi837Transaction,
  type EdiClaim,
} from "./types";

const SEGMENT_TERMINATOR = "~";
const ELEMENT_SEPARATOR = "*";
const SUB_ELEMENT_SEPARATOR = ":";

const padRight = (value: string, length: number): string =>
  value.length >= length ? value.slice(0, length) : `${value}${" ".repeat(length - value.length)}`;

const sanitizeAlphaNumeric = (value: string): string => value.replace(/[^0-9A-Za-z]/g, "");

const sanitizeText = (value: string): string => value.replace(/[~*^:]/g, "").trim();

const toCurrency = (amount: number): string => amount.toFixed(2);

const formatDate = (date: Date): string => {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
};

const formatDateShort = (date: Date): string => {
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
};

const formatTime = (date: Date): string => {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}${minutes}`;
};

const generateControlNumber = (length: number): string => {
  const random = Math.floor(Math.random() * 10 ** length);
  return random.toString().padStart(length, "0");
};

const joinElements = (values: Array<string | number | undefined | null>): string =>
  values
    .map((value) => {
      if (value === undefined || value === null) {
        return "";
      }
      return typeof value === "number" ? String(value) : value;
    })
    .join(ELEMENT_SEPARATOR);

const buildSubscriberNm1 = (claim: EdiClaim): string => {
  const subscriber = claim.subscriber;
  const lastName = sanitizeText(subscriber.lastName ?? "UNKNOWN").toUpperCase();
  const firstName = sanitizeText(subscriber.firstName ?? "UNKNOWN").toUpperCase();
  const middle = subscriber.middleName ? sanitizeText(subscriber.middleName).toUpperCase() : "";
  const id = sanitizeAlphaNumeric(subscriber.memberId ?? subscriber.id);
  return joinElements([
    "NM1",
    "IL",
    "1",
    lastName || "UNKNOWN",
    firstName || "UNKNOWN",
    middle,
    "",
    "",
    "MI",
    id,
  ]);
};

const buildPatientNm1 = (claim: EdiClaim): string => {
  const patient = claim.patient;
  const lastName = sanitizeText(patient.lastName ?? "UNKNOWN").toUpperCase();
  const firstName = sanitizeText(patient.firstName ?? "UNKNOWN").toUpperCase();
  const middle = patient.middleName ? sanitizeText(patient.middleName).toUpperCase() : "";
  return joinElements(["NM1", "QC", "1", lastName || "UNKNOWN", firstName || "UNKNOWN", middle]);
};

const buildProviderNm1 = (qualifier: "85" | "82", claim: EdiClaim): string => {
  const provider = qualifier === "85" ? claim.billingProvider : claim.renderingProvider;
  const name = sanitizeText(provider.organizationName ?? "").toUpperCase();
  if (name) {
    return joinElements([
      "NM1",
      qualifier,
      "2",
      name,
      "",
      "",
      "",
      "",
      "XX",
      sanitizeAlphaNumeric(provider.npi ?? provider.id),
    ]);
  }

  const lastName = sanitizeText(provider.lastName ?? "UNKNOWN").toUpperCase();
  const firstName = sanitizeText(provider.firstName ?? "UNKNOWN").toUpperCase();
  return joinElements([
    "NM1",
    qualifier,
    "1",
    lastName || "UNKNOWN",
    firstName || "UNKNOWN",
    "",
    "",
    "",
    "XX",
    sanitizeAlphaNumeric(provider.npi ?? provider.id),
  ]);
};

const buildAddressSegments = (
  _qualifier: "85" | "87" | "IL" | "QC",
  entity: { addressLine1?: string | null; addressLine2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null },
): string[] => {
  const line1 = sanitizeText(entity.addressLine1 ?? "");
  const line2 = sanitizeText(entity.addressLine2 ?? "");
  const city = sanitizeText(entity.city ?? "");
  const state = sanitizeText(entity.state ?? "").toUpperCase();
  const postal = sanitizeAlphaNumeric(entity.postalCode ?? "");

  const segments: string[] = [];
  if (line1 || line2) {
    segments.push(joinElements(["N3", line1 || "UNKNOWN", line2 || undefined]));
  }
  if (city || state || postal) {
    segments.push(joinElements(["N4", city || "UNKNOWN", state || "", postal || ""]));
  }
  return segments;
};

const deriveTotalCharge = (claim: EdiClaim): number =>
  claim.serviceLines.reduce((total, line) => total + Number(line.chargeAmount ?? 0), 0);

const formatDiagnosisCode = (code: string): string => sanitizeAlphaNumeric(code).toUpperCase();

const ensureControlNumber = (
  provided: string | undefined,
  fallback: string,
  suffix: string,
): string => {
  if (provided && sanitizeAlphaNumeric(provided).length > 0) {
    return sanitizeAlphaNumeric(provided);
  }
  return `${sanitizeAlphaNumeric(fallback)}${suffix}`;
};

const buildServiceLineSegment = (
  claim: EdiClaim,
  line: EdiClaim["serviceLines"][number],
  index: number,
): string[] => {
  const modifiers = line.modifiers
    .map((modifier) => sanitizeAlphaNumeric(modifier))
    .filter((modifier) => modifier.length > 0);
  const procedure = [line.cptCode, ...modifiers].filter((value) => value.length > 0).join(SUB_ELEMENT_SEPARATOR);
  let serviceDate: string;
  if (typeof line.serviceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(line.serviceDate)) {
    // Preserve literal date to avoid timezone drift
    serviceDate = line.serviceDate.replace(/-/g, "");
  } else {
    const date = new Date(line.serviceDate);
    serviceDate = Number.isNaN(date.getTime()) ? formatDate(new Date(claim.serviceDate)) : formatDate(date);
  }
  return [
    joinElements(["LX", index + 1]),
    joinElements([
      "SV1",
      `HC${SUB_ELEMENT_SEPARATOR}${procedure}`,
      toCurrency(line.chargeAmount),
      "UN",
      line.units || 1,
      undefined,
      undefined,
      "1",
    ]),
    joinElements(["DTP", "472", "D8", serviceDate]),
  ];
};

const checksum = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");

export const build837PTransaction = (
  claims: EdiClaim[],
  options: Edi837GeneratorOptions,
): Edi837Transaction => {
  if (claims.length === 0) {
    throw new Error("No claims available to build 837P transaction");
  }

  const now = new Date();
  const interchangeControlNumber =
    options.interchangeControlNumber ?? generateControlNumber(9);
  const groupControlNumber = options.groupControlNumber ?? generateControlNumber(9);
  const transactionSetControlNumber = options.transactionSetControlNumber ?? "0001";
  const usageIndicator = options.usageIndicator ?? "T";

  const senderId = padRight(sanitizeAlphaNumeric(options.senderId).toUpperCase(), 15);
  const receiverId = padRight(sanitizeAlphaNumeric(options.receiverId).toUpperCase(), 15);

  const headerSegments: string[] = [
    joinElements([
      "ISA",
      "00",
      padRight("", 10),
      "00",
      padRight("", 10),
      "ZZ",
      senderId,
      "ZZ",
      receiverId,
      formatDateShort(now),
      formatTime(now),
      "^",
      "00501",
      interchangeControlNumber,
      "1",
      usageIndicator,
      ":",
    ]),
    joinElements([
      "GS",
      "HC",
      senderId.trim(),
      receiverId.trim(),
      formatDate(now),
      formatTime(now),
      groupControlNumber,
      "X",
      "005010X222A1",
    ]),
  ];

  const transactionSegments: string[] = [
    joinElements(["ST", "837", transactionSetControlNumber, "005010X222A1"]),
    joinElements(["BHT", "0019", "00", transactionSetControlNumber, formatDate(now), formatTime(now), "CH"]),
  ];

  const billingProvider = claims[0].billingProvider;
  const submitterPhone = sanitizeAlphaNumeric(billingProvider.phone ?? "0000000000");
  transactionSegments.push(
    joinElements(["NM1", "41", "2", sanitizeText(billingProvider.organizationName ?? ""), "", "", "", "", "46", senderId.trim() || "SENDER"]),
  );
  transactionSegments.push(joinElements(["PER", "IC", sanitizeText(billingProvider.firstName ?? "Billing"), "TE", submitterPhone || "0000000000"]));
  transactionSegments.push(joinElements(["NM1", "40", "2", receiverId.trim() || "RECEIVER"]));

  let hlCounter = 1;
  transactionSegments.push(joinElements(["HL", hlCounter, "", "20", "1"]));
  transactionSegments.push(buildProviderNm1("85", claims[0]));
  transactionSegments.push(...buildAddressSegments("85", billingProvider));
  if (billingProvider.taxId) {
    transactionSegments.push(joinElements(["REF", "EI", sanitizeAlphaNumeric(billingProvider.taxId)]));
  }
  if (billingProvider.taxonomyCode) {
    transactionSegments.push(joinElements(["PRV", "BI", "PXC", sanitizeAlphaNumeric(billingProvider.taxonomyCode)]));
  }

  const claimControlNumbers: Record<string, string> = {};

  for (const [index, claim] of claims.entries()) {
    const subscriberHl = ++hlCounter;
    transactionSegments.push(joinElements(["HL", subscriberHl, "1", "22", "0"]));
    transactionSegments.push(buildSubscriberNm1(claim));
    transactionSegments.push(...buildAddressSegments("IL", claim.subscriber));

    if (claim.subscriber.relationship && claim.subscriber.relationship !== "self") {
      const relationshipCode = claim.subscriber.relationship === "spouse"
        ? "01"
        : claim.subscriber.relationship === "child"
          ? "19"
          : "34";
      transactionSegments.push(joinElements(["SBR", "S", relationshipCode, "", "", "", "", "", "CI"]));
    } else {
      transactionSegments.push(joinElements(["SBR", "P", "18", "", "", "", "", "", "CI"]));
    }

    const patientHl = ++hlCounter;
    transactionSegments.push(joinElements(["HL", patientHl, String(subscriberHl), "23", "0"]));
    transactionSegments.push(buildPatientNm1(claim));
    transactionSegments.push(...buildAddressSegments("QC", claim.patient));

    if (claim.patient.dateOfBirth) {
      transactionSegments.push(joinElements(["DMG", "D8", formatDate(new Date(claim.patient.dateOfBirth)), (claim.patient.gender || "U").toUpperCase()]));
    }

    transactionSegments.push(buildProviderNm1("82", claim));
    transactionSegments.push(...buildAddressSegments("82", claim.renderingProvider));

    const totalCharge = deriveTotalCharge(claim);
    const claimControl = ensureControlNumber(
      claim.billingRecord.claimNumber,
      transactionSetControlNumber,
      (index + 1).toString().padStart(4, "0"),
    );
    claimControlNumbers[claim.billingRecord.id] = claimControl;

    transactionSegments.push(
      joinElements([
        "CLM",
        claimControl,
        toCurrency(totalCharge),
        "",
        "",
        "11:B:1",
        "Y",
        "A",
        "Y",
        "I",
        "P",
        claim.placeOfServiceCode ?? "11",
      ]),
    );

    const diagnosisSegment = claim.diagnosisCodes
      .map((code, diagIndex) => `ABK${SUB_ELEMENT_SEPARATOR}${formatDiagnosisCode(code)}${diagIndex === 0 ? "" : ""}`)
      .slice(0, 12);
    if (diagnosisSegment.length > 0) {
      transactionSegments.push(joinElements(["HI", ...diagnosisSegment]));
    }

    transactionSegments.push(joinElements(["REF", "D9", claimControl]));

    claim.serviceLines.forEach((line, lineIndex) => {
      transactionSegments.push(...buildServiceLineSegment(claim, line, lineIndex));
    });
  }

  const seSegmentCount = transactionSegments.length + 1;
  transactionSegments.push(joinElements(["SE", seSegmentCount, transactionSetControlNumber]));

  const trailerSegments = [
    joinElements(["GE", "1", groupControlNumber]),
    joinElements(["IEA", "1", interchangeControlNumber]),
  ];

  const content = [...headerSegments, ...transactionSegments, ...trailerSegments].join(SEGMENT_TERMINATOR) + SEGMENT_TERMINATOR;

  return {
    content,
    interchangeControlNumber,
    groupControlNumber,
    transactionSetControlNumber,
    claimControlNumbers,
    createdAt: now.toISOString(),
  };
};

export const hashEdiContent = (content: string): string => checksum(content);
