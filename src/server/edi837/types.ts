export type ClaimStatusCode = "pending" | "submitted" | "paid" | "rejected";

export interface EdiServiceLine {
  lineNumber: number;
  cptCode: string;
  modifiers: string[];
  units: number;
  chargeAmount: number;
  serviceDate: string;
  description?: string | null;
  billedMinutes?: number | null;
}

export interface EdiBillingRecordSummary {
  id: string;
  claimNumber: string;
  amount: number;
  status: ClaimStatusCode;
}

export interface EdiPatient {
  id: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  memberId?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  relationship?: "self" | "spouse" | "child" | "other";
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
}

export interface EdiProvider {
  id: string;
  organizationName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  npi?: string | null;
  taxonomyCode?: string | null;
  taxId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
}

export interface EdiClaim {
  sessionId: string;
  serviceDate: string;
  placeOfServiceCode?: string | null;
  diagnosisCodes: string[];
  subscriber: EdiPatient;
  patient: EdiPatient;
  billingProvider: EdiProvider;
  renderingProvider: EdiProvider;
  billingRecord: EdiBillingRecordSummary;
  serviceLines: EdiServiceLine[];
}

export interface EdiClaimStatusUpdate {
  billingRecordId: string;
  sessionId: string;
  status: ClaimStatusCode;
  exportFileId?: string;
  claimControlNumber?: string;
  notes?: string | null;
  effectiveAt: string;
}

export interface EdiExportFileRecord {
  id: string;
  createdAt: string;
  fileName: string;
  checksum: string;
  claimCount: number;
  interchangeControlNumber: string;
  groupControlNumber: string;
  transactionSetControlNumber: string;
}

export interface SaveEdiExportFileInput {
  content: string;
  fileName: string;
  interchangeControlNumber: string;
  groupControlNumber: string;
  transactionSetControlNumber: string;
  claimCount: number;
  checksum: string;
}

export interface ClaimDenialInput {
  billingRecordId: string;
  sessionId: string;
  denialCode: string;
  description?: string | null;
  payerControlNumber?: string | null;
  receivedAt: string;
}

export interface ClaimDenialRecord extends ClaimDenialInput {
  id: string;
  recordedAt: string;
}

export interface Edi837GeneratorOptions {
  senderId: string;
  receiverId: string;
  usageIndicator?: "T" | "P";
  interchangeControlNumber?: string;
  groupControlNumber?: string;
  transactionSetControlNumber?: string;
}

export interface Edi837Transaction {
  content: string;
  interchangeControlNumber: string;
  groupControlNumber: string;
  transactionSetControlNumber: string;
  claimControlNumbers: Record<string, string>;
  createdAt: string;
}

export interface Edi837Repository {
  loadPendingClaims(): Promise<EdiClaim[]>;
  saveExportFile(payload: SaveEdiExportFileInput): Promise<EdiExportFileRecord>;
  recordClaimStatuses(updates: EdiClaimStatusUpdate[]): Promise<void>;
  ingestClaimDenials(denials: ClaimDenialInput[]): Promise<ClaimDenialRecord[]>;
}
