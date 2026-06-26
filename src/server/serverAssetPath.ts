import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface ResolveServerAssetPathOptions {
  cwd?: string;
  moduleUrl?: string;
}

const unique = (paths: string[]): string[] => Array.from(new Set(paths));

export function resolveServerAssetPath(relativePath: string, options: ResolveServerAssetPathOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const candidates = [resolve(cwd, relativePath)];

  const lambdaTaskRoot = process.env.LAMBDA_TASK_ROOT?.trim();
  if (lambdaTaskRoot) {
    candidates.push(resolve(lambdaTaskRoot, relativePath));
  }

  if (options.moduleUrl) {
    const moduleDir = dirname(fileURLToPath(options.moduleUrl));
    candidates.push(resolve(moduleDir, relativePath));
    candidates.push(resolve(moduleDir, "..", relativePath));
    candidates.push(resolve(moduleDir, "..", "..", relativePath));
  }

  return unique(candidates).find((candidate) => existsSync(candidate)) ?? candidates[0];
}
