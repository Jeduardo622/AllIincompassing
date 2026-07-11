import { describe, expect, it } from "vitest";
import {
  assertDedicatedSmokeBcbaEmail,
  buildDefaultSmokeBcbaEmail,
  getMissingBcbaProvisionSecrets,
  shouldSkipSecretlessPullRequest,
} from "../../scripts/provision-ci-smoke-bcba";

describe("provision-ci-smoke-bcba guards", () => {
  it("only accepts dedicated disposable BCBA emails", () => {
    expect(() => assertDedicatedSmokeBcbaEmail("playwright.ci.bcba.123.1@example.com")).not.toThrow();
    expect(() => assertDedicatedSmokeBcbaEmail("bcba@example.com")).toThrow(/Refusing/);
  });

  it("builds a dedicated email", () => {
    expect(buildDefaultSmokeBcbaEmail()).toMatch(/^playwright\.ci\.bcba\..+@example\.com$/);
  });

  it("skips only secretless pull requests", () => {
    const env = { GITHUB_EVENT_NAME: "pull_request" } as NodeJS.ProcessEnv;
    expect(getMissingBcbaProvisionSecrets(env)).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(shouldSkipSecretlessPullRequest(env)).toBe(true);
    expect(shouldSkipSecretlessPullRequest({ ...env, GITHUB_EVENT_NAME: "push" })).toBe(false);
  });
});
