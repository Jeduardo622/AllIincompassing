import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import type { Json } from '../src/lib/generated/database.types';
import { normalizeNameKey, parseIehpApprovalRows } from '../src/lib/importIehpApprovals';

dotenv.config({ path: path.resolve(process.cwd(), '.env.codex') });
dotenv.config();

const DEFAULT_XLSX_PATH = 'D:\\downloads\\IEHP + CO approval amounts.xlsx';
const REPORT_PATH = path.resolve(process.cwd(), 'reports', 'iehp-co-approval-import-report.json');
const UNRESOLVED_REPORT_PATH = path.resolve(process.cwd(), 'reports', 'iehp-co-unresolved-recommendations.json');
const PARSER_VERSION = '1.0.0';
const TARGET_ORG_ID = '5238e88b-6198-4862-80a2-dbe15bbeabdd';

const SKIP_NAME_KEYS = new Set<string>(['co']);

// Deterministic row-level overrides derived from MCP-assisted review.
const ROW_CLIENT_OVERRIDES: Record<number, string> = {
  15: '84effcda-2706-4874-ae7e-e44ba7622b85',
  19: '41e752a6-877e-4142-94d6-92727fe53fd8',
  41: '4823c8fa-ab51-441d-ba67-e1508a4f18c5',
  51: '72bd1663-5343-4e79-8127-17aed338fdb4',
  71: 'b0b1c8ea-b171-4c9d-b4b0-1ea6a671708a',
  77: '2f460558-0bf7-4ff2-920f-d79571b76fb9',
  93: '539e3020-719a-4736-a245-468af1d3ebe5',
  99: '0abf01a6-fcfa-40d1-94e7-25b8f8609a4a',
  133: 'f1c9c9bc-db83-4970-90d7-83e7ffc22142',
  163: '459ac9bf-0f1e-4182-8840-b094916b4587',
  169: '06dcec13-e598-43c5-b287-a3c141047b7c',
  171: 'deca4c29-734a-4fd6-93f8-bbff41e8709a',
  174: '1e68d326-b62f-447c-9395-4895ed040e81',
  182: '78a1b198-7346-45da-89ee-47708f63f5f8',
  231: '7258f6a1-628b-4a9c-b083-4174882ca56e',
  241: 'b559cd24-30d9-42a2-a6c4-99672f295a05',
};

const AMBIGUOUS_RECOMMENDATIONS: Record<number, string> = {
  27: 'ed2ff251-e6e8-4b4b-8966-ccd7171f8a81',
  75: 'ad23cac4-d01e-4b45-8d04-6e50d4adeae5',
};

type Args = {
  input: string;
  apply: boolean;
  organizationId?: string;
};

type ClientRecord = {
  id: string;
  organization_id: string;
  client_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  insurance_info: Json | null;
  authorized_hours_per_month: number | null;
  auth_units: number | null;
  one_to_one_units: number | null;
  supervision_units: number | null;
};

type PlannedUpdate = {
  id: string;
  rowNumber: number;
  fullName: string;
  organizationId: string;
  update: {
    insurance_info: Json;
    authorized_hours_per_month?: number;
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
    input: String(args.get('--input') ?? args.get('--xlsx') ?? args.get('--pdf') ?? DEFAULT_XLSX_PATH),
    apply: Boolean(args.get('--apply')),
    organizationId: typeof args.get('--organization-id') === 'string' ? String(args.get('--organization-id')) : undefined,
  };
};

const readXlsxRows = async (xlsxPath: string): Promise<string[][]> => {
  await fs.access(xlsxPath);
  const pythonProgram = [
    'import json, sys, zipfile, xml.etree.ElementTree as ET',
    "p = sys.argv[1]",
    "ns = {'a':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}",
    'z = zipfile.ZipFile(p)',
    "wb = ET.fromstring(z.read('xl/workbook.xml'))",
    "sheet_nodes = wb.findall('a:sheets/a:sheet', ns)",
    "rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))",
    "relmap = {rel.attrib['Id']: rel.attrib['Target'] for rel in rels.findall('{http://schemas.openxmlformats.org/package/2006/relationships}Relationship')}",
    "first = sheet_nodes[0]",
    "rid = first.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']",
    "target = relmap[rid]",
    "sheet_path = ('xl/' + target).replace('xl/xl/', 'xl/')",
    'sst = []',
    "if 'xl/sharedStrings.xml' in z.namelist():",
    "    sroot = ET.fromstring(z.read('xl/sharedStrings.xml'))",
    "    for si in sroot.findall('a:si', ns):",
    "        sst.append(''.join((t.text or '') for t in si.findall('.//a:t', ns)))",
    'sh = ET.fromstring(z.read(sheet_path))',
    'rows = []',
    "for row in sh.findall('a:sheetData/a:row', ns):",
    '    vals = {}',
    '    max_idx = -1',
    "    for c in row.findall('a:c', ns):",
    "        ref = c.attrib.get('r', '')",
    "        letters = ''.join(ch for ch in ref if ch.isalpha())",
    '        idx = 0',
    '        for ch in letters:',
    '            idx = idx * 26 + (ord(ch.upper()) - 64)',
    '        idx = max(0, idx - 1)',
    '        max_idx = max(max_idx, idx)',
    "        cell_type = c.attrib.get('t', '')",
    "        val_node = c.find('a:v', ns)",
    "        if cell_type == 'inlineStr':",
    "            text_node = c.find('a:is/a:t', ns)",
    "            txt = text_node.text if text_node is not None and text_node.text is not None else ''",
    "        elif val_node is None:",
    "            txt = ''",
    "        else:",
    "            txt = val_node.text or ''",
    "            if cell_type == 's':",
    '                try:',
    '                    txt = sst[int(txt)]',
    '                except Exception:',
    '                    pass',
    '        vals[idx] = txt',
    '    if max_idx < 0:',
    '        rows.append([])',
    '    else:',
    "        rows.append([vals.get(i, '') for i in range(max_idx + 1)])",
    'print(json.dumps(rows, ensure_ascii=False))',
  ].join('\n');

  const result = spawnSync('python', ['-c', pythonProgram, xlsxPath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to parse XLSX file: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as string[][];
};

const readPdfRows = async (pdfPath: string): Promise<string[][]> => {
  await fs.access(pdfPath);
  const pythonProgram = [
    'import re, json, sys',
    'from pypdf import PdfReader',
    "p = sys.argv[1]",
    "reader = PdfReader(p)",
    "text = '\\n'.join((page.extract_text() or '') for page in reader.pages)",
    "text = re.sub(r'--\\s*\\d+\\s*of\\s*\\d+\\s*--', ' ', text, flags=re.I)",
    "text = re.sub(r'Client Name\\s*Client auth amount.*?Column 21', ' ', text, flags=re.I|re.S)",
    "text = re.sub(r'\\s+', ' ', text).strip()",
    "token_pat = r\"[A-Z][A-Za-z'’\\.-]*\"",
    "name_pat = rf\"{token_pat}(?:\\s+{token_pat})*,\\s*{token_pat}(?:\\s+{token_pat})*\"",
    "row_pat = re.compile(rf'(?P<name>{name_pat})\\s*1to1\\s*(?P<auth>\\d+(?:\\.\\d+)?\\s*hrs?)\\s*PC and Sup\\s*(?P<svc>.*?)(?=(?:{name_pat}\\s*1to1\\s*\\d)|$)', re.I)",
    "rows = [[\"Client Name\",\"Client auth amount\",\"APPROVED HR\",\"IEHP\",\"PROVIDER AND INSURANCE\",\"Client Location\",\"Staff Needed to Staff/Maximize 1:1 Services\"]]",
    "for m in row_pat.finditer(text):",
    "    name_raw = m.group('name').strip()",
    "    clean_name_match = re.search(rf'({name_pat})$', name_raw)",
    "    name = clean_name_match.group(1) if clean_name_match else name_raw",
    "    auth = m.group('auth').strip()",
    "    svc = m.group('svc').strip()",
    "    rows.append([name, '1to1', auth, 'PC and Sup', svc, '', ''])",
    "print(json.dumps(rows, ensure_ascii=False))",
  ].join('\n');

  const result = spawnSync('python', ['-c', pythonProgram, pdfPath], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to parse PDF file: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as string[][];
};

const normalizeClientName = (client: ClientRecord): string => {
  const fromParts = `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim();
  const source = fromParts.length > 0 ? fromParts : client.full_name;
  return normalizeNameKey(source);
};

const getClientKeys = (client: ClientRecord): string[] => {
  const keys = new Set<string>();
  const fullNameKey = normalizeNameKey(client.full_name);
  const firstLastKey = normalizeClientName(client);
  if (fullNameKey) {
    keys.add(fullNameKey);
  }
  if (firstLastKey) {
    keys.add(firstLastKey);
  }
  return Array.from(keys);
};

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

const detectOrganizationId = (
  scopedRows: Array<{ rowNumber: number; nameKey: string }>,
  index: Map<string, ClientRecord[]>
): { organizationId: string; counts: Record<string, number> } => {
  const counts = new Map<string, number>();
  for (const row of scopedRows) {
    const matches = index.get(row.nameKey) ?? [];
    if (matches.length !== 1) {
      continue;
    }
    const orgId = matches[0].organization_id;
    counts.set(orgId, (counts.get(orgId) ?? 0) + 1);
  }

  if (counts.size === 0) {
    throw new Error('No unique client matches found for organization auto-detection.');
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
    throw new Error(
      `Organization auto-detection tie: ${sorted[0][0]} (${sorted[0][1]}) and ${sorted[1][0]} (${sorted[1][1]}).`
    );
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

  const inputExtension = path.extname(args.input).toLowerCase();
  const rowMatrix = inputExtension === '.pdf' ? await readPdfRows(args.input) : await readXlsxRows(args.input);
  const parsedRows = parseIehpApprovalRows(rowMatrix);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select(
      'id, organization_id, client_id, first_name, last_name, full_name, insurance_info, authorized_hours_per_month, auth_units, one_to_one_units, supervision_units'
    );
  if (clientsError) {
    throw clientsError;
  }

  const index = new Map<string, ClientRecord[]>();
  const clientsById = new Map<string, ClientRecord>();
  clients.forEach(client => {
    clientsById.set(client.id, client);
    const keys = getClientKeys(client);
    keys.forEach(key => {
      const existing = index.get(key) ?? [];
      if (!existing.some(entry => entry.id === client.id)) {
        existing.push(client);
      }
      index.set(key, existing);
    });
  });

  const minimalRows = parsedRows.map(row => ({ rowNumber: row.rowNumber, nameKey: row.nameKey }));
  const detection = args.organizationId
    ? { organizationId: args.organizationId, counts: { [args.organizationId]: -1 } }
    : detectOrganizationId(minimalRows, index);

  const targetOrg = detection.organizationId;
  const targetOrgClients = clients.filter(client => client.organization_id === targetOrg);
  const matchedRows: Array<{ rowNumber: number; clientId: string; fullName: string }> = [];
  const unmatchedRows: Array<{ rowNumber: number; clientName: string }> = [];
  const ambiguousRows: Array<{ rowNumber: number; clientName: string; candidateClientIds: string[] }> = [];
  const skippedRows: Array<{ rowNumber: number; clientName: string; reason: string }> = [];
  const plannedUpdates: PlannedUpdate[] = [];
  const warningsByRow: Record<string, string[]> = {};
  type ClientAccumulator = {
    client: ClientRecord;
    sourceRows: ParsedApprovalRow[];
    maxAuthorizedHours: number | null;
    maxH0032Hours: number | null;
    maxHoHours: number | null;
    maxS5111Visits: number | null;
  };
  const mergedByClientId = new Map<string, ClientAccumulator>();

  const toMaxOrCurrent = (current: number | null, next: number | null): number | null => {
    if (typeof next !== 'number' || !Number.isFinite(next)) {
      return current;
    }
    if (current === null) {
      return next;
    }
    return Math.max(current, next);
  };

  for (const row of parsedRows) {
    if (SKIP_NAME_KEYS.has(row.nameKey)) {
      skippedRows.push({
        rowNumber: row.rowNumber,
        clientName: row.clientNameRaw,
        reason: 'Non-client context row',
      });
      continue;
    }

    const overrideClientId = ROW_CLIENT_OVERRIDES[row.rowNumber];
    const overrideClient = overrideClientId ? clientsById.get(overrideClientId) : undefined;
    const namedCandidates = (index.get(row.nameKey) ?? []).filter(client => client.organization_id === targetOrg);
    const siblingKey = toSiblingFiveKey(row.fullName);
    const siblingCandidates =
      namedCandidates.length > 0 || !siblingKey
        ? []
        : targetOrgClients.filter(client => toSiblingFiveKey(client.full_name) === siblingKey);
    const candidates =
      overrideClient && overrideClient.organization_id === targetOrg
        ? [overrideClient]
        : namedCandidates.length > 0
          ? namedCandidates
          : siblingCandidates;
    if (candidates.length === 0) {
      unmatchedRows.push({ rowNumber: row.rowNumber, clientName: row.clientNameRaw });
      continue;
    }
    if (candidates.length > 1) {
      ambiguousRows.push({
        rowNumber: row.rowNumber,
        clientName: row.clientNameRaw,
        candidateClientIds: candidates.map(item => item.id),
      });
      continue;
    }

    const client = candidates[0];
    matchedRows.push({ rowNumber: row.rowNumber, clientId: client.id, fullName: row.fullName });
    const existingAccumulator = mergedByClientId.get(client.id);
    if (!existingAccumulator) {
      mergedByClientId.set(client.id, {
        client,
        sourceRows: [row],
        maxAuthorizedHours: toMaxOrCurrent(null, row.authorizedHoursPerMonth),
        maxH0032Hours: toMaxOrCurrent(null, row.serviceBreakdown.h0032Hours),
        maxHoHours: toMaxOrCurrent(null, row.serviceBreakdown.hoHours),
        maxS5111Visits: toMaxOrCurrent(null, row.serviceBreakdown.s5111Visits),
      });
    } else {
      existingAccumulator.sourceRows.push(row);
      existingAccumulator.maxAuthorizedHours = toMaxOrCurrent(existingAccumulator.maxAuthorizedHours, row.authorizedHoursPerMonth);
      existingAccumulator.maxH0032Hours = toMaxOrCurrent(existingAccumulator.maxH0032Hours, row.serviceBreakdown.h0032Hours);
      existingAccumulator.maxHoHours = toMaxOrCurrent(existingAccumulator.maxHoHours, row.serviceBreakdown.hoHours);
      existingAccumulator.maxS5111Visits = toMaxOrCurrent(existingAccumulator.maxS5111Visits, row.serviceBreakdown.s5111Visits);
    }

    if (row.warnings.length > 0) {
      warningsByRow[String(row.rowNumber)] = row.warnings;
    }
  }

  if (args.apply && ambiguousRows.length > 0) {
    throw new Error(`Aborting apply: ${ambiguousRows.length} ambiguous row(s) require manual resolution.`);
  }

  for (const accumulator of mergedByClientId.values()) {
    const client = accumulator.client;
    const sourceRows = accumulator.sourceRows
      .slice()
      .sort((a, b) => a.rowNumber - b.rowNumber)
      .map(sourceRow => ({
        row_number: sourceRow.rowNumber,
        raw: {
          client_name: sourceRow.clientNameRaw,
          auth_type: sourceRow.authType,
          auth_amount: sourceRow.authAmountRaw,
          iehp_label: sourceRow.iehpLabel,
          iehp_text: sourceRow.iehpRaw,
          location: sourceRow.location,
          staffing_notes: sourceRow.staffingNotes,
          match_override: ROW_CLIENT_OVERRIDES[sourceRow.rowNumber] ?? null,
        },
        parsed: {
          full_name: sourceRow.fullName,
          authorized_hours_per_month: sourceRow.authorizedHoursPerMonth,
          h0032_hours: sourceRow.serviceBreakdown.h0032Hours,
          ho_hours: sourceRow.serviceBreakdown.hoHours,
          s5111_visits: sourceRow.serviceBreakdown.s5111Visits,
        },
      }));

    const importPayload = {
      source_file: path.basename(args.input),
      source_type: inputExtension === '.pdf' ? 'pdf' : 'xlsx',
      parser_version: PARSER_VERSION,
      imported_at: new Date().toISOString(),
      source_rows: sourceRows,
      parsed: {
        full_name: sourceRows[0]?.parsed.full_name ?? client.full_name,
        authorized_hours_per_month: accumulator.maxAuthorizedHours,
        h0032_hours: accumulator.maxH0032Hours,
        ho_hours: accumulator.maxHoHours,
        s5111_visits: accumulator.maxS5111Visits,
      },
    };

    const existingInsuranceInfo = asRecord(client.insurance_info);
    const nextInsuranceInfo = {
      ...existingInsuranceInfo,
      iehp_co_approval: importPayload,
    };
    const updatePayload: PlannedUpdate['update'] = {
      insurance_info: nextInsuranceInfo as Json,
    };

    if (typeof accumulator.maxAuthorizedHours === 'number' && Number.isFinite(accumulator.maxAuthorizedHours)) {
      updatePayload.authorized_hours_per_month = toIntUnits(accumulator.maxAuthorizedHours);
      updatePayload.auth_units = toIntUnits(accumulator.maxAuthorizedHours);
    }
    if (typeof accumulator.maxH0032Hours === 'number' && Number.isFinite(accumulator.maxH0032Hours)) {
      updatePayload.one_to_one_units = toIntUnits(accumulator.maxH0032Hours);
    }
    if (typeof accumulator.maxHoHours === 'number' && Number.isFinite(accumulator.maxHoHours)) {
      updatePayload.supervision_units = toIntUnits(accumulator.maxHoHours);
    }

    const changedInsurance = JSON.stringify(client.insurance_info ?? null) !== JSON.stringify(nextInsuranceInfo);
    const changedHours =
      updatePayload.authorized_hours_per_month !== undefined &&
      updatePayload.authorized_hours_per_month !== client.authorized_hours_per_month;
    const changedAuthUnits = updatePayload.auth_units !== undefined && updatePayload.auth_units !== client.auth_units;
    const changedOneToOne =
      updatePayload.one_to_one_units !== undefined && updatePayload.one_to_one_units !== client.one_to_one_units;
    const changedSupervision =
      updatePayload.supervision_units !== undefined && updatePayload.supervision_units !== client.supervision_units;

    if (changedInsurance || changedHours || changedAuthUnits || changedOneToOne || changedSupervision) {
      const firstRowNumber = sourceRows[0]?.row_number ?? -1;
      plannedUpdates.push({
        id: client.id,
        rowNumber: firstRowNumber,
        fullName: client.full_name,
        organizationId: client.organization_id,
        update: updatePayload,
      });
    }
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
    sourceFile: args.input,
    sourceType: inputExtension === '.pdf' ? 'pdf' : 'xlsx',
    parserVersion: PARSER_VERSION,
    applied: args.apply,
    targetOrganizationId: targetOrg,
    organizationDetectionCounts: detection.counts,
    totals: {
      sourceRows: parsedRows.length,
      skipped: skippedRows.length,
      matched: matchedRows.length,
      unmatched: unmatchedRows.length,
      ambiguous: ambiguousRows.length,
      plannedUpdates: plannedUpdates.length,
      mergedClients: mergedByClientId.size,
    },
    skippedRows,
    unmatchedRows,
    ambiguousRows,
    warningsByRow,
    updatePreview: plannedUpdates.slice(0, 25).map(update => ({
      rowNumber: update.rowNumber,
      clientId: update.id,
      fullName: update.fullName,
      update: update.update,
    })),
  };

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  const unresolved = {
    sourceFile: args.input,
    targetOrganizationId: targetOrg,
    unresolvedCounts: {
      unmatched: unmatchedRows.length,
      ambiguous: ambiguousRows.length,
    },
    recommendedAmbiguousSelections: ambiguousRows
      .filter(row => AMBIGUOUS_RECOMMENDATIONS[row.rowNumber])
      .map(row => ({
        rowNumber: row.rowNumber,
        clientName: row.clientName,
        recommendedClientId: AMBIGUOUS_RECOMMENDATIONS[row.rowNumber],
        reason: 'Candidate has canonical short client_id and non-null normalized identifier history.',
      })),
    manualRequired: ambiguousRows
      .filter(row => !AMBIGUOUS_RECOMMENDATIONS[row.rowNumber])
      .map(row => ({
        rowNumber: row.rowNumber,
        clientName: row.clientName,
        candidateClientIds: row.candidateClientIds,
        reason: 'Duplicate records appear equally plausible; requires operator selection.',
      })),
    remainingUnmatched: unmatchedRows,
  };
  await fs.writeFile(UNRESOLVED_REPORT_PATH, JSON.stringify(unresolved, null, 2));

  console.log(JSON.stringify(report, null, 2));
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
