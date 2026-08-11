import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, normalizePath } from "vite";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "responsive-harness");
const shimRoot = path.join(fixtureRoot, "src", "shims");

const moduleRemaps = new Map<string, string>([
  [path.join(repoRoot, "src", "lib", "api.ts"), path.join(shimRoot, "api.ts")],
  [path.join(repoRoot, "src", "lib", "authContext.tsx"), path.join(shimRoot, "authContext.tsx")],
  [path.join(repoRoot, "src", "lib", "organization.ts"), path.join(shimRoot, "organization.ts")],
  [path.join(repoRoot, "src", "lib", "toast.tsx"), path.join(shimRoot, "toast.ts")],
  [path.join(repoRoot, "src", "lib", "ai.ts"), path.join(shimRoot, "ai.ts")],
  [path.join(repoRoot, "src", "lib", "assessment-documents.ts"), path.join(shimRoot, "assessment-documents.ts")],
  [path.join(repoRoot, "src", "lib", "supabase.ts"), path.join(shimRoot, "supabase.ts")],
  [path.join(repoRoot, "src", "lib", "agent-work-ledger.ts"), path.join(shimRoot, "agent-work-ledger.ts")],
  [path.join(repoRoot, "src", "lib", "logger", "logger.ts"), path.join(shimRoot, "logger.ts")],
].map(([source, target]) => [normalizePath(source), normalizePath(target)]));

const specifierRemaps = new Map<string, string>([
  ["../../lib/api", path.join(shimRoot, "api.ts")],
  ["../lib/api", path.join(shimRoot, "api.ts")],
  ["../../lib/authContext", path.join(shimRoot, "authContext.tsx")],
  ["../../lib/organization", path.join(shimRoot, "organization.ts")],
  ["../../lib/toast", path.join(shimRoot, "toast.ts")],
  ["../lib/toast", path.join(shimRoot, "toast.ts")],
  ["../../lib/ai", path.join(shimRoot, "ai.ts")],
  ["../../lib/assessment-documents", path.join(shimRoot, "assessment-documents.ts")],
  ["../../lib/supabase", path.join(shimRoot, "supabase.ts")],
  ["../../lib/agent-work-ledger", path.join(shimRoot, "agent-work-ledger.ts")],
  ["../lib/logger/logger", path.join(shimRoot, "logger.ts")],
].map(([source, target]) => [source, normalizePath(target)]));

const suffixRemaps: Array<[suffix: string, target: string]> = [
  ["authContext", normalizePath(path.join(shimRoot, "authContext.tsx"))],
  ["organization", normalizePath(path.join(shimRoot, "organization.ts"))],
  ["assessment-documents", normalizePath(path.join(shimRoot, "assessment-documents.ts"))],
  ["agent-work-ledger", normalizePath(path.join(shimRoot, "agent-work-ledger.ts"))],
  ["supabase", normalizePath(path.join(shimRoot, "supabase.ts"))],
  ["toast", normalizePath(path.join(shimRoot, "toast.ts"))],
  ["api", normalizePath(path.join(shimRoot, "api.ts"))],
  ["ai", normalizePath(path.join(shimRoot, "ai.ts"))],
  ["logger/logger", normalizePath(path.join(shimRoot, "logger.ts"))],
];

const responsiveHarnessAliases = () => ({
  name: "responsive-harness-aliases",
  async resolveId(source: string, importer?: string, options?: { attributes?: Record<string, string> }) {
    const directShim = specifierRemaps.get(source);
    if (directShim) {
      return {
        id: directShim,
      };
    }

    const sourceWithoutExtension = source.replace(/\.(?:[cm]?[jt]sx?)$/, "");
    const suffixShim = suffixRemaps.find(
      ([suffix]) => sourceWithoutExtension === suffix || sourceWithoutExtension.endsWith(`/${suffix}`),
    );
    if (suffixShim) {
      return {
        id: suffixShim[1],
      };
    }

    const resolved = await this.resolve(source, importer, {
      ...options,
      skipSelf: true,
    });

    if (!resolved) {
      return null;
    }

    const cleaned = normalizePath(resolved.id.split("?")[0]);
    const shimPath = moduleRemaps.get(cleaned);
    if (!shimPath) {
      return resolved;
    }

    return {
      id: shimPath,
    };
  },
});

const forbiddenProductionModules = new Set(moduleRemaps.keys());

const responsiveHarnessBoundary = () => ({
  name: "responsive-harness-boundary",
  generateBundle(_options: unknown, bundle: Record<string, { type: string; modules?: Record<string, unknown> }>) {
    const leakedModules = Object.values(bundle)
      .flatMap((output) => (output.type === "chunk" ? Object.keys(output.modules ?? {}) : []))
      .map((moduleId) => normalizePath(moduleId.split("?")[0]))
      .filter((moduleId) => forbiddenProductionModules.has(moduleId));

    if (leakedModules.length > 0) {
      throw new Error(`responsive_harness_production_boundary_leak:${leakedModules.join(",")}`);
    }
  },
});

export default defineConfig({
  root: fixtureRoot,
  envDir: false,
  publicDir: false,
  appType: "spa",
  plugins: [
    responsiveHarnessAliases(),
    responsiveHarnessBoundary(),
    react({
      include: [
        /tests\/fixtures\/responsive-harness\/src\/.*\.[jt]sx?$/,
        /src\/.*\.[jt]sx?$/,
      ],
    }),
  ],
  resolve: {
    alias: [
      { find: /^.*\/lib\/authContext(?:\.[cm]?[jt]sx?)?$/, replacement: normalizePath(path.join(shimRoot, "authContext.tsx")) },
      { find: /^.*\/lib\/organization(?:\.[cm]?[jt]sx?)?$/, replacement: normalizePath(path.join(shimRoot, "organization.ts")) },
      { find: /^.*\/lib\/assessment-documents(?:\.[cm]?[jt]sx?)?$/, replacement: normalizePath(path.join(shimRoot, "assessment-documents.ts")) },
      { find: /^.*\/lib\/agent-work-ledger(?:\.[cm]?[jt]sx?)?$/, replacement: normalizePath(path.join(shimRoot, "agent-work-ledger.ts")) },
      { find: /^.*\/lib\/supabase(?:\.[cm]?[jt]sx?)?$/, replacement: normalizePath(path.join(shimRoot, "supabase.ts")) },
      { find: /^.*\/lib\/toast(?:\.[cm]?[jt]sx?)?$/, replacement: normalizePath(path.join(shimRoot, "toast.ts")) },
      { find: /^.*\/lib\/api(?:\.[cm]?[jt]sx?)?$/, replacement: normalizePath(path.join(shimRoot, "api.ts")) },
      { find: /^.*\/lib\/ai(?:\.[cm]?[jt]sx?)?$/, replacement: normalizePath(path.join(shimRoot, "ai.ts")) },
      { find: /^.*\/lib\/logger\/logger(?:\.[cm]?[jt]sx?)?$/, replacement: normalizePath(path.join(shimRoot, "logger.ts")) },
      { find: "npm:zod@3.23.8", replacement: "zod" },
    ],
  },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": "undefined",
    "import.meta.env.VITE_SUPABASE_ANON_KEY": "undefined",
    "import.meta.env.VITE_SUPABASE_EDGE_URL": "undefined",
  },
  optimizeDeps: {
    exclude: ["lucide-react"],
  },
  server: {
    host: "127.0.0.1",
    fs: {
      strict: true,
    },
  },
  preview: {
    host: "127.0.0.1",
  },
  build: {
    outDir: path.join(repoRoot, "artifacts", "responsive-harness-dist"),
    emptyOutDir: true,
  },
});
