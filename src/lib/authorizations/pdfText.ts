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

const hasText = (item: unknown): item is { str: string; hasEOL?: boolean } => {
  return typeof item === 'object' && item !== null && 'str' in item && typeof item.str === 'string';
};

const getPageText = (items: unknown[]): string => {
  return items
    .filter(hasText)
    .map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`)
    .join('')
    .trimEnd();
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
