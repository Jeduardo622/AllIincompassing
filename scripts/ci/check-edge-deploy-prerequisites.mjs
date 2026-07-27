import { pathToFileURL } from "node:url";

export const parseProjectRef = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[a-z0-9]{20}$/i.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/i)?.[1] ?? null;
  } catch {
    return null;
  }
};

export const validateEdgeDeployPrerequisites = ({
  env = process.env,
  deployTargetLabel = "edge",
} = {}) => {
  const configuredProjectRef = parseProjectRef(env.SUPABASE_PROJECT_REF);
  const urlProjectRef = parseProjectRef(env.SUPABASE_URL);

  if (configuredProjectRef && urlProjectRef && configuredProjectRef !== urlProjectRef) {
    return {
      ok: false,
      message: "❌ SUPABASE_PROJECT_REF and SUPABASE_URL resolve to different projects.",
    };
  }

  const projectRef = configuredProjectRef || urlProjectRef;

  if (!env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN.trim().length === 0) {
    return {
      ok: false,
      message: `❌ Missing SUPABASE_ACCESS_TOKEN for ${deployTargetLabel} deploy.`,
    };
  }

  if (!projectRef) {
    return {
      ok: false,
      message: `❌ Missing project ref for ${deployTargetLabel} deploy. Set SUPABASE_PROJECT_REF or SUPABASE_URL.`,
    };
  }

  return {
    ok: true,
    projectRef,
  };
};

const runCli = () => {
  const deployTargetLabel = process.argv.slice(2).join(" ").trim() || "edge";
  const result = validateEdgeDeployPrerequisites({
    env: process.env,
    deployTargetLabel,
  });

  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  console.log(
    `✅ ${deployTargetLabel} deploy prerequisites look valid for project ${result.projectRef}.`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
