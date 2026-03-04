import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import type { Json } from '../src/lib/generated/database.types';

dotenv.config({ path: path.resolve(process.cwd(), '.env.codex') });
dotenv.config();

const DEFAULT_PDF_PATH = 'D:\\downloads\\High_Desert_Clients_REBUILT_with_units.pdf';
const REPORT_PATH = path.resolve(process.cwd(), 'reports', 'high-desert-units-import-report.json');
const PARSER_VERSION = '1.0.0';
const TARGET_ORG_ID = '5238e88b-6198-4862-80a2-dbe15bbeabdd';
// MCP-assisted second-pass deterministic mappings for unresolved shorthand IDs.
const SECOND_PASS_OVERRIDES: Record<string, string> = {
  ATHA: '92132224-d05a-4f34-847a-517f504933cb',
  CAAR: '1c4ce922-3f46-4f48-9913-e0c0d1c49ec8',
  DAFE: '4823c8fa-ab51-441d-ba67-e1508a4f18c5',
  ERES: 'e3fef4c2-c155-41f4-9b87-2aec73ae00f7',
  ERCARME: 'f21a5c8d-a12d-4d78-b873-8656f059cd8d',
  ETHE: '4afab316-c9ef-48a3-872e-04cea32dfd05',
  EVSA: '79497934-d094-4120-904e-4dc14bfc774e',
  GIAR: '90c6c016-75ba-41d7-bf76-100739183d81',
  HAME: '06406c86-771c-41e0-a816-309d3d38b8ce',
  HEME: 'be26b68b-1e15-48eb-8e72-1ba5b768a7ad',
  ISLU: '3ed2a02e-3012-4123-8d5e-8edb7fd8cc76',
  JAMO: '770452f8-d809-49c2-8c70-dab2b4dbef26',
  JEKI: 'b2c542a0-7064-4485-90a1-92133dd203fd',
  JESCAB: 'bfd10232-4b7d-4111-82c1-89ded8fdb1c7',
  MABA: 'abbec34b-7cda-43f6-8a7f-4c6501aa4afe',
  MALO: 'b0b1c8ea-b171-4c9d-b4b0-1ea6a671708a',
  MACMA: 'b909128f-a71b-46de-b49c-03a3e94c285f',
  MACAAR: '4446eb1e-58a3-43c9-988f-90470c262561',
  MARAL: '2d23e74d-4485-48cf-bdd8-1bc3decd4016',
  MATFI: 'eb809f7a-c5e8-4fe4-a0c1-ee4be842460c',
  RYGI: 'ab44713e-5be7-42a6-ac05-7a5d8f475337',
  SALO: '11e1e63a-c2d4-4994-957f-70d2bdbed635',
  SEAP: '33ca66bb-886d-41a7-bf29-6f0356d6eeb5',
  SKSH: '72b954ad-d317-4a9e-be25-647084f96f6e',
  XAAV: '88edfd3d-c22b-4714-917a-7e077769f2e2',
  YVSO: '24e88b64-ad41-4270-ad0f-e7014fdde32a',
};

type Args = {
  pdf: string;
  apply: boolean;
  organizationId?: string;
};

type ServiceCode = 'H0032' | 'H0032_HO' | 'H2019' | 'S5111';

type ParsedServiceRow = {
  rawIdentifier: string;
  normalizedClientId: string;
  code: ServiceCode;
  units: number;
};

type AggregatedUnits = {
  normalizedClientId: string;
  sourceIdentifiers: string[];
  oneToOneUnits: number | null;
  supervisionUnits: number | null;
  authUnits: number | null;
  s5111Visits: number | null;
};

type ClientRecord = {
  id: string;
  organization_id: string;
  client_id: string | null;
  full_name: string;
  insurance_info: Json | null;
  auth_units: number | null;
  one_to_one_units: number | null;
  supervision_units: number | null;
};

type PlannedUpdate = {
  id: string;
  normalizedClientId: string;
  fullName: string;
  organizationId: string;
  update: {
    insurance_info: Json;
    auth_units?: number;
    one_to_one_units?: number;
    supervision_units?: number;
  };
};

const parseArgs = (argv: string[]): Args => {
  const args = new Map<string, string | boolean>();
  argv.forEach((arg, index) => {
    if (!arg.startsWith('--')) {
      return;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      args.set(arg, true);
      return;
    }
    args.set(arg, value);
  });

  return {
    pdf: String(args.get('--pdf') ?? DEFAULT_PDF_PATH),
    apply: Boolean(args.get('--apply')),
    organizationId: typeof args.get('--organization-id') === 'string' ? String(args.get('--organization-id')) : undefined,
  };
};

const readPdfText = async (pdfPath: string): Promise<string> => {
  await fs.access(pdfPath);
  const pythonProgram = [
    'import json, sys',
    'from pypdf import PdfReader',
    "p = sys.argv[1]",
    "reader = PdfReader(p)",
    "text = '\\n'.join((page.extract_text() or '') for page in reader.pages)",
    'print(text)',
  ].join('\n');
  const result = spawnSync('python', ['-c', pythonProgram, pdfPath], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to parse PDF file: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
};

const normalizeClientId = (value: string): string => value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

const toSiblingFiveKey = (fullName: string): string | null => {
  const parts = fullName
    .split(/\s+/)
    .map(token => token.replace(/[^a-zA-Z]/g, ''))
    .filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const firstName = parts[0].toUpperCase();
  const lastName = parts[parts.length - 1].toUpperCase();
  const key = `${firstName.slice(0, 3)}${lastName.slice(0, 2)}`;
  return key.length === 5 ? key : null;
};

const normalizeIdentifierToClientId = (rawIdentifier: string): string => {
  const trimmed = rawIdentifier.trim();
  const beforeParen = trimmed.split('(')[0].trim();
  const firstToken = (beforeParen.split(/\s+/)[0] ?? '').trim();
  const firstSegment = (firstToken.split(/[-/]/)[0] ?? '').trim();
  const normalizedPrimary = normalizeClientId(firstSegment);
  if (normalizedPrimary.length > 0) {
    return normalizedPrimary;
  }
  const fallback = normalizeClientId(trimmed);
  return fallback.slice(0, 8);
};

const parseServiceRows = (pdfText: string): ParsedServiceRow[] => {
  const stopText = 'Approved Hours Auth Start Date Auth End Date Approval Found';
  const serviceSection = pdfText.includes(stopText) ? pdfText.split(stopText)[0] : pdfText;
  const lines = serviceSection
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('-- '))
    .filter(line => line.toLowerCase() !== 'client identifier authorization type (fba / services) billing code approved units')
    .filter(line => !line.toLowerCase().startsWith('client template'));

  const rows: ParsedServiceRow[] = [];
  const pattern = /^(?<identifier>.+?)\s+Services\s+(?<code>H0032(?:\s*\(HO\))?|H2019|H2014|S5111)\s+(?<units>\d+(?:\.\d+)?)$/i;
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match?.groups) {
      continue;
    }
    const codeRaw = match.groups.code.replace(/\s+/g, '').toUpperCase();
    let code: ServiceCode;
    if (codeRaw === 'H0032(HO)') {
      code = 'H0032_HO';
    } else if (codeRaw === 'H0032') {
      code = 'H0032';
    } else if (codeRaw === 'S5111') {
      code = 'S5111';
    } else {
      code = 'H2019';
    }
    const units = Number.parseFloat(match.groups.units);
    if (!Number.isFinite(units)) {
      continue;
    }
    const rawIdentifier = match.groups.identifier.trim();
    const normalizedClientId = normalizeIdentifierToClientId(rawIdentifier);
    if (!normalizedClientId) {
      continue;
    }
    rows.push({
      rawIdentifier,
      normalizedClientId,
      code,
      units,
    });
  }
  return rows;
};

const aggregateRows = (rows: ParsedServiceRow[]): AggregatedUnits[] => {
  const byClient = new Map<string, AggregatedUnits>();
  for (const row of rows) {
    const existing = byClient.get(row.normalizedClientId) ?? {
      normalizedClientId: row.normalizedClientId,
      sourceIdentifiers: [],
      oneToOneUnits: null,
      supervisionUnits: null,
      authUnits: null,
      s5111Visits: null,
    };
    if (!existing.sourceIdentifiers.includes(row.rawIdentifier)) {
      existing.sourceIdentifiers.push(row.rawIdentifier);
    }
    if (row.code === 'H0032') {
      existing.oneToOneUnits = Math.max(existing.oneToOneUnits ?? 0, row.units);
    } else if (row.code === 'H0032_HO') {
      existing.supervisionUnits = Math.max(existing.supervisionUnits ?? 0, row.units);
    } else if (row.code === 'H2019') {
      existing.authUnits = Math.max(existing.authUnits ?? 0, row.units);
    } else if (row.code === 'S5111') {
      existing.s5111Visits = Math.max(existing.s5111Visits ?? 0, row.units);
    }
    byClient.set(row.normalizedClientId, existing);
  }
  return Array.from(byClient.values());
};

const detectOrganizationId = (
  rows: AggregatedUnits[],
  index: Map<string, ClientRecord[]>
): { organizationId: string; counts: Record<string, number> } => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const matches = index.get(row.normalizedClientId) ?? [];
    if (matches.length !== 1) {
      continue;
    }
    const orgId = matches[0].organization_id;
    counts.set(orgId, (counts.get(orgId) ?? 0) + 1);
  }
  if (counts.size === 0) {
    throw new Error('No unique client_id matches found for organization auto-detection.');
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
    throw new Error(`Organization auto-detection tie: ${sorted[0][0]} and ${sorted[1][0]} (matches=${sorted[0][1]}).`);
  }
  return {
    organizationId: sorted[0][0],
    counts: Object.fromEntries(sorted),
  };
};

const asRecord = (value: Json | null): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const toIntUnits = (value: number): number => Math.round(value);

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  }

  const pdfText = await readPdfText(args.pdf);
  const parsedRows = parseServiceRows(pdfText);
  const aggregated = aggregateRows(parsedRows);

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, organization_id, client_id, full_name, insurance_info, auth_units, one_to_one_units, supervision_units');
  if (clientsError) {
    throw clientsError;
  }

  const index = new Map<string, ClientRecord[]>();
  const clientsById = new Map<string, ClientRecord>();
  clients.forEach(client => {
    clientsById.set(client.id, client);
    const key = normalizeClientId(client.client_id ?? '');
    if (!key) {
      return;
    }
    const existing = index.get(key) ?? [];
    if (!existing.some(entry => entry.id === client.id)) {
      existing.push(client);
    }
    index.set(key, existing);
  });

  const detection = args.organizationId
    ? { organizationId: args.organizationId, counts: { [args.organizationId]: -1 } }
    : detectOrganizationId(aggregated, index);
  const targetOrg = detection.organizationId || TARGET_ORG_ID;
  const targetOrgClients = clients.filter(client => client.organization_id === targetOrg);

  const matchedRows: Array<{ normalizedClientId: string; clientRecordId: string; fullName: string }> = [];
  const unmatchedRows: Array<{ normalizedClientId: string; sourceIdentifiers: string[] }> = [];
  const ambiguousRows: Array<{ normalizedClientId: string; sourceIdentifiers: string[]; candidateClientIds: string[] }> = [];
  const plannedUpdates: PlannedUpdate[] = [];

  for (const row of aggregated) {
    const overrideId = SECOND_PASS_OVERRIDES[row.normalizedClientId];
    const overrideClient = overrideId ? clientsById.get(overrideId) : undefined;
    const exactCandidates = (index.get(row.normalizedClientId) ?? []).filter(client => client.organization_id === targetOrg);
    const prefixCandidates =
      exactCandidates.length > 0
        ? exactCandidates
        : targetOrgClients.filter(client => {
            const key = normalizeClientId(client.client_id ?? '');
            if (!key) {
              return false;
            }
            return key.startsWith(row.normalizedClientId) || row.normalizedClientId.startsWith(key);
          });
    const siblingFiveKeyCandidates =
      prefixCandidates.length > 0 || row.normalizedClientId.length !== 5
        ? []
        : targetOrgClients.filter(client => toSiblingFiveKey(client.full_name) === row.normalizedClientId);
    const candidates =
      overrideClient && overrideClient.organization_id === targetOrg
        ? [overrideClient]
        : prefixCandidates.length > 0
          ? prefixCandidates
          : siblingFiveKeyCandidates;
    if (candidates.length === 0) {
      unmatchedRows.push({
        normalizedClientId: row.normalizedClientId,
        sourceIdentifiers: row.sourceIdentifiers,
      });
      continue;
    }
    if (candidates.length > 1) {
      ambiguousRows.push({
        normalizedClientId: row.normalizedClientId,
        sourceIdentifiers: row.sourceIdentifiers,
        candidateClientIds: candidates.map(item => item.id),
      });
      continue;
    }

    const client = candidates[0];
    matchedRows.push({
      normalizedClientId: row.normalizedClientId,
      clientRecordId: client.id,
      fullName: client.full_name,
    });

    const existingInsuranceInfo = asRecord(client.insurance_info);
    const importPayload = {
      source_file: path.basename(args.pdf),
      parser_version: PARSER_VERSION,
      imported_at: new Date().toISOString(),
      source_identifiers: row.sourceIdentifiers,
      parsed: {
        normalized_client_id: row.normalizedClientId,
        h0032_units: row.oneToOneUnits,
        ho_units: row.supervisionUnits,
        h2019_units: row.authUnits,
        s5111_visits: row.s5111Visits,
      },
    };
    const nextInsuranceInfo = {
      ...existingInsuranceInfo,
      high_desert_units_import: importPayload,
    };
    const updatePayload: PlannedUpdate['update'] = {
      insurance_info: nextInsuranceInfo as Json,
    };

    if (typeof row.oneToOneUnits === 'number' && Number.isFinite(row.oneToOneUnits)) {
      updatePayload.one_to_one_units = toIntUnits(row.oneToOneUnits);
    }
    if (typeof row.supervisionUnits === 'number' && Number.isFinite(row.supervisionUnits)) {
      updatePayload.supervision_units = toIntUnits(row.supervisionUnits);
    }
    if (typeof row.authUnits === 'number' && Number.isFinite(row.authUnits)) {
      updatePayload.auth_units = toIntUnits(row.authUnits);
    }

    const changedInsurance = JSON.stringify(client.insurance_info ?? null) !== JSON.stringify(nextInsuranceInfo);
    const changedAuthUnits = updatePayload.auth_units !== undefined && updatePayload.auth_units !== client.auth_units;
    const changedOneToOne =
      updatePayload.one_to_one_units !== undefined && updatePayload.one_to_one_units !== client.one_to_one_units;
    const changedSupervision =
      updatePayload.supervision_units !== undefined && updatePayload.supervision_units !== client.supervision_units;

    if (changedInsurance || changedAuthUnits || changedOneToOne || changedSupervision) {
      plannedUpdates.push({
        id: client.id,
        normalizedClientId: row.normalizedClientId,
        fullName: client.full_name,
        organizationId: client.organization_id,
        update: updatePayload,
      });
    }
  }

  if (args.apply && ambiguousRows.length > 0) {
    throw new Error(`Aborting apply: ${ambiguousRows.length} ambiguous client_id match(es) require manual resolution.`);
  }

  if (args.apply) {
    for (const update of plannedUpdates) {
      const { error } = await supabase.from('clients').update(update.update).eq('id', update.id).eq('organization_id', targetOrg);
      if (error) {
        throw error;
      }
    }
  }

  const report = {
    sourceFile: args.pdf,
    parserVersion: PARSER_VERSION,
    applied: args.apply,
    targetOrganizationId: targetOrg,
    organizationDetectionCounts: detection.counts,
    totals: {
      parsedServiceRows: parsedRows.length,
      parsedClients: aggregated.length,
      matched: matchedRows.length,
      unmatched: unmatchedRows.length,
      ambiguous: ambiguousRows.length,
      plannedUpdates: plannedUpdates.length,
    },
    unmatchedRows,
    ambiguousRows,
    updatePreview: plannedUpdates.slice(0, 50).map(update => ({
      normalizedClientId: update.normalizedClientId,
      clientId: update.id,
      fullName: update.fullName,
      update: update.update,
    })),
  };

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
