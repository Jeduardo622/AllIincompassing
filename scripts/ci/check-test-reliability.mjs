import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const POLICY_PATH = path.join(ROOT, "tests", "reliability", "policy.json");
const QUARANTINE_PATH = path.join(ROOT, "tests", "reliability", "quarantine.json");

const REQUIRED_FIELDS = [
  "id",
  "testPath",
  "reason",
  "issue",
  "owner",
  "createdAt",
  "expiresAt",
  "exitCriteria",
  "status",
];

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const VALID_ISSUE_REFERENCE = /^(https?:\/\/\S+|[A-Z]+-\d+)$/;

const isExpired = (isoDate, now) => {
  const value = new Date(isoDate).getTime();
  return Number.isFinite(value) && value < now.getTime();
};

const run = async () => {
  const policy = await readJson(POLICY_PATH);
  const quarantine = await readJson(QUARANTINE_PATH);

  const entries = Array.isArray(quarantine.entries) ? quarantine.entries : [];
  const active = entries.filter((entry) => entry.status === "active");
  const now = new Date();

  const errors = [];

  if (active.length > policy.maxActiveQuarantinedTests) {
    errors.push(
      `Active quarantined tests ${active.length} exceed budget ${policy.maxActiveQuarantinedTests}.`,
    );
  }

  for (const entry of entries) {
    for (const field of REQUIRED_FIELDS) {
      if (!entry[field]) {
        errors.push(`Quarantine entry ${entry.id ?? "<missing-id>"} missing required field "${field}".`);
      }
    }
    if (entry.status === "active" && entry.expiresAt && isExpired(entry.expiresAt, now)) {
      errors.push(`Quarantine entry ${entry.id} expired on ${entry.expiresAt}.`);
    }
    if (entry.issue && !VALID_ISSUE_REFERENCE.test(String(entry.issue))) {
      errors.push(
        `Quarantine entry ${entry.id ?? "<missing-id>"} has invalid issue reference "${entry.issue}". Use ticket ID (ABC-123) or URL.`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("Test reliability policy check failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Test reliability policy check passed (${active.length} active quarantined test(s), budget ${policy.maxActiveQuarantinedTests}).`,
  );
};

run().catch((error) => {
  console.error("Test reliability policy check failed unexpectedly.");
  console.error(error);
  process.exitCode = 1;
});
