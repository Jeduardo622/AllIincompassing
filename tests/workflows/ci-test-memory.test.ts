import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowStep = {
  name?: string;
  env?: Record<string, string>;
};

type Workflow = {
  jobs?: Record<string, { steps?: WorkflowStep[] }>;
};

const loadWorkflow = (filename: string): Workflow => {
  const workflowPath = path.join(process.cwd(), ".github", "workflows", filename);
  return parse(readFileSync(workflowPath, "utf8")) as Workflow;
};

const expectStepHeap = (workflow: Workflow, jobName: string, stepName: string) => {
  const step = workflow.jobs?.[jobName]?.steps?.find((candidate) => candidate.name === stepName);
  expect(step, `${jobName}/${stepName} must exist`).toBeDefined();
  expect(step?.env?.NODE_OPTIONS).toBe("--max-old-space-size=6144");
};

describe("CI test memory contract", () => {
  it("gives both full-suite test jobs enough heap for the schedule suite", () => {
    expectStepHeap(loadWorkflow("ci.yml"), "unit_tests", "Unit tests + coverage");
    expectStepHeap(loadWorkflow("supabase-validate.yml"), "test-main", "Run unit tests");
    expectStepHeap(loadWorkflow("tenant-safety.yml"), "tenant-safety", "Run tests");
  });
});
