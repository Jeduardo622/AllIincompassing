import path from "node:path";
import process from "node:process";

import {
  buildAgentWorkLedgerEvalFailure,
  evaluateAgentWorkLedgerDataset,
  loadAgentWorkLedgerEvalFixture,
  stableStringifyAgentWorkLedgerEval,
} from "./agent-work-ledger-eval";

const defaultFixturePath = path.join(
  process.cwd(),
  "scripts",
  "fixtures",
  "agent-work-ledger-eval-fixture.v1.json",
);

const resolveFixturePath = (): string => {
  const fixtureFlagIndex = process.argv.findIndex((argument) =>
    argument === "--fixture"
  );
  if (fixtureFlagIndex >= 0) {
    const configuredPath = process.argv[fixtureFlagIndex + 1];
    if (!configuredPath) {
      throw new Error("missing fixture path");
    }
    return path.resolve(configuredPath);
  }

  const inlineFlag = process.argv.find((argument) =>
    argument.startsWith("--fixture=")
  );
  if (inlineFlag) {
    return path.resolve(inlineFlag.slice("--fixture=".length));
  }

  return defaultFixturePath;
};

const main = (): void => {
  let result;

  try {
    const fixture = loadAgentWorkLedgerEvalFixture(resolveFixturePath());
    result = evaluateAgentWorkLedgerDataset(fixture);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown failure";
    result = {
      ...buildAgentWorkLedgerEvalFailure(message),
      error: message,
    };
  }

  process.stdout.write(stableStringifyAgentWorkLedgerEval(result));
  process.stdout.write("\n");

  if (result.summary.exitCode !== 0) {
    process.exitCode = result.summary.exitCode;
  }
};

main();
