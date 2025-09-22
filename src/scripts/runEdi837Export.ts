import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getOptionalServerEnv, getRequiredServerEnv } from "../server/env";
import {
  createSupabaseEdi837Repository,
  runEdi837ExportPipeline,
  type Edi837GeneratorOptions,
  type RunEdiExportResult,
} from "../server/edi837";

const createSupabaseServiceClient = (): SupabaseClient => {
  const url = getRequiredServerEnv("SUPABASE_URL");
  const serviceKey = getRequiredServerEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
};

const resolveGeneratorOptions = (): Edi837GeneratorOptions => {
  const senderId = getRequiredServerEnv("EDI_SENDER_ID");
  const receiverId = getRequiredServerEnv("EDI_RECEIVER_ID");
  const usageIndicator = getOptionalServerEnv("EDI_USAGE_INDICATOR");
  return {
    senderId,
    receiverId,
    usageIndicator: usageIndicator === "P" ? "P" : "T",
  };
};

export const runEdi837ExportCli = async (): Promise<RunEdiExportResult> => {
  const repository = createSupabaseEdi837Repository(createSupabaseServiceClient());
  const options = resolveGeneratorOptions();
  const result = await runEdi837ExportPipeline({ repository, generatorOptions: options });
  if (!result.exported) {
    console.info("EDI 837 export completed: no pending claims");
  } else {
    console.info(
      `EDI 837 export completed: exported ${result.claimCount} claims to ${result.file?.fileName ?? "generated file"}`,
    );
  }
  return result;
};

const isExecutedFromCli = (): boolean => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === new URL(`file://${entry}`).href;
  } catch {
    return false;
  }
};

if (isExecutedFromCli()) {
  runEdi837ExportCli().catch((error) => {
    console.error("Failed to run EDI 837 export", error);
    process.exitCode = 1;
  });
}
