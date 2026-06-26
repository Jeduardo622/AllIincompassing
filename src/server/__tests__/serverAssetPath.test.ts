import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveServerAssetPath } from "../serverAssetPath";

const createdDirs: string[] = [];

const makeTempDir = (name: string): string => {
  const dir = join(tmpdir(), `${name}-${process.pid}-${Date.now()}-${createdDirs.length}`);
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
};

describe("resolveServerAssetPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    createdDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  it("prefers the cwd asset when both local and bundled copies exist", () => {
    const cwd = makeTempDir("cwd-with-assets");
    const bundleDir = makeTempDir("netlify-function-bundle");
    const localAssetDir = join(cwd, "docs", "fill_docs");
    const bundledAssetDir = join(bundleDir, "docs", "fill_docs");
    mkdirSync(localAssetDir, { recursive: true });
    mkdirSync(bundledAssetDir, { recursive: true });
    const localAsset = join(localAssetDir, "caloptima_fba_pdf_render_map.json");
    const bundledAsset = join(bundledAssetDir, "caloptima_fba_pdf_render_map.json");
    writeFileSync(localAsset, "{}");
    writeFileSync(bundledAsset, "{}");

    const moduleUrl = pathToFileURL(join(bundleDir, "assessment-plan-pdf.mjs")).href;

    expect(
      resolveServerAssetPath("docs/fill_docs/caloptima_fba_pdf_render_map.json", {
        cwd,
        moduleUrl,
      }),
    ).toBe(resolve(localAsset));
  });

  it("finds assets in LAMBDA_TASK_ROOT when cwd does not contain them", () => {
    const cwd = makeTempDir("cwd-without-assets");
    const lambdaTaskRoot = makeTempDir("lambda-task-root");
    const assetDir = join(lambdaTaskRoot, "docs", "fill_docs");
    mkdirSync(assetDir, { recursive: true });
    const lambdaAsset = join(assetDir, "caloptima_fba_pdf_render_map.json");
    writeFileSync(lambdaAsset, "{}");
    vi.stubEnv("LAMBDA_TASK_ROOT", lambdaTaskRoot);

    expect(
      resolveServerAssetPath("docs/fill_docs/caloptima_fba_pdf_render_map.json", {
        cwd,
      }),
    ).toBe(resolve(lambdaAsset));
  });

  it("finds Netlify included files next to the bundled function module when cwd differs", () => {
    const cwd = makeTempDir("cwd-without-assets");
    const bundleDir = makeTempDir("netlify-function-bundle");
    const assetDir = join(bundleDir, "docs", "fill_docs");
    mkdirSync(assetDir, { recursive: true });
    const bundledAsset = join(assetDir, "caloptima_fba_pdf_render_map.json");
    writeFileSync(bundledAsset, "{}");

    const moduleUrl = pathToFileURL(join(bundleDir, "assessment-plan-pdf.mjs")).href;

    expect(
      resolveServerAssetPath("docs/fill_docs/caloptima_fba_pdf_render_map.json", {
        cwd,
        moduleUrl,
      }),
    ).toBe(resolve(bundledAsset));
  });

  it("resolves root-level Netlify included PDF assets next to the bundled function module", () => {
    const cwd = makeTempDir("cwd-without-assets");
    const bundleDir = makeTempDir("netlify-function-bundle");
    const bundledAsset = join(bundleDir, "CalOptima Health FBA Template (2).pdf");
    writeFileSync(bundledAsset, "pdf");

    const moduleUrl = pathToFileURL(join(bundleDir, "assessment-plan-pdf.mjs")).href;

    expect(
      resolveServerAssetPath("CalOptima Health FBA Template (2).pdf", {
        cwd,
        moduleUrl,
      }),
    ).toBe(resolve(bundledAsset));
  });
});
