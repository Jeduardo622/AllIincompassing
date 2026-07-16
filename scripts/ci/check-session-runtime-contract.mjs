import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const FUNCTION_SIGNATURE = "public.start_session_with_goals(uuid, uuid, uuid, uuid[], timestamptz, uuid)";
const TABLE_GRANT_CONTRACT = {
  goal_domains: {
    public: [],
    anon: [],
    authenticated: ["INSERT", "SELECT", "UPDATE"],
    service_role: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  },
  user_therapist_links: {
    public: [],
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
    pattern: /public\.current_user_is_super_admin\s*\(\s*\)/i,
    message: "start_session_with_goals must allow public.current_user_is_super_admin()",
  },
  {
    pattern: /public\.user_therapist_links/i,
    message: "start_session_with_goals must reference public.user_therapist_links",
  },
  {
    pattern: /utl\.user_id\s*=\s*v_actor_id/i,
    message: "start_session_with_goals must scope user_therapist_links to v_actor_id",
  },
  {
    pattern: /utl\.therapist_id\s*=\s*v_session\.therapist_id/i,
    message: "start_session_with_goals must scope user_therapist_links to v_session.therapist_id",
  },
  {
    pattern: /join\s+public\.therapists\s+t\s+on\s+t\.id\s*=\s*utl\.therapist_id/i,
    message: "start_session_with_goals must join public.therapists through public.user_therapist_links",
  },
  {
    pattern: /v_session\.therapist_id\s*=\s*v_actor_id/i,
    message: "start_session_with_goals must require therapist actors to match v_session.therapist_id",
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
  {
    pattern: /security\s+definer/i,
    message: "start_session_with_goals must be SECURITY DEFINER",
  },
  {
    pattern: /set\s+search_path\s+(?:=|to)\s*''/i,
    message: "start_session_with_goals must set an empty search_path",
  },
  {
    pattern: /select[\s\S]{0,80}not\s+v_is_super_admin[\s\S]{0,600}into\s+v_is_restricted_bt_actor/i,
    message: "start_session_with_goals must identify restricted exact BT actors",
  },
  {
    pattern: /p_program_id\s+is\s+distinct\s+from\s+v_session\.program_id/i,
    message: "start_session_with_goals must reject BT program linkage drift",
  },
  {
    pattern: /p_goal_id\s+is\s+distinct\s+from\s+v_session\.goal_id/i,
    message: "start_session_with_goals must reject BT primary-goal linkage drift",
  },
  {
    pattern: /v_submitted_goal_ids\s+is\s+distinct\s+from\s+v_stored_goal_ids/i,
    message: "start_session_with_goals must reject BT goal-set linkage drift",
  },
  {
    pattern: /from\s+public\.programs\s+p/i,
    message: "start_session_with_goals must validate the stored BT program",
  },
  {
    pattern: /from\s+public\.session_goals\s+sg/i,
    message: "start_session_with_goals must validate stored BT session goals",
  },
];

const TABLE_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const TABLE_GRANT_PROBE_VALUES = Object.keys(TABLE_GRANT_CONTRACT)
  .flatMap((tableName) =>
    ["public", "anon", "authenticated", "service_role"].flatMap((grantee) =>
      TABLE_PRIVILEGES.map((privilege) => `('${tableName}', '${grantee}', '${privilege}')`),
    ),
  )
  .join(",\n            ");

export const TABLE_GRANT_QUERY = `
  select grants.table_name, grants.grantee, grants.privilege_type
  from (
    values
      ${TABLE_GRANT_PROBE_VALUES}
  ) as grants(table_name, grantee, privilege_type)
  where case
    when grants.grantee = 'public' then exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
      where n.nspname = 'public'
        and c.relname = grants.table_name
        and acl.grantee = 0
        and acl.privilege_type = grants.privilege_type
    )
    else has_table_privilege(
      grants.grantee,
      format('public.%I', grants.table_name),
      grants.privilege_type
    )
  end
`;

const sortPrivileges = (privileges) => [...new Set(privileges.map((value) => value.toUpperCase()))].sort();

const samePrivileges = (actual, expected) =>
  JSON.stringify(sortPrivileges(actual)) === JSON.stringify(sortPrivileges(expected));

export const buildDatabaseSslConfig = (ca) => {
  if (!String(ca ?? "").trim()) {
    throw new Error("The trusted Supabase database CA certificate is empty.");
  }

  return {
    ca,
    rejectUnauthorized: true,
  };
};

const stripSqlComments = (sql) =>
  String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, "");

export const evaluateStartSessionRuntimeContract = ({
  functionDefinition,
  executeGrants,
  tableGrants,
}) => {
  const violations = [];
  const definition = stripSqlComments(functionDefinition ?? "");

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

const fetchRuntimeContract = async ({ connectionString, ca }) => {
  const pool = new Pool({
    connectionString,
    ssl: buildDatabaseSslConfig(ca),
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

    const grantsResult = await client.query(TABLE_GRANT_QUERY);

    const tableGrants = {
      goal_domains: {
        public: [],
        anon: [],
        authenticated: [],
        service_role: [],
      },
      user_therapist_links: {
        public: [],
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

  const ca = await readFile(new URL("./certs/supabase-root-2021-ca.crt", import.meta.url), "utf8");
  const contract = await fetchRuntimeContract({ connectionString, ca });
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
