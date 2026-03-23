export type OrgSeedRecord = {
  // Primary organization used by org-scoped fixture assertions.
  organizationId: string;
  sessions: Array<{ id: string; organization_id: string; therapist_id: string; client_id: string; status: string }>;
  therapists: Array<{ id: string; organization_id: string; full_name: string }>;
  clients: Array<{ id: string; organization_id: string; full_name: string; is_active: boolean }>;
  billingRecords: Array<{ id: string; organization_id: string; session_id: string; status: string; amount: number }>;
};

export type SeedHarnessSource = "fixture" | "mcp";

export type MultiOrgSeedHarness = {
  source: SeedHarnessSource;
  seed: OrgSeedRecord;
  warnings: string[];
};

type MultiOrgSeedLoader = () => Promise<OrgSeedRecord> | OrgSeedRecord;

let activeSeedLoader: MultiOrgSeedLoader | null = null;

export function buildMultiOrgSeed(): OrgSeedRecord {
  return {
    organizationId: "org-a",
    sessions: [
      {
        id: "sess-001",
        organization_id: "org-a",
        therapist_id: "ther-001",
        client_id: "cli-001",
        status: "scheduled",
      },
      {
        id: "sess-002",
        organization_id: "org-b",
        therapist_id: "ther-002",
        client_id: "cli-002",
        status: "completed",
      },
    ],
    therapists: [
      { id: "ther-001", organization_id: "org-a", full_name: "Therapist A" },
      { id: "ther-002", organization_id: "org-b", full_name: "Therapist B" },
    ],
    clients: [
      { id: "cli-001", organization_id: "org-a", full_name: "Client A", is_active: true },
      { id: "cli-002", organization_id: "org-b", full_name: "Client B", is_active: true },
    ],
    billingRecords: [
      { id: "bill-001", organization_id: "org-a", session_id: "sess-001", status: "pending", amount: 100 },
      { id: "bill-002", organization_id: "org-b", session_id: "sess-002", status: "paid", amount: 150 },
    ],
  };
}

/**
 * Registers an optional MCP/Supabase seed provider for integration tests.
 * Tests fall back to the deterministic fixture when no provider is available.
 */
export function registerMultiOrgSeedLoader(loader: MultiOrgSeedLoader | null): void {
  activeSeedLoader = loader;
}

export function resetMultiOrgSeedLoader(): void {
  activeSeedLoader = null;
}

export async function loadMultiOrgSeed(options?: {
  preferMcp?: boolean;
}): Promise<MultiOrgSeedHarness> {
  const preferMcp = options?.preferMcp ?? true;
  const mode = process.env.INTEGRATION_SEED_MODE;
  const wantsMcp = preferMcp && mode === "mcp";

  if (wantsMcp && activeSeedLoader) {
    const seed = await activeSeedLoader();
    return {
      source: "mcp",
      seed,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  if (wantsMcp && !activeSeedLoader) {
    warnings.push("INTEGRATION_SEED_MODE=mcp requested but no MCP seed loader is registered; using fixture seed.");
  }

  return {
    source: "fixture",
    seed: buildMultiOrgSeed(),
    warnings,
  };
}
