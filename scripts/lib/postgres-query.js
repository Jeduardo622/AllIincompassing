import { Client } from 'pg';

function getDatabaseUrl() {
  const directUrl =
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DATABASE_URL;

  if (!directUrl) {
    throw new Error(
      'Missing database connection string. Set SUPABASE_DB_URL or DATABASE_URL.',
    );
  }

  return directUrl;
}

function normalizeRows(rows) {
  return rows.map((row) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'bigint') {
        normalized[key] = Number(value);
      } else {
        normalized[key] = value;
      }
    }
    return normalized;
  });
}

async function runPostgresQuery(sql) {
  const client = new Client({ connectionString: getDatabaseUrl() });

  await client.connect();
  try {
    const result = await client.query(sql);
    return normalizeRows(result.rows);
  } finally {
    await client.end();
  }
}

export { runPostgresQuery };
