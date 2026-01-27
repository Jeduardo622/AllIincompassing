import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_INPUT_PATH = path.resolve(process.cwd(), 'tmp', 'client-availability-import.json');

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

const escapeSqlLiteral = (value: string): string => value.replace(/'/g, "''");

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = String(args.get('--input') ?? DEFAULT_INPUT_PATH);
  const offset = Number(args.get('--offset') ?? 0);
  const limit = Number(args.get('--limit') ?? 25);

  const raw = await fs.readFile(inputPath, 'utf8');
  const data = JSON.parse(raw) as Array<{ client_code: string; availability: Record<string, unknown> }>;

  const slice = data.slice(offset, offset + limit);
  const values = slice
    .map(entry => {
      const code = escapeSqlLiteral(entry.client_code);
      const availability = escapeSqlLiteral(JSON.stringify(entry.availability));
      return `('${code}', '${availability}'::jsonb)`;
    })
    .join(',\n');

  const sql = `WITH name_parts AS (
  SELECT
    id,
    organization_id,
    first_name,
    last_name,
    left(regexp_replace(first_name, '[^A-Za-z]', '', 'g'), 2) AS first_part,
    regexp_split_to_table(regexp_replace(last_name, '[^A-Za-z\\s-]', '', 'g'), '[\\s-]+') AS last_part
  FROM clients
  WHERE first_name IS NOT NULL AND last_name IS NOT NULL
),
computed AS (
  SELECT
    id,
    organization_id,
    upper(first_part || string_agg(left(last_part, 2), '')) AS computed_id
  FROM name_parts
  WHERE last_part <> ''
  GROUP BY id, organization_id, first_part
),
dupes AS (
  SELECT organization_id, computed_id
  FROM computed
  GROUP BY organization_id, computed_id
  HAVING count(*) > 1
),
payload(client_code, availability) AS (
  VALUES
${values}
)
UPDATE clients c
SET availability_hours = COALESCE(c.availability_hours, '{}'::jsonb) || payload.availability
FROM payload
WHERE c.client_id = payload.client_code
  AND NOT EXISTS (
    SELECT 1
    FROM dupes d
    WHERE d.organization_id = c.organization_id
      AND d.computed_id = c.client_id
  );`;

  console.log(sql);
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
