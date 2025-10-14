export type OrgSeedRecord = {
  organizationId: string;
  sessions: Array<{ id: string; organization_id: string; therapist_id: string; client_id: string; status: string }>;
  therapists: Array<{ id: string; organization_id: string; full_name: string }>;
  clients: Array<{ id: string; organization_id: string; full_name: string; is_active: boolean }>;
  billingRecords: Array<{ id: string; organization_id: string; session_id: string; status: string; amount: number }>;
};

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

// TODO: Replace with Supabase MCP-driven seed once available in CI environment.
