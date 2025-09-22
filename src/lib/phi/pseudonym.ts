import { redactPhi } from '../logger/redactPhi.ts';

export type PseudonymMap = Record<string, string>;

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

const normalizeSource = (value: string): string => value.trim().toLowerCase();

export const hashIdentifier = (value: string): string => {
  const normalized = normalizeSource(value || '');
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return (hash >>> 0).toString(36);
};

export const createPseudonym = (prefix: string, identifier?: string | null): string => {
  const source = identifier && identifier.trim().length > 0 ? identifier : `${prefix}-unknown`;
  const hashed = hashIdentifier(source);
  return `${prefix}-${hashed}`;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, (match) => `\\${match}`);

export const applyPseudonymMap = (input: string, map: PseudonymMap): string => {
  const validEntries = Object.entries(map).filter(([target, alias]) => Boolean(target) && Boolean(alias));

  if (validEntries.length === 0) {
    return input;
  }

  return validEntries
    .sort((a, b) => b[0].length - a[0].length)
    .reduce((acc, [target, alias]) => acc.replace(new RegExp(escapeRegExp(target), 'gi'), alias), input);
};

export const redactAndPseudonymize = (input: string, map: PseudonymMap): string => {
  const withPseudonyms = applyPseudonymMap(input, map);
  return (redactPhi(withPseudonyms) as string) ?? '';
};

export const registerPseudonym = (map: PseudonymMap, value: string | null | undefined, alias: string): void => {
  if (!value) {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  if (map[trimmed] && map[trimmed] !== alias) {
    return;
  }
  map[trimmed] = alias;
};

export const registerNamePseudonym = (map: PseudonymMap, value: string | null | undefined, alias: string): void => {
  if (!value) {
    return;
  }
  registerPseudonym(map, value, alias);
  value
    .split(/[\s,]+/)
    .map(part => part.trim())
    .filter(part => part.length > 1)
    .forEach(part => {
      registerPseudonym(map, part, alias);
    });
};

