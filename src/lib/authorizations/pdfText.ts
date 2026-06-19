import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export class PdfTextExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfTextExtractionError';
  }
}

const isPdfFile = (file: File): boolean => {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
};

const LINE_Y_TOLERANCE = 2;

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  transform?: unknown[];
}

interface PositionedTextItem extends PdfTextItem {
  x: number;
  y: number;
}

const hasText = (item: unknown): item is PdfTextItem => {
  return typeof item === 'object' && item !== null && 'str' in item && typeof item.str === 'string';
};

const getCoordinate = (item: PdfTextItem, index: 4 | 5): number | undefined => {
  const value = item.transform?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const getPositionedItem = (item: PdfTextItem): PositionedTextItem | undefined => {
  const x = getCoordinate(item, 4);
  const y = getCoordinate(item, 5);
  return x === undefined || y === undefined ? undefined : { ...item, x, y };
};

const getLineText = (items: PdfTextItem[]): string => {
  return items.map((item) => item.str).join(' ').trimEnd();
};

const getPositionedPageText = (items: PositionedTextItem[]): string => {
  const lines: PositionedTextItem[][] = [];

  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) <= LINE_Y_TOLERANCE);
    if (line) {
      line.push(item);
    } else {
      lines.push([item]);
    }
  }

  return lines
    .flatMap((line) => {
      const splitLines: PositionedTextItem[][] = [[]];
      for (const item of line.sort((a, b) => a.x - b.x)) {
        splitLines[splitLines.length - 1].push(item);
        if (item.hasEOL) {
          splitLines.push([]);
        }
      }

      return splitLines;
    })
    .map(getLineText)
    .join('\n');
};

const getPageText = (items: unknown[]): string => {
  const textItems = items.filter(hasText);
  const positionedItems = textItems.map(getPositionedItem).filter((item) => item !== undefined);

  if (positionedItems.length > 0) {
    return getPositionedPageText(positionedItems);
  }

  const lines: PdfTextItem[][] = [[]];
  for (const item of textItems) {
    lines[lines.length - 1].push(item);
    if (item.hasEOL) {
      lines.push([]);
    }
  }

  return lines.map(getLineText).join('\n').trimEnd();
};

export async function extractPdfText(file: File): Promise<string> {
  if (!isPdfFile(file)) {
    throw new PdfTextExtractionError('Unsupported file type. Please select a PDF file.');
  }

  let loadingTask: pdfjs.PDFDocumentLoadingTask | undefined;
  let document: pdfjs.PDFDocumentProxy | undefined;

  try {
    let data: ArrayBuffer | undefined = await file.arrayBuffer();
    loadingTask = pdfjs.getDocument({ data });
    data = undefined;
    document = await loadingTask.promise;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      pageTexts.push(getPageText(textContent.items));
    }

    const text = pageTexts.join('\n').trim();
    if (!text) {
      throw new PdfTextExtractionError('No embedded PDF text was found.');
    }

    return text;
  } catch (error) {
    if (error instanceof PdfTextExtractionError) {
      throw error;
    }

    throw new PdfTextExtractionError(
      'PDF text extraction failed. Enter the authorization fields manually.'
    );
  } finally {
    try {
      await document?.cleanup();
    } catch {
      // Ignore cleanup failures so user-facing extraction errors stay bounded.
    }

    try {
      await loadingTask?.destroy();
    } catch {
      // Ignore cleanup failures so user-facing extraction errors stay bounded.
    }
  }
}
