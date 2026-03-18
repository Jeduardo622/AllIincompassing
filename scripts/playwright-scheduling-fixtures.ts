import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { loadPlaywrightEnv } from "./lib/load-playwright-env";

type FixtureAction = "setup" | "cleanup";

type ConflictFixtureState = {
  organizationId: string;
  therapistId: string;
  clientId: string;
  programId: string;
  goalId: string;
  createdProgramId?: string;
  createdGoalId?: string;
  generatedAt: string;
};

const statePath = path.resolve(process.cwd(), "artifacts", "latest", "playwright-conflict-fixture.json");

const getEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const getOptionalEnv = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
};

const parseAction = (): FixtureAction => {
  const arg = process.argv.find((entry) => entry.startsWith("--action="));
  const value = (arg?.split("=")[1] ?? "setup").trim().toLowerCase();
  switch (value) {
    case "setup":
      return "setup";
    case "cleanup":
      return "cleanup";
    default:
      throw new Error(`Unsupported --action value "${value}". Supported: setup, cleanup.`);
  }
};

const getAdminClient = () => {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
};

const ensureStateDirectory = (): void => {
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const writeState = (state: ConflictFixtureState): void => {
  ensureStateDirectory();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
};

const readState = (): ConflictFixtureState | null => {
  if (!fs.existsSync(statePath)) {
    return null;
  }
  const raw = fs.readFileSync(statePath, "utf8");
  const parsed = JSON.parse(raw) as ConflictFixtureState;
  return parsed;
};

const resolveOrganizationId = async (
  adminClient: ReturnType<typeof getAdminClient>,
  therapistId: string,
): Promise<string> => {
  const explicitOrgId = getOptionalEnv("DEFAULT_ORGANIZATION_ID");
  if (explicitOrgId) {
    return explicitOrgId;
  }

  const { data, error } = await adminClient
    .from("therapists")
    .select("organization_id")
    .eq("id", therapistId)
    .single();
  if (error || !data?.organization_id) {
    throw new Error(`Unable to resolve organization for therapist ${therapistId}: ${error?.message ?? "missing organization_id"}`);
  }
  return data.organization_id;
};

const ensureProgram = async (
  adminClient: ReturnType<typeof getAdminClient>,
  organizationId: string,
  clientId: string,
): Promise<{ programId: string; createdProgramId?: string }> => {
  const providedProgramId = getOptionalEnv("PW_CONFLICT_PROGRAM_ID");
  if (providedProgramId) {
    return { programId: providedProgramId };
  }

  const { data: existingPrograms, error: existingProgramsError } = await adminClient
    .from("programs")
    .select("id,status")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .eq("status", "active")
    .limit(1);
  if (existingProgramsError) {
    throw new Error(`Unable to query programs: ${existingProgramsError.message}`);
  }
  if (existingPrograms && existingPrograms.length > 0 && existingPrograms[0].id) {
    return { programId: existingPrograms[0].id };
  }

  const seedName = `Playwright Conflict Program ${Date.now()}`;
  const { data: createdProgram, error: createProgramError } = await adminClient
    .from("programs")
    .insert({
      organization_id: organizationId,
      client_id: clientId,
      name: seedName,
      description: "Deterministic Playwright conflict fixture program",
      status: "active",
    })
    .select("id")
    .single();
  if (createProgramError || !createdProgram?.id) {
    throw new Error(`Unable to create fixture program: ${createProgramError?.message ?? "missing id"}`);
  }

  return {
    programId: createdProgram.id,
    createdProgramId: createdProgram.id,
  };
};

const ensureGoal = async (
  adminClient: ReturnType<typeof getAdminClient>,
  organizationId: string,
  clientId: string,
  programId: string,
): Promise<{ goalId: string; createdGoalId?: string }> => {
  const providedGoalId = getOptionalEnv("PW_CONFLICT_GOAL_ID");
  if (providedGoalId) {
    return { goalId: providedGoalId };
  }

  const { data: existingGoals, error: existingGoalsError } = await adminClient
    .from("goals")
    .select("id,status")
    .eq("organization_id", organizationId)
    .eq("program_id", programId)
    .eq("status", "active")
    .limit(1);
  if (existingGoalsError) {
    throw new Error(`Unable to query goals: ${existingGoalsError.message}`);
  }
  if (existingGoals && existingGoals.length > 0 && existingGoals[0].id) {
    return { goalId: existingGoals[0].id };
  }

  const { data: createdGoal, error: createGoalError } = await adminClient
    .from("goals")
    .insert({
      organization_id: organizationId,
      client_id: clientId,
      program_id: programId,
      title: `Playwright Conflict Goal ${Date.now()}`,
      description: "Deterministic Playwright conflict fixture goal",
      original_text: "Deterministic Playwright conflict fixture goal",
      status: "active",
    })
    .select("id")
    .single();
  if (createGoalError || !createdGoal?.id) {
    throw new Error(`Unable to create fixture goal: ${createGoalError?.message ?? "missing id"}`);
  }

  return {
    goalId: createdGoal.id,
    createdGoalId: createdGoal.id,
  };
};

const setupFixtures = async (): Promise<void> => {
  const therapistId = getEnv("PW_CONFLICT_THERAPIST_ID");
  const clientId = getEnv("PW_CONFLICT_CLIENT_ID");
  const adminClient = getAdminClient();
  const organizationId = await resolveOrganizationId(adminClient, therapistId);
  const { programId, createdProgramId } = await ensureProgram(adminClient, organizationId, clientId);
  const { goalId, createdGoalId } = await ensureGoal(adminClient, organizationId, clientId, programId);

  const fixtureState: ConflictFixtureState = {
    organizationId,
    therapistId,
    clientId,
    programId,
    goalId,
    createdProgramId,
    createdGoalId,
    generatedAt: new Date().toISOString(),
  };

  writeState(fixtureState);

  console.log(
    JSON.stringify({
      ok: true,
      action: "setup",
      statePath,
      fixtureState,
      message: "Playwright scheduling fixtures are ready.",
    }),
  );
};

const cleanupFixtures = async (): Promise<void> => {
  const state = readState();
  if (!state) {
    console.log(
      JSON.stringify({
        ok: true,
        action: "cleanup",
        message: "No fixture state file found; nothing to clean.",
      }),
    );
    return;
  }

  const adminClient = getAdminClient();
  if (state.createdGoalId) {
    const { error } = await adminClient
      .from("goals")
      .update({ status: "inactive" })
      .eq("id", state.createdGoalId);
    if (error) {
      throw new Error(`Unable to deactivate fixture goal ${state.createdGoalId}: ${error.message}`);
    }
  }
  if (state.createdProgramId) {
    const { error } = await adminClient
      .from("programs")
      .update({ status: "inactive" })
      .eq("id", state.createdProgramId);
    if (error) {
      throw new Error(`Unable to deactivate fixture program ${state.createdProgramId}: ${error.message}`);
    }
  }

  fs.unlinkSync(statePath);
  console.log(
    JSON.stringify({
      ok: true,
      action: "cleanup",
      message: "Playwright scheduling fixtures cleaned up.",
    }),
  );
};

async function run(): Promise<void> {
  loadPlaywrightEnv();
  const action = parseAction();
  if (action === "setup") {
    await setupFixtures();
    return;
  }
  await cleanupFixtures();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
