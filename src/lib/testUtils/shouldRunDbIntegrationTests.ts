const TRUTHY_STRINGS = new Set(['1', 'true', 'yes', 'on']);

type ProcessLike = { env?: Record<string, string | undefined> };

type ShouldRunDbIntegrationTestsOptions = {
  importMetaEnv?: Record<string, unknown>;
  processEnv?: Record<string, string | undefined>;
};

const isTruthyFlag = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0) {
      return false;
    }
    return TRUTHY_STRINGS.has(normalized);
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  return false;
};

const getProcessEnv = (
  provided?: Record<string, string | undefined>
): Record<string, string | undefined> | undefined => {
  if (provided) {
    return provided;
  }

  const candidate = globalThis as typeof globalThis & { process?: ProcessLike };
  return candidate.process?.env;
};

const getImportMetaEnv = (
  provided?: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if (provided) {
    return provided;
  }

  const meta = import.meta as ImportMeta & { env?: Record<string, unknown> };
  return meta.env;
};

export const shouldRunDbIntegrationTests = (
  options: ShouldRunDbIntegrationTestsOptions = {}
): boolean => {
  const importMetaEnv = getImportMetaEnv(options.importMetaEnv);
  const processEnv = getProcessEnv(options.processEnv);

  return (
    isTruthyFlag(importMetaEnv?.CI) ||
    isTruthyFlag(processEnv?.CI) ||
    isTruthyFlag(importMetaEnv?.RUN_DB_IT) ||
    isTruthyFlag(processEnv?.RUN_DB_IT)
  );
};

export const testables = {
  isTruthyFlag,
};
