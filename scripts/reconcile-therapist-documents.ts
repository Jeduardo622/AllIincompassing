import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { reconcileTherapistDocumentPathSets } from "../src/lib/therapist-documents";

dotenv.config({ path: path.resolve(process.cwd(), ".env.codex") });
dotenv.config();

type CliArgs = {
  bucketId: string;
  organizationId?: string;
  apply: boolean;
  fixStorage: boolean;
  fixManifest: boolean;
  maxActions: number;
  failOnOrphans: boolean;
};

type ManifestRow = {
  id: string;
  organization_id: string;
  therapist_id: string;
  bucket_id: string;
  object_path: string;
  created_at: string;
};

type StorageObjectRow = {
  id: string;
  bucket_id: string;
  name: string;
  created_at: string;
};

type SupabaseApiConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

const DEFAULT_BUCKET_ID = "therapist-documents";
const DEFAULT_MAX_ACTIONS = 50;

const parseArgs = (argv: string[]): CliArgs => {
  const map = new Map<string, string | boolean>();
  argv.forEach((arg, index) => {
    if (!arg.startsWith("--")) {
      return;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      map.set(arg, true);
      return;
    }
    map.set(arg, next);
  });

  const maxActionsRaw = map.get("--max-actions");
  const maxActions = typeof maxActionsRaw === "string" ? Number(maxActionsRaw) : DEFAULT_MAX_ACTIONS;
  const normalizedMaxActions = Number.isFinite(maxActions) && maxActions >= 0 ? Math.trunc(maxActions) : DEFAULT_MAX_ACTIONS;

  return {
    bucketId: String(map.get("--bucket-id") ?? DEFAULT_BUCKET_ID),
    organizationId: typeof map.get("--organization-id") === "string" ? String(map.get("--organization-id")) : undefined,
    apply: Boolean(map.get("--apply")),
    fixStorage: Boolean(map.get("--fix-storage")),
    fixManifest: Boolean(map.get("--fix-manifest")),
    maxActions: normalizedMaxActions,
    failOnOrphans: Boolean(map.get("--fail-on-orphans")),
  };
};

const chunk = <T>(items: T[], size: number): T[][] => {
  if (size <= 0) {
    return [items];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const loadManifestRows = async (pool: Pool, args: CliArgs): Promise<ManifestRow[]> => {
  const params: unknown[] = [args.bucketId];
  let where = "where bucket_id = $1";
  if (args.organizationId) {
    params.push(args.organizationId);
    where += " and organization_id = $2";
  }
  const query = `
    select id, organization_id, therapist_id, bucket_id, object_path, created_at
    from public.therapist_documents
    ${where}
    order by created_at asc
  `;
  const result = await pool.query<ManifestRow>(query, params);
  return result.rows;
};

const loadStorageRows = async (pool: Pool, args: CliArgs): Promise<StorageObjectRow[]> => {
  const result = await pool.query<StorageObjectRow>(
    `
      select id, bucket_id, name, created_at
      from storage.objects
      where bucket_id = $1
      order by created_at asc
    `,
    [args.bucketId],
  );
  return result.rows;
};

const applyStorageCleanup = async (
  apiConfig: SupabaseApiConfig,
  bucketId: string,
  objectPaths: string[],
): Promise<number> => {
  let removed = 0;
  for (const objectPath of objectPaths) {
    const encodedPath = objectPath
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");

    const endpoint = `${apiConfig.supabaseUrl}/storage/v1/object/${encodeURIComponent(bucketId)}/${encodedPath}`;
    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: {
        apikey: apiConfig.serviceRoleKey,
        Authorization: `Bearer ${apiConfig.serviceRoleKey}`,
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`Storage API delete failed for ${objectPath}: ${detail}`);
    }
    removed += 1;
  }
  return removed;
};

const applyManifestCleanup = async (
  pool: Pool,
  bucketId: string,
  objectPaths: string[],
  organizationId?: string,
): Promise<number> => {
  let deleted = 0;
  for (const batch of chunk(objectPaths, 100)) {
    if (batch.length === 0) {
      continue;
    }
    const params: unknown[] = [bucketId, batch];
    let where = "where bucket_id = $1 and object_path = any($2::text[])";
    if (organizationId) {
      params.push(organizationId);
      where += " and organization_id = $3";
    }

    const result = await pool.query(
      `
        delete from public.therapist_documents
        ${where}
      `,
      params,
    );
    deleted += result.rowCount ?? 0;
  }
  return deleted;
};

const resolveDatabaseUrl = () => {
  const databaseUrl = (
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL ??
    process.env.DIRECT_URL
  )?.trim();
  if (!databaseUrl) {
    throw new Error("SUPABASE_DB_URL, DATABASE_URL, or DIRECT_URL is required.");
  }
  return databaseUrl;
};

const resolveSupabaseApiConfig = (): SupabaseApiConfig | null => {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return { supabaseUrl, serviceRoleKey };
};

const buildReportPath = (): string => {
  const reportDir = path.resolve(process.cwd(), ".reports");
  const timestamp = new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14);
  return path.join(reportDir, `therapist-docs-reconcile-${timestamp}.json`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = resolveDatabaseUrl();
  const apiConfig = resolveSupabaseApiConfig();
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  const manifestRows = await loadManifestRows(pool, args);
  const storageRows = await loadStorageRows(pool, args);

  const manifestPaths = manifestRows.map((row) => row.object_path);
  const storagePaths = storageRows.map((row) => row.name);

  const reconcileResult = reconcileTherapistDocumentPathSets({
    manifestPaths,
    storagePaths,
  });

  const totalOrphans =
    reconcileResult.orphanManifestPaths.length + reconcileResult.orphanStoragePaths.length;

  const storageCleanupCandidates = reconcileResult.orphanStoragePaths.slice(0, args.maxActions);
  const manifestCleanupCandidates = reconcileResult.orphanManifestPaths.slice(0, args.maxActions);

  let storageRemoved = 0;
  let manifestRemoved = 0;
  let storageApplyError: string | null = null;
  if (args.apply) {
    if (args.fixStorage && storageCleanupCandidates.length > 0) {
      try {
        if (!apiConfig) {
          throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for storage cleanup.");
        }
        storageRemoved = await applyStorageCleanup(apiConfig, args.bucketId, storageCleanupCandidates);
      } catch (error) {
        storageApplyError = error instanceof Error ? error.message : String(error);
      }
    }
    if (args.fixManifest && manifestCleanupCandidates.length > 0) {
      manifestRemoved = await applyManifestCleanup(
        pool,
        args.bucketId,
        manifestCleanupCandidates,
        args.organizationId,
      );
    }
  }

  const report = {
    mode: args.apply ? "apply" : "dry-run",
    bucketId: args.bucketId,
    organizationId: args.organizationId ?? null,
    totalManifestRows: manifestRows.length,
    totalStorageObjects: storageRows.length,
    orphanStorageCount: reconcileResult.orphanStoragePaths.length,
    orphanManifestCount: reconcileResult.orphanManifestPaths.length,
    orphanStorageSample: reconcileResult.orphanStoragePaths.slice(0, 25),
    orphanManifestSample: reconcileResult.orphanManifestPaths.slice(0, 25),
    apply: {
      enabled: args.apply,
      fixStorage: args.fixStorage,
      fixManifest: args.fixManifest,
      maxActions: args.maxActions,
      storageRemoved,
      storageApplyError,
      manifestRemoved,
      storageCleanupCandidates: storageCleanupCandidates.length,
      manifestCleanupCandidates: manifestCleanupCandidates.length,
    },
    generatedAt: new Date().toISOString(),
  };

  const reportPath = buildReportPath();
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({ reportPath, ...report }, null, 2));

  await pool.end();

  if (args.failOnOrphans && totalOrphans > 0) {
    process.exitCode = 2;
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Reconciliation failed: ${message}`);
  process.exit(1);
});
