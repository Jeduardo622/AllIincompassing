export type AuthorizationPdfStatus = 'approved' | 'pending' | 'denied';

export interface AuthorizationPdfPrefillService {
  serviceCode: string;
  requestedUnits?: number;
  approvedUnits?: number;
}

export interface AuthorizationPdfPrefill {
  authorizationNumber?: string;
  status?: AuthorizationPdfStatus;
  startDate?: string;
  endDate?: string;
  diagnosisCode?: string;
  diagnosisDescription?: string;
  memberId?: string;
  services: AuthorizationPdfPrefillService[];
}

export interface AuthorizationPdfMergeInput {
  authorizationNumber: string;
  status: AuthorizationPdfStatus;
  startDate: string;
  endDate: string;
  diagnosisCode: string;
  diagnosisDescription: string;
  memberId: string;
  services: string[];
  units: Record<string, number>;
}

export interface AuthorizationPdfMergeResult<T extends AuthorizationPdfMergeInput> {
  data: T;
  appliedFields: string[];
  skippedServiceCodes: string[];
}

export interface AuthorizationPdfMergeOptions {
  statusFieldIsDefault?: boolean;
  diagnosisCodeFieldIsDefault?: boolean;
  diagnosisDescriptionFieldIsDefault?: boolean;
  defaultDiagnosisCode?: string;
  defaultDiagnosisDescription?: string;
}

const DATE_PATTERN = String.raw`(?:\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})`;
const SERVICE_CODE_PATTERN_SOURCE = String.raw`(?:97(?:151|152|153|154|155|156|157|158)|0\d{3}T|H[O0]\d{3}(?:-?[A-Z0-9]{2})?|[A-Z]\d{4}(?:-?[A-Z0-9]{2})?)`;
const SERVICE_CODE_PATTERN = new RegExp(String.raw`\b${SERVICE_CODE_PATTERN_SOURCE}\b`, 'g');
const SERVICE_ROW_START_PATTERN = new RegExp(String.raw`^${SERVICE_CODE_PATTERN_SOURCE}\b`, 'i');
const SERVICE_CONTEXT_PATTERN = /\b(?:procedure|service|code|cpt|hcpcs)\b/i;
const ICD_CODE_PATTERN_SOURCE = String.raw`[A-Z]\d{2}(?:\.\d+)?(?![A-Z0-9])`;
const DEFAULT_DIAGNOSIS_CODE = 'F84.0';
const DEFAULT_DIAGNOSIS_DESCRIPTION = 'Autistic disorder';

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const isRealCalendarDate = (year: number, month: number, day: number): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const normalizeDate = (value: string): string | undefined => {
  const raw = value.trim();
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!isRealCalendarDate(year, month, day)) {
      return undefined;
    }

    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  const dateMatch = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(raw);
  if (!dateMatch) {
    return undefined;
  }

  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]);
  if (year < 2000 || !isRealCalendarDate(year, month, day)) {
    return undefined;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const firstMatch = (text: string, patterns: RegExp[]): string | undefined => {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    pattern.lastIndex = 0;
    const value = match?.[1]?.trim();
    if (value) {
      return collapseWhitespace(value);
    }
  }
  return undefined;
};

const parseStatus = (text: string): AuthorizationPdfStatus | undefined => {
  const explicitStatus =
    /\b(?:status|decision)\s*(?:is\s+|:\s*)?(approved|pending|denied|requested)\b/i.exec(text) ??
    /\b(approved|pending|denied|requested)\s+(?:status|decision)\b/i.exec(text);
  const value = explicitStatus?.[1]?.toLowerCase();
  if (value === 'denied') return 'denied';
  if (value === 'approved') return 'approved';
  if (value === 'pending' || value === 'requested') return 'pending';
  const authorizedProse = /\b(?:requested\s+services?|services?)\s+ha(?:s|ve)\s+been\s+authorized\b/i;
  const negativeOrPartialProse =
    /\b(?:not\s+all|not|partially|partial|in\s+part|modifications?|modified)\b[\s\S]{0,80}\b(?:requested\s+services?|services?|authorized)\b/i;
  const qualifiedAuthorizationProse =
    /\bauthorized\b[\s\S]{0,80}\b(?:not\s+all|not|in\s+part|partially|partial|modifications?|modified)\b/i;
  if (authorizedProse.test(text) && !negativeOrPartialProse.test(text) && !qualifiedAuthorizationProse.test(text)) {
    return 'approved';
  }
  return undefined;
};

const parseDates = (text: string): Pick<AuthorizationPdfPrefill, 'startDate' | 'endDate'> => {
  const serviceRange = new RegExp(
    `(?:service\\s*)?(?:from|start)\\s*:?\\s*(${DATE_PATTERN})[\\s\\S]{0,80}?(?:to|end)\\s*:?\\s*(${DATE_PATTERN})`,
    'i',
  ).exec(text);
  if (serviceRange) {
    const startDate = normalizeDate(serviceRange[1]);
    const endDate = normalizeDate(serviceRange[2]);
    if (!startDate || !endDate) {
      return {};
    }

    return {
      startDate,
      endDate,
    };
  }

  const compactRange = new RegExp(
    `(${DATE_PATTERN})\\s*(?:-|to|through|\\s+)\\s*(${DATE_PATTERN})`,
    'i',
  ).exec(text);
  if (compactRange) {
    const startDate = normalizeDate(compactRange[1]);
    const endDate = normalizeDate(compactRange[2]);
    if (!startDate || !endDate) {
      return {};
    }

    return {
      startDate,
      endDate,
    };
  }

  const serviceRowRange = new RegExp(
    `${SERVICE_CODE_PATTERN_SOURCE}[\\s\\S]{0,120}?(${DATE_PATTERN})\\D{0,20}?(${DATE_PATTERN})`,
    'i',
  ).exec(text);
  if (serviceRowRange) {
    const startDate = normalizeDate(serviceRowRange[1]);
    const endDate = normalizeDate(serviceRowRange[2]);
    if (startDate && endDate) {
      return {
        startDate,
        endDate,
      };
    }
  }

  return {};
};

const parseDiagnosis = (
  text: string,
): Pick<AuthorizationPdfPrefill, 'diagnosisCode' | 'diagnosisDescription'> => {
  const inlineDiagnosisPattern = new RegExp(
    String.raw`\b(?:diagnosis|icd-?10(?: code)?)\s*:?\s*(${ICD_CODE_PATTERN_SOURCE})\s*(?:-|:)?\s*([A-Za-z][^\n\r]{2,80})?`,
    'i',
  );
  const multilineDiagnosisPattern = new RegExp(
    String.raw`\b(?:diagnosis|icd-?10(?: code)?)[^\n\r]*[\n\r]+\s*(?:\d+\s*)?\(?(${ICD_CODE_PATTERN_SOURCE})\)?\s*(?:-|:)?\s*([A-Za-z][^\n\r]{2,80})?`,
    'i',
  );
  const match =
    inlineDiagnosisPattern.exec(text) ?? multilineDiagnosisPattern.exec(text);
  if (!match) {
    return {};
  }

  return {
    diagnosisCode: match[1].toUpperCase(),
    diagnosisDescription: match[2] ? collapseWhitespace(match[2]) : undefined,
  };
};

const parseLabeledUnits = (text: string, label: 'requested' | 'approved'): number | undefined => {
  const match = new RegExp(`\\b${label}(?:\\s+units)?\\s*:?\\s*(\\d+)`, 'i').exec(text);
  return match ? Number(match[1]) : undefined;
};

const parseServices = (text: string): AuthorizationPdfPrefillService[] => {
  const services = new Map<string, AuthorizationPdfPrefillService>();
  const lines = text.split(/\r?\n/).map(collapseWhitespace).filter(Boolean);
  const globalRequestedUnits = parseLabeledUnits(text, 'requested');
  const globalApprovedUnits = parseLabeledUnits(text, 'approved');
  const setService = (service: AuthorizationPdfPrefillService) => {
    const serviceCode = normalizeParsedServiceCode(service.serviceCode);
    const existing = services.get(serviceCode) ?? { serviceCode };
    services.set(serviceCode, {
      serviceCode,
      requestedUnits: service.requestedUnits ?? existing.requestedUnits,
      approvedUnits: service.approvedUnits ?? existing.approvedUnits,
    });
  };

  for (const line of lines) {
    if (!SERVICE_CONTEXT_PATTERN.test(line) && !SERVICE_ROW_START_PATTERN.test(line)) {
      continue;
    }

    const codes = getServiceCodesFromLine(line);
    for (const serviceCode of codes) {
      const existing = services.get(serviceCode) ?? { serviceCode };
      const requestedUnits = parseLabeledUnits(line, 'requested') ?? existing.requestedUnits;
      const approvedUnits = parseLabeledUnits(line, 'approved') ?? existing.approvedUnits;
      const compactUnits = parseCompactServiceRowUnits(line, serviceCode);

      setService({
        serviceCode,
        requestedUnits: requestedUnits ?? compactUnits?.requestedUnits,
        approvedUnits: approvedUnits ?? compactUnits?.approvedUnits,
      });
    }
  }

  for (const service of parseVerticalServiceBlocks(lines)) {
    setService(service);
  }

  if (services.size === 1) {
    const [service] = services.values();
    service.requestedUnits ??= globalRequestedUnits;
    service.approvedUnits ??= globalApprovedUnits;
  }

  return [...services.values()];
};

const getServiceCodesFromLine = (line: string): string[] => {
  const normalizedLine = line.replace(
    /\b(H[O0]\d{3})\s*\(\s*([A-Z0-9]{2})\s*\)/gi,
    (_, code: string, modifier: string) => `${code}-${modifier}`,
  );
  return [...normalizedLine.matchAll(SERVICE_CODE_PATTERN)].map((match) =>
    normalizeParsedServiceCode(match[0]),
  );
};

const normalizeParsedServiceCode = (code: string): string => {
  const upper = code.toUpperCase().replace(/\s+/g, '');
  const ocrHCode = /^HO(\d{3})(?:-?([A-Z0-9]{2}))?$/.exec(upper);
  if (ocrHCode) {
    return `H0${ocrHCode[1]}${ocrHCode[2] ? `-${ocrHCode[2]}` : ''}`;
  }

  const parentheticalModifier = /^([A-Z]\d{4})\(([A-Z0-9]{2})\)$/.exec(upper);
  if (parentheticalModifier) {
    return `${parentheticalModifier[1]}-${parentheticalModifier[2]}`;
  }

  return upper;
};

const parseVerticalServiceBlocks = (lines: string[]): AuthorizationPdfPrefillService[] => {
  const services: AuthorizationPdfPrefillService[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^(?:\d+\s+)?Code(?:\s+\(Modifier\))?$/i.test(lines[index])) {
      continue;
    }

    const block = lines.slice(index + 1, index + 18);
    const codeLine = block.find((line) => getServiceCodesFromLine(line).length > 0);
    const serviceCode = codeLine ? getServiceCodesFromLine(codeLine)[0] : undefined;
    if (!serviceCode) {
      continue;
    }

    const approvedIndex = block.findIndex((line) => /^Approved\b/i.test(line));
    const approvedBlock = approvedIndex >= 0 ? block.slice(approvedIndex + 1) : block;
    const unitsLine = approvedBlock.find((line) => /\b\d+\s+Units\b/i.test(line));
    const approvedUnits = unitsLine ? Number(/\b(\d+)\s+Units\b/i.exec(unitsLine)?.[1]) : undefined;
    services.push({
      serviceCode,
      approvedUnits: Number.isFinite(approvedUnits) ? approvedUnits : undefined,
    });
  }

  return services;
};

const parseCompactServiceRowUnits = (
  line: string,
  serviceCode: string,
): Pick<AuthorizationPdfPrefillService, 'requestedUnits' | 'approvedUnits'> | undefined => {
  const escapedServiceCode = serviceCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutDates = line
    .replace(new RegExp(DATE_PATTERN, 'g'), ' ')
    .replace(new RegExp(`\\b${escapedServiceCode}\\b`, 'i'), ' ');
  const numbers = withoutDates.match(/\b\d+\b/g)?.map(Number).filter((value) => value > 0) ?? [];
  if (numbers.length < 2) {
    return undefined;
  }

  return {
    requestedUnits: numbers.at(-2),
    approvedUnits: numbers.at(-1),
  };
};

export const parseAuthorizationPdfText = (text: string): AuthorizationPdfPrefill => {
  const normalizedText = text.replace(/\u00a0/g, ' ');
  const authorizationNumber = firstMatch(normalizedText, [
    /\b(?:authorization|auth)\s*(?:(?:#|number)\s*:?\s*|no\.?(?:\s+|:\s*)|:\s*)([A-Z0-9][A-Z0-9-]{3,})/i,
    /\breferral\s*(?:id|#|number)?\s*:?\s*([A-Z0-9][A-Z0-9-]{3,})/i,
  ]);
  const memberId = firstMatch(normalizedText, [
    /\bmember\s*(?:(?:id|#|number)\s*:?\s*|:\s*)((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{2,})/i,
    /\bcin\s*(?:#|id|number)?\s*:?\s*([A-Z0-9][A-Z0-9-]{2,})/i,
  ]);

  return stripUndefined({
    authorizationNumber,
    status: parseStatus(normalizedText),
    memberId,
    ...parseDiagnosis(normalizedText),
    ...parseDates(normalizedText),
    services: parseServices(normalizedText),
  });
};

export const mergeAuthorizationPdfPrefill = <T extends AuthorizationPdfMergeInput>(
  current: T,
  prefill: AuthorizationPdfPrefill,
  serviceCatalog: Record<string, string>,
  options: AuthorizationPdfMergeOptions = {},
): AuthorizationPdfMergeResult<T> => {
  const next: T = {
    ...current,
    services: [...current.services],
    units: { ...current.units },
  };
  const appliedFields = new Set<string>();
  const skippedServiceCodes = new Set<string>();
  const defaultDiagnosisCode = options.defaultDiagnosisCode ?? DEFAULT_DIAGNOSIS_CODE;
  const defaultDiagnosisDescription =
    options.defaultDiagnosisDescription ?? DEFAULT_DIAGNOSIS_DESCRIPTION;

  const fillIfBlank = <K extends keyof T>(field: K, value: T[K] | undefined) => {
    if (!next[field] && value) {
      next[field] = value;
      appliedFields.add(String(field));
    }
  };

  fillIfBlank('authorizationNumber', prefill.authorizationNumber as T['authorizationNumber']);
  fillIfBlank('startDate', prefill.startDate as T['startDate']);
  fillIfBlank('endDate', prefill.endDate as T['endDate']);
  fillIfBlank('memberId', prefill.memberId as T['memberId']);

  if (prefill.status && (!current.status || options.statusFieldIsDefault)) {
    next.status = prefill.status as T['status'];
    appliedFields.add('status');
  }

  const currentDiagnosisCodeIsDefault =
    current.diagnosisCode.trim().toUpperCase() === defaultDiagnosisCode.toUpperCase();
  const currentDiagnosisDescriptionIsDefault =
    collapseWhitespace(current.diagnosisDescription).toLowerCase() ===
    collapseWhitespace(defaultDiagnosisDescription).toLowerCase();

  if (
    prefill.diagnosisCode &&
    (!current.diagnosisCode || (options.diagnosisCodeFieldIsDefault && currentDiagnosisCodeIsDefault))
  ) {
    next.diagnosisCode = prefill.diagnosisCode as T['diagnosisCode'];
    appliedFields.add('diagnosisCode');
  }

  if (
    prefill.diagnosisDescription &&
    (!current.diagnosisDescription ||
      (options.diagnosisDescriptionFieldIsDefault && currentDiagnosisDescriptionIsDefault))
  ) {
    next.diagnosisDescription = prefill.diagnosisDescription as T['diagnosisDescription'];
    appliedFields.add('diagnosisDescription');
  }

  for (const service of prefill.services) {
    const parsedCode = service.serviceCode.toUpperCase();
    const code = resolveCatalogServiceCode(parsedCode, serviceCatalog);
    if (!code) {
      skippedServiceCodes.add(parsedCode);
      continue;
    }

    if (!next.services.includes(code)) {
      next.services.push(code);
      appliedFields.add('services');
    }

    const units = service.approvedUnits ?? service.requestedUnits;
    if (units && units > 0 && !next.units[code]) {
      next.units[code] = units;
      appliedFields.add('units');
    }
  }

  return {
    data: next,
    appliedFields: [...appliedFields],
    skippedServiceCodes: [...skippedServiceCodes],
  };
};

const normalizeServiceCodeForCatalogMatch = (code: string): string => {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
};

const resolveCatalogServiceCode = (
  parsedCode: string,
  serviceCatalog: Record<string, string>,
): string | undefined => {
  const normalizedParsedCode = normalizeServiceCodeForCatalogMatch(parsedCode);
  const matches = Object.keys(serviceCatalog).filter(
    (catalogCode) => normalizeServiceCodeForCatalogMatch(catalogCode) === normalizedParsedCode,
  );
  return matches.length === 1 ? matches[0] : undefined;
};

const stripUndefined = (prefill: AuthorizationPdfPrefill): AuthorizationPdfPrefill => {
  return Object.fromEntries(
    Object.entries(prefill).filter(([, value]) => value !== undefined),
  ) as unknown as AuthorizationPdfPrefill;
};
