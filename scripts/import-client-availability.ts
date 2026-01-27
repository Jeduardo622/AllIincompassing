import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  DEFAULT_AVAILABILITY_HOURS,
  parseAvailabilityCell,
  normalizeClientId,
  type AvailabilityHours,
  type AvailabilityDay,
} from '../src/lib/importClientAvailability';

dotenv.config({ path: path.resolve(process.cwd(), '.env.codex') });
dotenv.config();

type CsvRow = string[];
type ParsedCsvRow = {
  clientCode: string;
  availability: Partial<Record<AvailabilityDay, { start: string; end: string }>>;
  warnings: string[];
};

const DAYS: AvailabilityDay[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const DEFAULT_CSV_PATH = path.resolve(process.cwd(), 'Client Eligliblity 2026 - Client Availability.csv');

const parseArgs = (argv: string[]) => {
  const args = new Map<string, string | boolean>();
  argv.forEach((arg, index) => {
    if (arg.startsWith('--')) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        args.set(arg, true);
      } else {
        args.set(arg, value);
      }
    }
  });
  return args;
};

const parseCsv = (input: string): CsvRow[] => {
  const rows: CsvRow[] = [];
  let currentRow: string[] = [];
  let currentValue = '';
  let inQuotes = false;

  const pushValue = () => {
    currentRow.push(currentValue);
    currentValue = '';
  };

  const pushRow = () => {
    pushValue();
    rows.push(currentRow);
    currentRow = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === '"') {
      const nextChar = input[index + 1];
      if (inQuotes && nextChar === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      pushValue();
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && input[index + 1] === '\n') {
        index += 1;
      }
      if (currentRow.length > 0 || currentValue.length > 0) {
        pushRow();
      }
      continue;
    }

    currentValue += char;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    pushRow();
  }

  return rows;
};

const buildAvailability = (row: CsvRow, headerMap: Record<string, number>): ParsedCsvRow | null => {
  const clientIndex = headerMap.clients;
  if (clientIndex === undefined) {
    throw new Error('CSV missing required "Clients" column.');
  }

  const rawClientCode = row[clientIndex]?.trim();
  if (!rawClientCode) {
    return null;
  }

  const warnings: string[] = [];
  const availability: Partial<Record<AvailabilityDay, { start: string; end: string }>> = {};

  DAYS.forEach(day => {
    const dayIndex = headerMap[day];
    if (dayIndex === undefined) {
      return;
    }
    const cellValue = row[dayIndex] ?? '';
    const parsed = parseAvailabilityCell(cellValue);
    if (!parsed) {
      if (cellValue.trim()) {
        warnings.push(`Unparsed ${day} value "${cellValue.trim()}".`);
      }
      return;
    }
    availability[day] = { start: parsed.start, end: parsed.end };
    parsed.warnings.forEach(warning => warnings.push(`${day}: ${warning}`));
    if (parsed.heuristicsUsed) {
      warnings.push(`${day}: Heuristic parsing applied.`);
    }
  });

  return {
    clientCode: rawClientCode.toUpperCase(),
    availability,
    warnings,
  };
};

const mergeAvailability = (
  existing: AvailabilityHours | null,
  updates: Partial<Record<AvailabilityDay, { start: string; end: string }>>
): AvailabilityHours => {
  const base: AvailabilityHours = existing && typeof existing === 'object'
    ? { ...DEFAULT_AVAILABILITY_HOURS, ...(existing as AvailabilityHours) }
    : { ...DEFAULT_AVAILABILITY_HOURS };

  const merged = { ...base };
  DAYS.forEach(day => {
    const update = updates[day];
    if (update?.start && update?.end) {
      merged[day] = { start: update.start, end: update.end };
    }
  });
  return merged;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const csvPath = String(args.get('--csv') ?? DEFAULT_CSV_PATH);
  const organizationId = typeof args.get('--organization-id') === 'string'
    ? String(args.get('--organization-id'))
    : undefined;
  const apply = Boolean(args.get('--apply'));

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  }

  const csvText = await fs.readFile(csvPath, 'utf8');
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new Error('CSV file is empty.');
  }

  const headerRow = rows[0].map(cell => cell.trim().toLowerCase());
  const headerMap: Record<string, number> = {};
  headerRow.forEach((header, index) => {
    if (header === 'clients') {
      headerMap.clients = index;
    }
    if (DAYS.includes(header as AvailabilityDay)) {
      headerMap[header] = index;
    }
  });

  const parsedRows = rows.slice(1).map(row => buildAvailability(row, headerMap)).filter(Boolean) as ParsedCsvRow[];
  const availabilityByCode = new Map(parsedRows.map(entry => [entry.clientCode, entry]));

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const { data: clients, error: clientError } = await supabase
    .from('clients')
    .select('id, organization_id, first_name, last_name, full_name, client_id, availability_hours');

  if (clientError) {
    throw clientError;
  }

  const orgIds = Array.from(new Set(clients.map(client => client.organization_id).filter(Boolean)));
  if (!organizationId && orgIds.length > 1) {
    throw new Error(`Multiple organizations detected (${orgIds.join(', ')}). Provide --organization-id.`);
  }

  const scopedClients = organizationId
    ? clients.filter(client => client.organization_id === organizationId)
    : clients;

  const duplicateCheck = new Map<string, string[]>();
  const clientUpdates: Array<{ id: string; client_id: string }> = [];
  const availabilityUpdates: Array<{ id: string; availability_hours: AvailabilityHours }> = [];
  const warnings: Record<string, string[]> = {};

  scopedClients.forEach(client => {
    const firstName = client.first_name ?? client.full_name?.split(' ')[0] ?? null;
    const lastName = client.last_name ?? client.full_name?.split(' ').slice(1).join(' ') ?? null;
    const newClientId = normalizeClientId(firstName, lastName);

    if (newClientId) {
      const key = `${client.organization_id ?? 'unknown'}:${newClientId}`;
      const list = duplicateCheck.get(key) ?? [];
      list.push(client.id);
      duplicateCheck.set(key, list);

      if (client.client_id !== newClientId) {
        clientUpdates.push({ id: client.id, client_id: newClientId });
      }
    }

    const availabilityEntry = newClientId ? availabilityByCode.get(newClientId) : undefined;
    if (availabilityEntry) {
      const mergedAvailability = mergeAvailability(
        client.availability_hours as AvailabilityHours | null,
        availabilityEntry.availability
      );
      availabilityUpdates.push({ id: client.id, availability_hours: mergedAvailability });
      if (availabilityEntry.warnings.length > 0) {
        warnings[newClientId] = availabilityEntry.warnings;
      }
    }
  });

  const duplicateClientIds = Array.from(duplicateCheck.entries()).filter(([, ids]) => ids.length > 1);
  if (duplicateClientIds.length > 0) {
    throw new Error(
      `Duplicate client IDs detected after normalization: ${duplicateClientIds
        .map(([id, ids]) => `${id} (${ids.length})`)
        .join(', ')}`
    );
  }

  if (apply) {
    for (const update of clientUpdates) {
      const { error } = await supabase.from('clients').update({ client_id: update.client_id }).eq('id', update.id);
      if (error) {
        throw error;
      }
    }

    for (const update of availabilityUpdates) {
      const { error } = await supabase
        .from('clients')
        .update({ availability_hours: update.availability_hours })
        .eq('id', update.id);
      if (error) {
        throw error;
      }
    }
  }

  const report = {
    csvPath,
    organizationId: organizationId ?? (orgIds[0] ?? null),
    parsedRows: parsedRows.length,
    clientUpdates: clientUpdates.length,
    availabilityUpdates: availabilityUpdates.length,
    warnings,
    applied: apply,
  };

  const reportPath = path.resolve(process.cwd(), 'reports', 'client-availability-import-report.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
