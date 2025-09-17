const REDACTED_VALUE = '****';

const EXACT_SENSITIVE_KEYS = new Set([
  'name',
  'full_name',
  'firstname',
  'lastname',
  'middlename',
  'first_name',
  'last_name',
  'middle_name',
  'given_name',
  'family_name',
  'client_name',
  'patient_name',
  'member_name',
  'guardian_name',
  'caregiver_name',
  'email',
  'email_address',
  'phone',
  'phone_number',
  'mobile',
  'mobile_number',
  'dob',
  'date_of_birth',
  'birth_date',
  'birthdate',
  'diagnosis',
  'diagnoses',
  'identifier',
  'unique_identifier',
  'mrn',
  'ssn',
  'id',
  'client_id',
  'patient_id',
  'member_id',
  'authorization_id',
  'auth_id',
  'case_id',
  'record_id',
  'conversation_id',
  'conversationid'
]);

const KEYWORD_FRAGMENTS = [
  'name',
  'email',
  'phone',
  'dob',
  'birth',
  'diagnosis',
  'identifier',
  'conversation'
];

const SENSITIVE_SUFFIXES = [
  '_name',
  '_email',
  '_phone',
  '_dob',
  '_birth',
  '_diagnosis',
  '_identifier',
  '_conversation',
  '_conversation_id',
  '_id'
];

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /\b(?:\+?1[-.\s]*)?(?:\(\d{3}\)|\d{3})[-.\s]*\d{3}[-.\s]*\d{4}\b/g;
const ISO_DOB_PATTERN = /\b(?:19|20)\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])\b/g;
const US_DOB_PATTERN = /\b(?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g;
const TEXTUAL_DOB_PATTERN = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},\s+(?:19|20)\d{2}\b/gi;

const LABELED_PATTERNS: RegExp[] = [
  /((?:first|middle|last|full)\s+name\s*(?:is)?\s*(?:=|:|-)\s*)([^\n\r,;]+)/gi,
  /((?:client|patient|member|guardian|caregiver)\s+name\s*(?:is)?\s*(?:=|:|-)\s*)([^\n\r,;]+)/gi,
  /((?:email|e-mail)\s*(?:=|:|-)\s*)([^\n\r,;]+)/gi,
  /((?:phone|mobile|contact\s*number)\s*(?:=|:|-)\s*)([^\n\r,;]+)/gi,
  /((?:dob|date\s*of\s*birth)\s*(?:=|:|-)\s*)([^\n\r,;]+)/gi,
  /((?:diagnosis|diagnoses|dx)\s*(?:=|:|-)\s*)([^\n\r,;]+)/gi,
  /((?:identifier|mrn|ssn)\s*(?:=|:|#)\s*)([^\n\r,;]+)/gi,
  /((?:conversation\s*id|authorization\s*id|client\s*id|patient\s*id|member\s*id|case\s*id|record\s*id)\s*(?:=|:|#)\s*)([^\n\r,;]+)/gi
];

const DIRECT_PATTERNS: RegExp[] = [
  EMAIL_PATTERN,
  PHONE_PATTERN,
  ISO_DOB_PATTERN,
  US_DOB_PATTERN,
  TEXTUAL_DOB_PATTERN
];

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject => (
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !(value instanceof Error)
);

const normalizeKey = (key: string): string => key.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');

const shouldRedactKey = (key: string): boolean => {
  const normalized = normalizeKey(key);

  if (!normalized) {
    return false;
  }

  if (EXACT_SENSITIVE_KEYS.has(normalized)) {
    return true;
  }

  if (SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }

  return KEYWORD_FRAGMENTS.some((fragment) => normalized.includes(fragment));
};

const applyLabeledPatterns = (value: string): string => LABELED_PATTERNS.reduce(
  (acc, pattern) => acc.replace(pattern, (_, prefix: string) => `${prefix}${REDACTED_VALUE}`),
  value
);

const applyKeyValueRedaction = (value: string): string =>
  value.replace(/([A-Za-z0-9_\-"']+[A-Za-z0-9_\-"'\s]*?)(\s*(?:=|:)\s*)([^\n\r,;&]+)/g, (match, rawKey, separator) => {
    const cleanKey = rawKey.replace(/['"\s]+/g, ' ').trim();
    if (shouldRedactKey(cleanKey)) {
      return `${rawKey}${separator}${REDACTED_VALUE}`;
    }
    return match;
  });

const applyJsonRedaction = (value: string): string => value
  .replace(/"([^"\\]+)"\s*:\s*"([^"\\]*)"/g, (match, rawKey) => (
    shouldRedactKey(rawKey)
      ? `"${rawKey}": "${REDACTED_VALUE}`.concat('"')
      : match
  ))
  .replace(/"([^"\\]+)"\s*:\s*(\d+)/g, (match, rawKey) => (
    shouldRedactKey(rawKey)
      ? `"${rawKey}": "${REDACTED_VALUE}`.concat('"')
      : match
  ));

const applyDirectPatterns = (value: string): string => DIRECT_PATTERNS.reduce(
  (acc, pattern) => acc.replace(pattern, REDACTED_VALUE),
  value
);

const applyIdentifierRedaction = (value: string): string => value.replace(
  /(conversation[_\s-]?id|authorization[_\s-]?id|client[_\s-]?id|patient[_\s-]?id|member[_\s-]?id|case[_\s-]?id|record[_\s-]?id)(\s*(?:#|=|:)?\s*)([^\n\r,;&]+)/gi,
  (_match, label, separator) => `${label}${separator}${REDACTED_VALUE}`
);

const redactString = (value: string): string => {
  let result = value;
  result = applyJsonRedaction(result);
  result = applyKeyValueRedaction(result);
  result = applyLabeledPatterns(result);
  result = applyIdentifierRedaction(result);
  result = applyDirectPatterns(result);
  return result;
};

const sanitizeError = (error: Error): PlainObject => ({
  name: error.name,
  message: redactString(error.message),
  stack: typeof error.stack === 'string' ? redactString(error.stack) : undefined
});

const redactValue = (value: unknown, key: string | undefined, seen: WeakSet<object>): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (key && shouldRedactKey(key)) {
      return REDACTED_VALUE;
    }
    return redactString(value);
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return key && shouldRedactKey(key) ? REDACTED_VALUE : value;
  }

  if (value instanceof Date) {
    return key && shouldRedactKey(key) ? REDACTED_VALUE : value;
  }

  if (value instanceof Error) {
    return sanitizeError(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    return value.map((item) => redactValue(item, undefined, seen));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return {};
    }
    seen.add(value);
    return Object.entries(value).reduce<PlainObject>((acc, [entryKey, entryValue]) => {
      if (shouldRedactKey(entryKey)) {
        acc[entryKey] = REDACTED_VALUE;
      } else {
        acc[entryKey] = redactValue(entryValue, entryKey, seen);
      }
      return acc;
    }, {});
  }

  return value;
};

export const redactPhi = <T>(input: T): T => {
  const seen = new WeakSet<object>();
  return redactValue(input, undefined, seen) as T;
};

export { REDACTED_VALUE };
