const PUNCTUATION_SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E]/g, '"'],
  [/[\u2013\u2014\u2212]/g, "-"],
  [/[\u2022\u25CF\u25CB\u25A0]/g, "-"],
  [/\u2026/g, "..."],
];

const isAllowedPdfCharacter = (character: string): boolean => {
  if (character === "\n" || character === "\r" || character === "\t") return true;
  const codePoint = character.codePointAt(0) ?? 0;
  return (codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff);
};

export const sanitizePdfText = (value: string): string =>
  PUNCTUATION_SUBSTITUTIONS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value)
    .split("")
    .map((character) => (isAllowedPdfCharacter(character) ? character : " "))
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

const normalizeCheckboxValue = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "checked" || normalized === "1";
};

export const resolvePdfCheckboxValue = (rawValue: string): boolean | null => {
  const trimmedRawValue = rawValue.trim();
  if (!trimmedRawValue) return null;

  const sanitizedValue = sanitizePdfText(trimmedRawValue);
  return normalizeCheckboxValue(sanitizedValue || trimmedRawValue);
};
