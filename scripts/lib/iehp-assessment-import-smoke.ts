import { readdirSync } from 'node:fs';
import path from 'node:path';

type ResolveIehpSmokeSampleFileArgs = {
  cwd: string;
  env?: Pick<NodeJS.ProcessEnv, 'PW_ASSESSMENT_SAMPLE_FILE'>;
  candidateFileNames?: string[];
};

const isRootIehpFbaSample = (fileName: string): boolean => {
  const lowerName = fileName.toLowerCase();
  return (
    lowerName.endsWith('.docx') &&
    lowerName.includes('iehp') &&
    lowerName.includes('fba') &&
    ['redacted', 'synthetic', 'smoke', 'test'].some((marker) => lowerName.includes(marker)) &&
    !lowerName.startsWith('updated fba')
  );
};

export const resolveIehpSmokeSampleFile = ({
  cwd,
  env = process.env,
  candidateFileNames,
}: ResolveIehpSmokeSampleFileArgs): string => {
  const configuredSampleFile = env.PW_ASSESSMENT_SAMPLE_FILE?.trim();
  if (configuredSampleFile) {
    return path.resolve(cwd, configuredSampleFile);
  }

  const rootFileNames =
    candidateFileNames ??
    readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  const matches = rootFileNames.filter(isRootIehpFbaSample);

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one safe root IEHP FBA DOCX sample when PW_ASSESSMENT_SAMPLE_FILE is not set; found ${matches.length}. Set PW_ASSESSMENT_SAMPLE_FILE for an explicit smoke fixture.`,
    );
  }

  return path.resolve(cwd, matches[0]);
};

export const buildIehpSmokeUploadFileName = (timestamp = Date.now()): string => `iehp-fba-smoke-${timestamp}.docx`;

export const buildIehpSmokeCleanupFailureManifestPayload = (args: {
  cleanupError: Error;
  cleanupTargetKnown: boolean;
  createdAt?: string;
  runError?: Error | null;
}): {
  createdAt: string;
  cleanupTargetKnown: boolean;
  cleanupError: string;
  runError: string | null;
} => ({
  createdAt: args.createdAt ?? new Date().toISOString(),
  cleanupTargetKnown: args.cleanupTargetKnown,
  cleanupError: 'Cleanup failed; inspect local terminal context or hosted smoke records for manual cleanup.',
  runError: args.runError ? 'IEHP smoke run failed before cleanup completed.' : null,
});

export const buildIehpSmokeCleanupFailureMessage = (args: {
  cleanupFailed: boolean;
  cleanupManifestPath?: string | null;
  cleanupManifestWriteFailed?: boolean;
  runFailed: boolean;
}): string => {
  const base = args.runFailed
    ? 'IEHP assessment import smoke failed and cleanup did not complete.'
    : 'IEHP assessment import smoke cleanup did not complete.';
  const manifest = args.cleanupManifestPath ? ` Cleanup manifest: ${args.cleanupManifestPath}.` : '';
  const manifestWrite = args.cleanupManifestWriteFailed ? ' Cleanup manifest write failed.' : '';
  const cleanup = args.cleanupFailed ? ' Manual cleanup may be required.' : '';
  return `${base}${cleanup}${manifest}${manifestWrite}`;
};
