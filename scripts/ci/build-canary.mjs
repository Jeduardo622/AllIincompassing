import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EXPECTED_NODE_VERSION = '20.16.0';
const PROJECT_ROOT = process.cwd();

const ensureNodeVersion = () => {
  const current = process.version.replace(/^v/, '');
  if (current !== EXPECTED_NODE_VERSION) {
    console.error(
      `Expected Node ${EXPECTED_NODE_VERSION} but found ${current}. Update the workflow runner to ensure deterministic builds.`,
    );
    process.exit(1);
  }
  console.log(`✅ Node version ${current} matches expected ${EXPECTED_NODE_VERSION}.`);
};

const clearBuildArtifacts = () => {
  const cacheTargets = [
    path.join(PROJECT_ROOT, 'node_modules', '.vite'),
    path.join(PROJECT_ROOT, '.vite'),
    path.join(PROJECT_ROOT, 'dist'),
  ];

  cacheTargets.forEach((target) => {
    if (!existsSync(target)) {
      return;
    }

    try {
      rmSync(target, { recursive: true, force: true });
      console.log(`🧹 Cleared ${path.relative(PROJECT_ROOT, target) || '.'}`);
    } catch (error) {
      console.warn(`⚠️  Failed to remove ${target}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
};

const runBuild = () => {
  const result = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

ensureNodeVersion();
clearBuildArtifacts();
runBuild();
