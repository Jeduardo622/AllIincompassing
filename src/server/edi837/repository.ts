import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ClaimDenialInput,
  type ClaimDenialRecord,
  type ClaimStatusCode,
  type Edi837Repository,
  type EdiClaim,
  type EdiClaimStatusUpdate,
  type EdiExportFileRecord,
  type SaveEdiExportFileInput,
} from "./types";

interface BillingRecordRow {
  id: string;
  session_id: string;
  amount?: number | null;
  amount_due?: number | null;
  status: string;
  claim_number?: string | null;
  created_at: string;
  submitted_at?: string | null;
}

interface SessionRow {
  id: string;
  start_time: string;
  end_time?: string | null;
  place_of_service_code?: string | null;
  location_type?: string | null;
  therapist_id: string;
  client_id: string;
  therapist?: TherapistRow | null;
  client?: ClientRow | null;
}

interface TherapistRow {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  facility?: string | null;
  organization_name?: string | null;
  npi_number?: string | null;
  taxonomy_code?: string | null;
  tax_id?: string | null;
  ein?: string | null;
  phone?: string | null;
  street?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
}

interface ClientRow {
  id: string;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  cin_number?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  phone?: string | null;
  diagnosis?: string[] | null;
}

interface ServiceLineRow {
  id: string;
  session_id: string;
  line_number?: number | null;
  units?: number | null;
  rate?: number | string | null;
  billed_minutes?: number | null;
  notes?: string | null;
  cpt_code?: {
    code?: string | null;
    description?: string | null;
  } | null;
  modifiers?: Array<{
    position?: number | null;
    modifier?: {
      code?: string | null;
    } | null;
  }> | null;
}

interface Database {
  public: {
    Tables: {
      billing_records: { Row: BillingRecordRow };
      sessions: { Row: SessionRow };
      therapists: { Row: TherapistRow };
      clients: { Row: ClientRow };
      session_cpt_entries: { Row: ServiceLineRow };
      edi_export_files: { Row: EdiExportFileRow; Insert: EdiExportFileInsert };
      edi_claim_statuses: { Row: unknown; Insert: EdiClaimStatusInsert };
      edi_claim_denials: { Row: EdiClaimDenialRow; Insert: EdiClaimDenialInsert };
    };
  };
}

interface EdiExportFileRow {
  id: string;
  created_at: string;
  file_name: string;
  content?: string;
  checksum: string;
  claim_count: number;
  interchange_control_number: string;
  group_control_number: string;
  transaction_set_control_number: string;
}

interface EdiExportFileInsert {
  file_name: string;
  content: string;
  checksum: string;
  claim_count: number;
  interchange_control_number: string;
  group_control_number: string;
  transaction_set_control_number: string;
}

interface EdiClaimStatusInsert {
  billing_record_id: string;
  session_id: string;
  status: string;
  export_file_id?: string | null;
  claim_control_number?: string | null;
  notes?: string | null;
  effective_at: string;
}

interface EdiClaimDenialRow {
  id: string;
  billing_record_id: string;
  session_id: string;
  denial_code: string;
  description?: string | null;
  payer_control_number?: string | null;
  received_at: string;
  recorded_at: string;
}

interface EdiClaimDenialInsert {
  billing_record_id: string;
  session_id: string;
  denial_code: string;
  description?: string | null;
  payer_control_number?: string | null;
  received_at: string;
}

const isClaimStatusCode = (value: string | undefined | null): value is ClaimStatusCode => {
  if (!value) {
    return false;
  }
  return value === "pending" || value === "submitted" || value === "paid" || value === "rejected";
};

const resolvePlaceOfServiceCode = (session: SessionRow): string => {
  if (session.place_of_service_code) {
    return session.place_of_service_code;
  }
  const normalized = (session.location_type ?? "").toLowerCase();
  if (normalized.includes("home")) {
    return "12";
  }
  if (normalized.includes("school")) {
    return "03";
  }
  if (normalized.includes("tele")) {
    return "02";
  }
  return "11";
};

const toEdiProvider = (therapist: TherapistRow | null | undefined): EdiClaim["billingProvider"] => ({
  id: therapist?.id ?? "UNKNOWN",
  organizationName: therapist?.facility ?? therapist?.organization_name ?? null,
  firstName: therapist?.first_name ?? null,
  lastName: therapist?.last_name ?? null,
  npi: therapist?.npi_number ?? null,
  taxonomyCode: therapist?.taxonomy_code ?? null,
  taxId: therapist?.tax_id ?? therapist?.ein ?? null,
  addressLine1: therapist?.street ?? null,
  addressLine2: therapist?.address_line2 ?? null,
  city: therapist?.city ?? null,
  state: therapist?.state ?? null,
  postalCode: therapist?.zip_code ?? null,
  phone: therapist?.phone ?? null,
});

const toEdiPatient = (client: ClientRow | null | undefined): EdiClaim["patient"] => ({
  id: client?.id ?? "UNKNOWN",
  firstName: client?.first_name ?? "Unknown",
  middleName: client?.middle_name ?? null,
  lastName: client?.last_name ?? "Unknown",
  memberId: client?.cin_number ?? client?.id ?? null,
  dateOfBirth: client?.date_of_birth ?? null,
  gender: client?.gender ?? null,
  relationship: "self",
  addressLine1: client?.address_line1 ?? null,
  addressLine2: client?.address_line2 ?? null,
  city: client?.city ?? null,
  state: client?.state ?? null,
  postalCode: client?.zip_code ?? null,
  phone: client?.phone ?? null,
});

const computeLineCharge = (row: ServiceLineRow): number => {
  const units = row.units && Number.isFinite(row.units) ? Number(row.units) : 1;
  const rawRate = typeof row.rate === "string" ? Number(row.rate) : row.rate ?? 0;
  const rate = Number.isFinite(rawRate) ? Number(rawRate) : 0;
  if (rate === 0) {
    return 0;
  }
  return Number((rate * units).toFixed(2));
};

const toEdiClaim = (
  billingRow: BillingRecordRow,
  sessionRow: SessionRow | undefined,
  serviceLines: ServiceLineRow[],
): EdiClaim | null => {
  if (!sessionRow) {
    return null;
  }
  const patient = toEdiPatient(sessionRow.client ?? null);
  const provider = toEdiProvider(sessionRow.therapist ?? null);
  const diagnosisCodes = Array.isArray(sessionRow.client?.diagnosis)
    ? sessionRow.client?.diagnosis.filter((code): code is string => typeof code === "string" && code.length > 0)
    : [];

  const ediServiceLines = serviceLines
    .filter((line) => line.session_id === sessionRow.id)
    .map((line, index) => ({
      lineNumber: line.line_number ?? index + 1,
      cptCode: line.cpt_code?.code?.trim() ?? "",
      modifiers:
        line.modifiers
          ?.slice()
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((modifier) => modifier.modifier?.code ?? "") ?? [],
      units: line.units && Number.isFinite(line.units) ? Number(line.units) : 1,
      chargeAmount: computeLineCharge(line),
      description: line.cpt_code?.description ?? line.notes ?? null,
      billedMinutes: line.billed_minutes ?? null,
      serviceDate: sessionRow.start_time,
    }))
    .filter((line) => line.cptCode.length > 0);

  if (ediServiceLines.length === 0) {
    return null;
  }

  const billingAmount =
    Number(billingRow.amount ?? billingRow.amount_due ?? ediServiceLines.reduce((sum, line) => sum + line.chargeAmount, 0)) || 0;

  return {
    sessionId: sessionRow.id,
    serviceDate: sessionRow.start_time,
    placeOfServiceCode: resolvePlaceOfServiceCode(sessionRow),
    diagnosisCodes: diagnosisCodes.length > 0 ? diagnosisCodes : ["F840"],
    subscriber: { ...patient },
    patient,
    billingProvider: provider,
    renderingProvider: provider,
    billingRecord: {
      id: billingRow.id,
      claimNumber: billingRow.claim_number ?? billingRow.id,
      amount: billingAmount,
      status: isClaimStatusCode(billingRow.status) ? billingRow.status : "pending",
    },
    serviceLines: ediServiceLines,
  };
};

const mapBySessionId = <T extends { session_id: string }>(rows: T[]): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  rows.forEach((row) => {
    const existing = map.get(row.session_id) ?? [];
    existing.push(row);
    map.set(row.session_id, existing);
  });
  return map;
};

export const createSupabaseEdi837Repository = (
  client: SupabaseClient<Database>,
): Edi837Repository => {
  const loadPendingClaims = async (): Promise<EdiClaim[]> => {
    const { data: billingRows, error: billingError } = await client
      .from("billing_records")
      .select("id, session_id, amount, amount_due, status, claim_number, created_at")
      .eq("status", "pending");

    if (billingError) {
      throw new Error(`Failed to load billing records: ${billingError.message}`);
    }

    if (!billingRows || billingRows.length === 0) {
      return [];
    }

    const sessionIds = [...new Set(billingRows.map((row) => row.session_id).filter((id): id is string => typeof id === "string"))];
    if (sessionIds.length === 0) {
      return [];
    }

    const { data: sessionRows, error: sessionError } = await client
      .from("sessions")
      .select(
        "id, start_time, end_time, place_of_service_code, location_type, therapist_id, client_id, therapist:therapists(*), client:clients(*)",
      )
      .in("id", sessionIds);

    if (sessionError) {
      throw new Error(`Failed to load sessions: ${sessionError.message}`);
    }

    const { data: serviceRows, error: serviceError } = await client
      .from("session_cpt_entries")
      .select(
        "id, session_id, line_number, units, rate, billed_minutes, notes, cpt_code:cpt_codes(code, description), modifiers:session_cpt_modifiers(position, modifier:billing_modifiers(code))",
      )
      .in("session_id", sessionIds)
      .order("line_number", { ascending: true });

    if (serviceError) {
      throw new Error(`Failed to load session CPT entries: ${serviceError.message}`);
    }

    const sessionMap = new Map((sessionRows ?? []).map((row) => [row.id, row] as const));
    const serviceMap = mapBySessionId(serviceRows ?? []);

    const claims = billingRows
      .map((row) => toEdiClaim(row, sessionMap.get(row.session_id), serviceMap.get(row.session_id) ?? []))
      .filter((claim): claim is EdiClaim => Boolean(claim));

    return claims;
  };

  const saveExportFile = async (payload: SaveEdiExportFileInput): Promise<EdiExportFileRecord> => {
    const { data, error } = await client
      .from("edi_export_files")
      .insert({
        file_name: payload.fileName,
        content: payload.content,
        checksum: payload.checksum,
        claim_count: payload.claimCount,
        interchange_control_number: payload.interchangeControlNumber,
        group_control_number: payload.groupControlNumber,
        transaction_set_control_number: payload.transactionSetControlNumber,
      })
      .select("id, created_at, file_name, checksum, claim_count, interchange_control_number, group_control_number, transaction_set_control_number")
      .single();

    if (error) {
      throw new Error(`Failed to persist EDI export file: ${error.message}`);
    }

    return {
      id: data.id,
      createdAt: data.created_at,
      fileName: data.file_name,
      checksum: data.checksum,
      claimCount: data.claim_count,
      interchangeControlNumber: data.interchange_control_number,
      groupControlNumber: data.group_control_number,
      transactionSetControlNumber: data.transaction_set_control_number,
    };
  };

  const recordClaimStatuses = async (updates: EdiClaimStatusUpdate[]): Promise<void> => {
    if (updates.length === 0) {
      return;
    }

    const inserts: EdiClaimStatusInsert[] = updates.map((update) => ({
      billing_record_id: update.billingRecordId,
      session_id: update.sessionId,
      status: update.status,
      export_file_id: update.exportFileId ?? null,
      claim_control_number: update.claimControlNumber ?? null,
      notes: update.notes ?? null,
      effective_at: update.effectiveAt,
    }));

    const { error } = await client.from("edi_claim_statuses").insert(inserts);
    if (error) {
      throw new Error(`Failed to record claim statuses: ${error.message}`);
    }

    for (const update of updates) {
      const payload: Record<string, unknown> = {
        status: update.status,
      };
      if (update.claimControlNumber) {
        payload.claim_number = update.claimControlNumber;
      }
      if (update.status === "submitted") {
        payload.submitted_at = update.effectiveAt;
      }
      const { error: updateError } = await client
        .from("billing_records")
        .update(payload)
        .eq("id", update.billingRecordId);
      if (updateError) {
        throw new Error(`Failed to update billing record ${update.billingRecordId}: ${updateError.message}`);
      }
    }
  };

  const ingestClaimDenials = async (denials: ClaimDenialInput[]): Promise<ClaimDenialRecord[]> => {
    if (denials.length === 0) {
      return [];
    }

    const { data, error } = await client
      .from("edi_claim_denials")
      .insert(
        denials.map((denial) => ({
          billing_record_id: denial.billingRecordId,
          session_id: denial.sessionId,
          denial_code: denial.denialCode,
          description: denial.description ?? null,
          payer_control_number: denial.payerControlNumber ?? null,
          received_at: denial.receivedAt,
        })),
      )
      .select("id, billing_record_id, session_id, denial_code, description, payer_control_number, received_at, recorded_at");

    if (error) {
      throw new Error(`Failed to store claim denials: ${error.message}`);
    }

    const records: ClaimDenialRecord[] = (data ?? []).map((row) => ({
      id: row.id,
      billingRecordId: row.billing_record_id,
      sessionId: row.session_id,
      denialCode: row.denial_code,
      description: row.description ?? null,
      payerControlNumber: row.payer_control_number ?? null,
      receivedAt: row.received_at,
      recordedAt: row.recorded_at,
    }));

    if (records.length > 0) {
      await client
        .from("billing_records")
        .update({ status: "rejected" })
        .in(
          "id",
          records.map((record) => record.billingRecordId),
        );
    }

    return records;
  };

  return {
    loadPendingClaims,
    saveExportFile,
    recordClaimStatuses,
    ingestClaimDenials,
  };
};

export class InMemoryEdi837Repository implements Edi837Repository {
  private readonly claims = new Map<string, EdiClaim>();

  private readonly exportFiles: EdiExportFileRecord[] = [];

  private readonly statusHistory: EdiClaimStatusUpdate[] = [];

  private readonly denialRecords: ClaimDenialRecord[] = [];

  constructor(initialClaims: EdiClaim[]) {
    initialClaims.forEach((claim) => {
      this.claims.set(claim.billingRecord.id, JSON.parse(JSON.stringify(claim)) as EdiClaim);
    });
  }

  async loadPendingClaims(): Promise<EdiClaim[]> {
    const pending = Array.from(this.claims.values()).filter((claim) => claim.billingRecord.status === "pending");
    return pending.map((claim) => JSON.parse(JSON.stringify(claim)) as EdiClaim);
  }

  async saveExportFile(payload: SaveEdiExportFileInput): Promise<EdiExportFileRecord> {
    const record: EdiExportFileRecord = {
      id: `file-${this.exportFiles.length + 1}`,
      createdAt: new Date().toISOString(),
      fileName: payload.fileName,
      checksum: payload.checksum,
      claimCount: payload.claimCount,
      interchangeControlNumber: payload.interchangeControlNumber,
      groupControlNumber: payload.groupControlNumber,
      transactionSetControlNumber: payload.transactionSetControlNumber,
    };
    this.exportFiles.push(record);
    return record;
  }

  async recordClaimStatuses(updates: EdiClaimStatusUpdate[]): Promise<void> {
    updates.forEach((update) => {
      this.statusHistory.push(update);
      const claim = this.claims.get(update.billingRecordId);
      if (claim) {
        claim.billingRecord.status = update.status;
        if (update.claimControlNumber) {
          claim.billingRecord.claimNumber = update.claimControlNumber;
        }
      }
    });
  }

  async ingestClaimDenials(denials: ClaimDenialInput[]): Promise<ClaimDenialRecord[]> {
    const records = denials.map((denial, index) => ({
      id: `denial-${this.denialRecords.length + index + 1}`,
      billingRecordId: denial.billingRecordId,
      sessionId: denial.sessionId,
      denialCode: denial.denialCode,
      description: denial.description ?? null,
      payerControlNumber: denial.payerControlNumber ?? null,
      receivedAt: denial.receivedAt,
      recordedAt: new Date().toISOString(),
    }));

    records.forEach((record) => {
      this.denialRecords.push(record);
      const claim = this.claims.get(record.billingRecordId);
      if (claim) {
        claim.billingRecord.status = "rejected";
      }
    });

    return records;
  }

  getExportFiles(): EdiExportFileRecord[] {
    return [...this.exportFiles];
  }

  getStatusHistory(): EdiClaimStatusUpdate[] {
    return [...this.statusHistory];
  }

  getDenials(): ClaimDenialRecord[] {
    return [...this.denialRecords];
  }
}
