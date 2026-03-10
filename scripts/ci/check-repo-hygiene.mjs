import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const DISALLOWED_PATTERNS = [
  /\.backup$/i,
  /^src\/.*\.zip$/i,
];

const run = () => {
  const output = execSync("git ls-files", { encoding: "utf8" });
  const tracked = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const violations = tracked
    .filter((file) => existsSync(file))
    .filter((file) => DISALLOWED_PATTERNS.some((pattern) => pattern.test(file)));

  if (violations.length === 0) {
    console.log("Repo hygiene check passed (no tracked backup/archive artifacts).");
    return;
  }

  console.error("Repo hygiene check failed. Remove tracked backup/archive artifacts:");
  for (const file of violations) {
    console.error(`- ${file}`);
  }
  process.exitCode = 1;
};

run();
