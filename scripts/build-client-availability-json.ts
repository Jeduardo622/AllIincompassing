import fs from 'node:fs/promises';
import path from 'node:path';
import { parseAvailabilityCell, type AvailabilityDay } from '../src/lib/importClientAvailability';

type CsvRow = string[];
type ImportRow = {
  client_code: string;
  availability: Partial<Record<AvailabilityDay, { start: string; end: string }>>;
};

const DAYS: AvailabilityDay[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DEFAULT_CSV_PATH = path.resolve(process.cwd(), 'Client Eligliblity 2026 - Client Availability.csv');
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), 'tmp', 'client-availability-import.json');

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

const buildAvailability = (row: CsvRow, headerMap: Record<string, number>): ImportRow | null => {
  const clientIndex = headerMap.clients;
  if (clientIndex === undefined) {
    throw new Error('CSV missing required "Clients" column.');
  }

  const rawClientCode = row[clientIndex]?.trim();
  if (!rawClientCode) {
    return null;
  }

  const availability: Partial<Record<AvailabilityDay, { start: string; end: string }>> = {};

  DAYS.forEach(day => {
    const dayIndex = headerMap[day];
    if (dayIndex === undefined) {
      return;
    }
    const cellValue = row[dayIndex] ?? '';
    const parsed = parseAvailabilityCell(cellValue);
    if (!parsed) {
      return;
    }
    availability[day] = { start: parsed.start, end: parsed.end };
  });

  return {
    client_code: rawClientCode.toUpperCase(),
    availability,
  };
};

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

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const csvPath = String(args.get('--csv') ?? DEFAULT_CSV_PATH);
  const outputPath = String(args.get('--out') ?? DEFAULT_OUTPUT_PATH);

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

  const importRows = rows
    .slice(1)
    .map(row => buildAvailability(row, headerMap))
    .filter(Boolean) as ImportRow[];

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(importRows, null, 2));

  console.log(JSON.stringify({ rows: importRows.length, outputPath }, null, 2));
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
