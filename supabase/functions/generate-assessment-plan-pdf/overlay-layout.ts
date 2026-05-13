export interface OverlayFallbackBox {
  page: number;
  x: number;
  y: number;
  font_size: number;
  max_width: number;
  height?: number;
  line_height?: number;
  max_lines?: number;
  field_kind?: string;
}

export interface OverlayRenderMapEntry {
  placeholder_key: string;
  fallback: OverlayFallbackBox;
}

export interface OverlayLayoutWarning {
  placeholder_key: string;
  page: number;
  reason: "overflow";
  rendered_line_count: number;
  total_line_count: number;
  max_lines: number;
}

export interface OverlayLayoutResult {
  lines: string[];
  line_height: number;
  warning: OverlayLayoutWarning | null;
}

interface PdfFontLike {
  widthOfTextAtSize: (value: string, size: number) => number;
}

const DEFAULT_FIELD_HEIGHT_MULTIPLIER = 1.4;

interface WrappedToken {
  text: string;
  continuesPreviousToken: boolean;
}

const splitLongWord = (word: string, maxWidth: number, font: PdfFontLike, fontSize: number): WrappedToken[] => {
  if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
    return [{ text: word, continuesPreviousToken: false }];
  }

  const chunks: WrappedToken[] = [];
  let current = "";
  for (const character of word) {
    const candidate = `${current}${character}`;
    if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      chunks.push({ text: current, continuesPreviousToken: chunks.length > 0 });
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push({ text: current, continuesPreviousToken: chunks.length > 0 });
  return chunks;
};

export const wrapOverlayText = (
  text: string,
  maxWidth: number,
  font: PdfFontLike,
  fontSize: number,
): string[] => {
  const paragraphs = text
    .split(/\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).flatMap((word) => splitLongWord(word, maxWidth, font, fontSize));
    if (words.length === 0) continue;

    let currentLine = words[0].text;
    for (let index = 1; index < words.length; index += 1) {
      const nextWord = words[index];
      const candidate = `${currentLine}${nextWord.continuesPreviousToken ? "" : " "}${nextWord.text}`;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = nextWord.text;
      }
    }
    lines.push(currentLine);
  }

  return lines;
};

export const layoutOverlayText = (
  entry: OverlayRenderMapEntry,
  value: string,
  font: PdfFontLike,
): OverlayLayoutResult => {
  const { fallback } = entry;
  const lineHeight = fallback.line_height ?? fallback.font_size + 2;
  const fieldHeight = fallback.height ?? fallback.font_size * DEFAULT_FIELD_HEIGHT_MULTIPLIER;
  const heightBoundedMaxLines = Math.max(1, Math.floor(fieldHeight / lineHeight));
  const maxLines = Math.max(1, Math.min(fallback.max_lines ?? heightBoundedMaxLines, heightBoundedMaxLines));
  const lines = wrapOverlayText(value, fallback.max_width, font, fallback.font_size);
  const renderedLines = lines.slice(0, maxLines);

  return {
    lines: renderedLines,
    line_height: lineHeight,
    warning:
      lines.length > renderedLines.length
        ? {
            placeholder_key: entry.placeholder_key,
            page: fallback.page,
            reason: "overflow",
            rendered_line_count: renderedLines.length,
            total_line_count: lines.length,
            max_lines: maxLines,
          }
        : null,
  };
};
