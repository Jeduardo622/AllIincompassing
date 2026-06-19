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

const hasText = (item: unknown): item is { str: string } => {
  return typeof item === 'object' && item !== null && 'str' in item && typeof item.str === 'string';
};

export async function extractPdfText(file: File): Promise<string> {
  if (!isPdfFile(file)) {
    throw new PdfTextExtractionError('Unsupported file type. Please select a PDF file.');
  }

  const data = await file.arrayBuffer();
  const document = await pdfjs.getDocument({ data }).promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter(hasText)
      .map((item) => item.str)
      .join(' ');

    pageTexts.push(pageText);
  }

  const text = pageTexts.join('\n').trim();
  if (!text) {
    throw new PdfTextExtractionError('No embedded PDF text was found.');
  }

  return text;
}
