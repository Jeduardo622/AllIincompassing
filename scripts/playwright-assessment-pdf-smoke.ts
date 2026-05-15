import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

import {
  cleanupProvisionedAssessmentPdfSmokeArtifacts,
  resolveAssessmentDocumentForPdfSmoke,
  type PdfSmokeAssessmentResolution,
} from './lib/assessment-pdf-smoke-document';
import { loadPlaywrightEnv } from './lib/load-playwright-env';
import { ensureArtifactsDir, preflightCredentials } from './lib/playwright-smoke';

type RenderMapEntry = {
  placeholder_key: string;
  fallback: {
    page: number;
    x: number;
    y: number;
    font_size: number;
    max_width: number;
    height?: number;
  };
};

type GeneratePdfResponse = {
  signed_url: string;
  fill_mode: 'acroform' | 'overlay' | 'mixed';
  object_path: string;
  layout_warnings?: Array<{ placeholder_key: string; page: number; reason: string }>;
  overflow_keys?: string[];
  filled_pages?: number[];
};

type PageReport = {
  page: number;
  changedPixels: number;
  outsideAllowedPixels: number;
  screenshot: string;
  diff: string;
};

const DEFAULT_BASE_URL = 'https://app.allincompassing.ai';
const PDF_PAGE_WIDTH_POINTS = 612;
const PDF_PAGE_HEIGHT_POINTS = 792;
const SCREENSHOT_WIDTH = 816;
const SCREENSHOT_HEIGHT = 1056;
const OUTSIDE_ALLOWED_PIXEL_TOLERANCE = 350;
const MIN_CHANGED_PIXELS_PER_FILLED_PAGE = 25;

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for assessment PDF visual smoke.`);
  }
  return value;
};

const resolveSupabaseUrl = (): string => process.env.VITE_SUPABASE_URL?.trim() || getRequiredEnv('SUPABASE_URL');
const resolveSupabaseAnonKey = (): string =>
  process.env.VITE_SUPABASE_ANON_KEY?.trim() || getRequiredEnv('SUPABASE_ANON_KEY');

const dataUrlForFile = (filePath: string, mimeType: string): string => {
  const encoded = readFileSync(filePath).toString('base64');
  return `data:${mimeType};base64,${encoded}`;
};

const renderPdfPageScreenshot = async (page: Page, pdfDataUrl: string, pageNumber: number, outputPath: string) => {
  await page.setViewportSize({ width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT });
  await page.setContent(
    `<html><body style="margin:0;overflow:hidden;background:#fff"><iframe title="pdf" src="${pdfDataUrl}#toolbar=0&page=${pageNumber}&zoom=100" style="border:0;width:${SCREENSHOT_WIDTH}px;height:${SCREENSHOT_HEIGHT}px"></iframe></body></html>`,
  );
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: outputPath, fullPage: false });
};

const compareScreenshots = async (
  page: Page,
  blankScreenshot: string,
  generatedScreenshot: string,
  entries: RenderMapEntry[],
  diffPath: string,
) => {
  const blankUrl = dataUrlForFile(blankScreenshot, 'image/png');
  const generatedUrl = dataUrlForFile(generatedScreenshot, 'image/png');
  const compareInBrowser = new Function(
    'arg',
    `
    return (async () => {
      const { blankUrl: blank, generatedUrl: generated, entries: fieldEntries, diffPath: ignoredDiffPath, pageWidth, pageHeight } = arg;
      const browserGlobal = globalThis;
      const loadImage = async (src) => {
        const response = await browserGlobal.fetch(src);
        const blob = await response.blob();
        return browserGlobal.createImageBitmap(blob);
      };
      const [blankImage, generatedImage] = await Promise.all([loadImage(blank), loadImage(generated)]);
      const width = Number(generatedImage.width);
      const height = Number(generatedImage.height);
      const canvas = new browserGlobal.OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create screenshot comparison canvas.');
      context.drawImage(blankImage, 0, 0);
      const blankPixels = context.getImageData(0, 0, width, height);
      context.clearRect(0, 0, width, height);
      context.drawImage(generatedImage, 0, 0);
      const generatedPixels = context.getImageData(0, 0, width, height);
      const diffPixels = context.createImageData(width, height);

      const allowed = new Uint8Array(width * height);
      const scaleX = width / pageWidth;
      const scaleY = height / pageHeight;
      for (const entry of fieldEntries) {
        const box = entry.fallback;
        const left = Math.max(0, Math.floor(box.x * scaleX) - 3);
        const top = Math.max(0, Math.floor((pageHeight - (box.y + box.font_size)) * scaleY) - 3);
        const right = Math.min(width, Math.ceil((box.x + box.max_width) * scaleX) + 3);
        const bottom = Math.min(height, Math.ceil((pageHeight - box.y + (box.height ?? 14)) * scaleY) + 3);
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            allowed[y * width + x] = 1;
          }
        }
      }

      let changedPixels = 0;
      let outsideAllowedPixels = 0;
      for (let index = 0; index < generatedPixels.data.length; index += 4) {
        const delta =
          Math.abs(generatedPixels.data[index] - blankPixels.data[index]) +
          Math.abs(generatedPixels.data[index + 1] - blankPixels.data[index + 1]) +
          Math.abs(generatedPixels.data[index + 2] - blankPixels.data[index + 2]);
        const pixelIndex = index / 4;
        if (delta <= 45) {
          diffPixels.data[index + 3] = 255;
          continue;
        }
        changedPixels += 1;
        const isAllowed = allowed[pixelIndex] === 1;
        if (!isAllowed) outsideAllowedPixels += 1;
        diffPixels.data[index] = isAllowed ? 0 : 220;
        diffPixels.data[index + 1] = isAllowed ? 160 : 0;
        diffPixels.data[index + 2] = isAllowed ? 0 : 0;
        diffPixels.data[index + 3] = 255;
      }

      context.putImageData(diffPixels, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const diffDataUrl = await new Promise((resolve, reject) => {
        const reader = new browserGlobal.FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('Could not encode diff image.'));
        reader.readAsDataURL(blob);
      });
      return {
        changedPixels,
        outsideAllowedPixels,
        diffDataUrl,
        diffPath: ignoredDiffPath,
      };
    })();
    `,
  ) as (
    arg: {
      blankUrl: string;
      generatedUrl: string;
      entries: RenderMapEntry[];
      diffPath: string;
      pageWidth: number;
      pageHeight: number;
    },
  ) => Promise<{
    changedPixels: number;
    outsideAllowedPixels: number;
    diffDataUrl: string;
    diffPath: string;
  }>;
  return page.evaluate(
    compareInBrowser,
    { blankUrl, generatedUrl, entries, diffPath, pageWidth: PDF_PAGE_WIDTH_POINTS, pageHeight: PDF_PAGE_HEIGHT_POINTS },
  );
};

async function run() {
  loadPlaywrightEnv();

  if (process.env.HEADLESS !== 'false') {
    throw new Error(
      'Assessment PDF visual smoke must run with HEADLESS=false because Chromium headless does not render PDF viewer screenshots reliably.',
    );
  }

  const baseUrl = (process.env.PW_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');

  const credentials = preflightCredentials([
    {
      email: process.env.PW_ADMIN_EMAIL ?? process.env.PLAYWRIGHT_ADMIN_EMAIL,
      password: process.env.PW_ADMIN_PASSWORD ?? process.env.PLAYWRIGHT_ADMIN_PASSWORD,
      label: 'PW_ADMIN_EMAIL + PW_ADMIN_PASSWORD',
    },
  ]);
  const supabase = createClient(resolveSupabaseUrl(), resolveSupabaseAnonKey());
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword(credentials);
  if (authError || !authData.session) {
    throw authError ?? new Error('Could not authenticate PDF visual smoke user.');
  }

  let assessmentResolution: PdfSmokeAssessmentResolution | null = null;
  try {
    assessmentResolution = await resolveAssessmentDocumentForPdfSmoke({
      baseUrl,
      supabaseUrl: resolveSupabaseUrl(),
      supabaseAnonKey: resolveSupabaseAnonKey(),
      accessToken: authData.session.access_token,
      preferredAssessmentDocumentId:
        process.env.PW_ASSESSMENT_DOCUMENT_ID?.trim() || process.env.ASSESSMENT_DOCUMENT_ID?.trim(),
      provisionClientId: process.env.PW_ASSESSMENT_CLIENT_ID?.trim(),
      sampleFilePath: process.env.PW_ASSESSMENT_SAMPLE_FILE?.trim(),
    });
    const assessmentDocumentId = assessmentResolution.assessmentDocumentId;

    const generateResponse = await fetch(`${baseUrl}/api/assessment-plan-pdf`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authData.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assessment_document_id: assessmentDocumentId }),
    });
    if (!generateResponse.ok) {
      throw new Error(`PDF generation failed with status ${generateResponse.status}: ${await generateResponse.text()}`);
    }
    const generated = (await generateResponse.json()) as GeneratePdfResponse;
    if (assessmentResolution.cleanupTarget) {
      assessmentResolution.cleanupGeneratedPdf = {
        bucketId: 'client-documents',
        objectPath: generated.object_path,
      };
    }
    const overflowKeys = generated.overflow_keys ?? generated.layout_warnings?.map((warning) => warning.placeholder_key) ?? [];
    if (overflowKeys.length > 0) {
      throw new Error(`PDF renderer reported layout overflow: ${overflowKeys.join(', ')}`);
    }

    const latestDir = ensureArtifactsDir();
    const outputDir = path.join(latestDir, `assessment-pdf-smoke-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });

    const generatedPdfResponse = await fetch(generated.signed_url);
    if (!generatedPdfResponse.ok) {
      throw new Error(`Could not download generated PDF: ${generatedPdfResponse.status}`);
    }
    const generatedPdfPath = path.join(outputDir, 'generated-caloptima.pdf');
    writeFileSync(generatedPdfPath, Buffer.from(await generatedPdfResponse.arrayBuffer()));

    const templatePath = path.resolve(process.cwd(), 'CalOptima Health FBA Template (2).pdf');
    const renderMap = JSON.parse(readFileSync(path.resolve(process.cwd(), 'docs/fill_docs/caloptima_fba_pdf_render_map.json'), 'utf8')) as {
      entries: RenderMapEntry[];
    };
    const expectedFilledPages = new Set(generated.filled_pages ?? []);
    if (expectedFilledPages.size === 0) {
      throw new Error('PDF visual smoke expected at least one filled page from the generation response.');
    }
    const pages = Array.from(new Set(renderMap.entries.map((entry) => entry.fallback.page))).sort((left, right) => left - right);
    if (!pages.includes(2)) {
      throw new Error('CalOptima PDF visual smoke requires page 2 coverage.');
    }

    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    const templateDataUrl = dataUrlForFile(templatePath, 'application/pdf');
    const generatedDataUrl = dataUrlForFile(generatedPdfPath, 'application/pdf');
    const reportPages: PageReport[] = [];

    try {
      for (const pageNumber of pages) {
        const blankScreenshot = path.join(outputDir, `blank-page-${pageNumber}.png`);
        const generatedScreenshot = path.join(outputDir, `generated-page-${pageNumber}.png`);
        const diffPath = path.join(outputDir, `diff-page-${pageNumber}.png`);
        await renderPdfPageScreenshot(page, templateDataUrl, pageNumber, blankScreenshot);
        await renderPdfPageScreenshot(page, generatedDataUrl, pageNumber, generatedScreenshot);
        const pageEntries = renderMap.entries.filter((entry) => entry.fallback.page === pageNumber);
        const comparison = await compareScreenshots(page, blankScreenshot, generatedScreenshot, pageEntries, diffPath);
        writeFileSync(diffPath, Buffer.from(comparison.diffDataUrl.split(',')[1] ?? '', 'base64'));
        reportPages.push({
          page: pageNumber,
          changedPixels: comparison.changedPixels,
          outsideAllowedPixels: comparison.outsideAllowedPixels,
          screenshot: generatedScreenshot,
          diff: diffPath,
        });
      }
    } finally {
      await browser.close();
    }

    const failingPages = reportPages.filter((entry) => entry.outsideAllowedPixels > OUTSIDE_ALLOWED_PIXEL_TOLERANCE);
    const totalChangedPixels = reportPages.reduce((sum, entry) => sum + entry.changedPixels, 0);
    const missingFilledPages = reportPages.filter(
      (entry) => expectedFilledPages.has(entry.page) && entry.changedPixels < MIN_CHANGED_PIXELS_PER_FILLED_PAGE,
    );
    const report = {
      ok: failingPages.length === 0 && missingFilledPages.length === 0 && totalChangedPixels > 0,
      assessmentDocumentId,
      assessmentSource: assessmentResolution.source,
      fillMode: generated.fill_mode,
      objectPath: generated.object_path,
      outputDir,
      outsideAllowedPixelTolerance: OUTSIDE_ALLOWED_PIXEL_TOLERANCE,
      minChangedPixelsPerFilledPage: MIN_CHANGED_PIXELS_PER_FILLED_PAGE,
      totalChangedPixels,
      expectedFilledPages: Array.from(expectedFilledPages).sort((left, right) => left - right),
      pages: reportPages,
    };
    const reportPath = path.join(outputDir, 'report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (totalChangedPixels === 0) {
      throw new Error(`PDF visual smoke could not detect rendered PDF changes. Report: ${reportPath}`);
    }
    if (missingFilledPages.length > 0) {
      throw new Error(
        `PDF visual smoke found mapped pages with non-empty fields but no rendered evidence: ${missingFilledPages
          .map((entry) => entry.page)
          .join(', ')}. Report: ${reportPath}`,
      );
    }
    if (failingPages.length > 0) {
      throw new Error(`PDF visual smoke found changed pixels outside mapped boxes. Report: ${reportPath}`);
    }
  } finally {
    if (assessmentResolution?.cleanupTarget) {
      await cleanupProvisionedAssessmentPdfSmokeArtifacts({
        baseUrl,
        supabaseUrl: resolveSupabaseUrl(),
        supabaseAnonKey: resolveSupabaseAnonKey(),
        accessToken: authData.session.access_token,
        resolution: assessmentResolution,
      });
    }
  }
}

run().catch((error) => {
  console.error('Playwright assessment PDF smoke failed', error);
  process.exit(1);
});
