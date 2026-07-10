import { Pool } from "pg";
import { pathToFileURL } from "node:url";

const FUNCTION_SIGNATURE = "public.start_session_with_goals(uuid, uuid, uuid, uuid[], timestamptz, uuid)";
const TABLE_GRANT_CONTRACT = {
  goal_domains: {
    anon: [],
    authenticated: ["INSERT", "SELECT", "UPDATE"],
    service_role: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  },
  user_therapist_links: {
    anon: [],
    authenticated: ["SELECT"],
    service_role: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  },
};

const REQUIRED_BODY_PATTERNS = [
  {
    pattern: /app\.current_user_has_exact_role_for_org/i,
    message: "start_session_with_goals must call app.current_user_has_exact_role_for_org",
  },
  {
    pattern: /public\.user_therapist_links/i,
    message: "start_session_with_goals must reference public.user_therapist_links",
  },
  {
    pattern: /join\s+public\.therapists\s+t\s+on\s+t\.id\s*=\s*utl\.therapist_id/i,
    message: "start_session_with_goals must join public.therapists through public.user_therapist_links",
  },
  {
    pattern: /t\.organization_id\s*=\s*v_session\.organization_id/i,
    message: "start_session_with_goals must require a same-org active therapist join through public.user_therapist_links",
  },
  {
    pattern: /t\.deleted_at\s+is\s+null/i,
    message: "start_session_with_goals must require a same-org active therapist join through public.user_therapist_links",
  },
  {
    pattern: /array\['admin',\s*'admin_schedule',\s*'midtier',\s*'bcba'\]::text\[\]/i,
    message: "start_session_with_goals must authorize admin/admin_schedule/midtier/bcba exact roles",
  },
  {
    pattern: /array\['therapist',\s*'bt'\]::text\[\]/i,
    message: "start_session_with_goals must authorize therapist/bt exact roles",
  },
];

const sortPrivileges = (privileges) => [...new Set(privileges.map((value) => value.toUpperCase()))].sort();

const samePrivileges = (actual, expected) =>
  JSON.stringify(sortPrivileges(actual)) === JSON.stringify(sortPrivileges(expected));

export const evaluateStartSessionRuntimeContract = ({
  functionDefinition,
  executeGrants,
  tableGrants,
}) => {
  const violations = [];
  const definition = String(functionDefinition ?? "");

  for (const { pattern, message } of REQUIRED_BODY_PATTERNS) {
    if (!pattern.test(definition)) {
      violations.push(message);
    }
  }

  if (executeGrants.anon !== false) {
    violations.push("start_session_with_goals EXECUTE must be denied to anon");
  }
  if (executeGrants.authenticated !== true || executeGrants.service_role !== true) {
    violations.push("start_session_with_goals EXECUTE must be granted only to authenticated and service_role");
  }

  for (const [tableName, expectedByRole] of Object.entries(TABLE_GRANT_CONTRACT)) {
    const actualByRole = tableGrants[tableName] ?? {};
    for (const [role, expectedPrivileges] of Object.entries(expectedByRole)) {
      const actualPrivileges = actualByRole[role] ?? [];
      if (!samePrivileges(actualPrivileges, expectedPrivileges)) {
        violations.push(
          `${tableName} grants must match the checked-in hardening migration for authenticated and service_role`,
        );
        break;
      }
    }
  }

  return { violations };
};

const fetchRuntimeContract = async ({ connectionString }) => {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 60_000,
    idleTimeoutMillis: 0,
  });

  const client = await pool.connect();
  try {
    const functionResult = await client.query(
      `
        select pg_get_functiondef($1::regprocedure) as function_definition
      `,
      [FUNCTION_SIGNATURE],
    );

    const executeResult = await client.query(
      `
        select
          has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon,
          has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as authenticated,
          has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') as service_role
      `,
      [FUNCTION_SIGNATURE],
    );

    const grantsResult = await client.query(
      `
        select table_name, grantee, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('goal_domains', 'user_therapist_links')
          and grantee in ('anon', 'authenticated', 'service_role')
      `,
    );

    const tableGrants = {
      goal_domains: {
        anon: [],
        authenticated: [],
        service_role: [],
      },
      user_therapist_links: {
        anon: [],
        authenticated: [],
        service_role: [],
      },
    };

    for (const row of grantsResult.rows) {
      const tableName = String(row.table_name ?? "");
      const grantee = String(row.grantee ?? "");
      const privilege = String(row.privilege_type ?? "").toUpperCase();
      if (!tableGrants[tableName]?.[grantee]) {
        continue;
      }
      tableGrants[tableName][grantee].push(privilege);
    }

    return {
      functionDefinition: String(functionResult.rows[0]?.function_definition ?? ""),
      executeGrants: {
        anon: Boolean(executeResult.rows[0]?.anon),
        authenticated: Boolean(executeResult.rows[0]?.authenticated),
        service_role: Boolean(executeResult.rows[0]?.service_role),
      },
      tableGrants,
    };
  } finally {
    client.release();
    await pool.end();
  }
};

const fail = (message) => {
  console.error(`❌ Start session runtime contract check failed: ${message}`);
  process.exit(1);
};

const run = async () => {
  const connectionString = process.env.SUPABASE_DB_URL ?? "";
  if (!connectionString.trim()) {
    fail("SUPABASE_DB_URL is required.");
  }

  const contract = await fetchRuntimeContract({ connectionString });
  const result = evaluateStartSessionRuntimeContract(contract);
  if (result.violations.length > 0) {
    fail(result.violations.join("; "));
  }

  console.log("Start session runtime contract check passed.");
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
