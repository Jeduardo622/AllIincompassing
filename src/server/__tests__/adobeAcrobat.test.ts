import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAdobePdfServicesApiHeaders,
  buildAdobePdfServicesTokenBody,
  buildAdobePdfServicesTokenHeaders,
  getAdobePdfServicesCredentials,
} from "../adobeAcrobat";
import { resetEnvCacheForTests } from "../env";

const ORIGINAL_ENV = { ...process.env } as NodeJS.ProcessEnv;

describe("server/adobeAcrobat", () => {
  let tempDir = "";
  let envPath = "";

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
    delete process.env.ADOBE_PDF_SERVICES_CLIENT_ID;
    delete process.env.ADOBE_PDF_SERVICES_CLIENT_SECRET;
    delete process.env.ADOBE_PDF_SERVICES_ORGANIZATION_ID;
    delete process.env.PDF_SERVICES_CLIENT_ID;
    delete process.env.PDF_SERVICES_CLIENT_SECRET;
    delete process.env.PDF_SERVICES_ORGANIZATION_ID;
    resetEnvCacheForTests();
    tempDir = mkdtempSync(join(tmpdir(), "adobe-acrobat-tests-"));
    envPath = join(tempDir, ".env.codex");
  });

  afterEach(() => {
    resetEnvCacheForTests();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
  });

  it("loads Adobe PDF Services credentials from documented env aliases", () => {
    writeFileSync(
      envPath,
      [
        "ADOBE_PDF_SERVICES_CLIENT_ID=client-id",
        "ADOBE_PDF_SERVICES_CLIENT_SECRET=client-secret",
        "ADOBE_PDF_SERVICES_ORGANIZATION_ID=org-id",
      ].join("\n"),
    );

    expect(getAdobePdfServicesCredentials({ envPath })).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      organizationId: "org-id",
    });
  });

  it("supports Adobe sample env names from the generated Node bundle", () => {
    writeFileSync(
      envPath,
      [
        "PDF_SERVICES_CLIENT_ID=sample-client-id",
        "PDF_SERVICES_CLIENT_SECRET=sample-client-secret",
        "PDF_SERVICES_ORGANIZATION_ID=sample-org-id",
      ].join("\n"),
    );

    expect(getAdobePdfServicesCredentials({ envPath })).toEqual({
      clientId: "sample-client-id",
      clientSecret: "sample-client-secret",
      organizationId: "sample-org-id",
    });
  });

  it("builds token request headers and body without exposing the secret in headers", () => {
    writeFileSync(
      envPath,
      [
        "PDF_SERVICES_CLIENT_ID=token-client-id",
        "PDF_SERVICES_CLIENT_SECRET=token-client-secret",
      ].join("\n"),
    );

    expect(buildAdobePdfServicesTokenHeaders()).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(buildAdobePdfServicesTokenBody({ envPath }).toString()).toBe(
      "client_id=token-client-id&client_secret=token-client-secret",
    );
  });

  it("builds REST API headers using client id and a short-lived access token", () => {
    writeFileSync(
      envPath,
      [
        "PDF_SERVICES_CLIENT_ID=api-client-id",
        "PDF_SERVICES_CLIENT_SECRET=api-client-secret",
      ].join("\n"),
    );

    expect(
      buildAdobePdfServicesApiHeaders({
        envPath,
        accessToken: " access-token ",
      }),
    ).toEqual({
      "X-API-Key": "api-client-id",
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  });

  it("rejects blank access tokens before building REST API headers", () => {
    writeFileSync(
      envPath,
      [
        "PDF_SERVICES_CLIENT_ID=api-client-id",
        "PDF_SERVICES_CLIENT_SECRET=api-client-secret",
      ].join("\n"),
    );

    expect(() =>
      buildAdobePdfServicesApiHeaders({
        envPath,
        accessToken: "   ",
      }),
    ).toThrow(/access token/i);
  });
});
