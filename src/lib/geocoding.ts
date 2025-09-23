import type { Location } from '../types';

export type GeocodedLocation = Pick<Location, 'latitude' | 'longitude' | 'address'>;

export type GeocodingProvider = (address: string) => GeocodedLocation | null;

interface GeocodeCacheEntry {
  latitude: number;
  longitude: number;
}

interface GeocodingState {
  enabled: boolean;
  provider: GeocodingProvider;
}

const DEFAULT_BASE_COORDINATES = {
  latitude: 40.7128,
  longitude: -74.006,
};

const HASH_OFFSET_RANGE = 0.1;

const geocodeCache = new Map<string, GeocodeCacheEntry | null>();

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

const normalizeAddress = (address: string | null | undefined): string => {
  if (!address) {
    return '';
  }
  return address.trim().replace(/\s+/g, ' ').toLowerCase();
};

const hashString = (value: string): number => {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
};

const toUnitRange = (hash: number): number => hash / 0xffffffff;

const computeOffset = (normalizedAddress: string, axis: 'lat' | 'lon'): number => {
  const ratio = toUnitRange(hashString(`${axis}:${normalizedAddress}`));
  return (ratio * 2 - 1) * HASH_OFFSET_RANGE;
};

const truncateCoordinate = (value: number): number => Number(value.toFixed(6));

const deterministicGeocoder: GeocodingProvider = (address: string) => {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return null;
  }

  const latitude = truncateCoordinate(
    DEFAULT_BASE_COORDINATES.latitude + computeOffset(normalized, 'lat')
  );
  const longitude = truncateCoordinate(
    DEFAULT_BASE_COORDINATES.longitude + computeOffset(normalized, 'lon')
  );

  return {
    latitude,
    longitude,
    address: address.trim(),
  };
};

let geocodingState: GeocodingState = {
  enabled: true,
  provider: deterministicGeocoder,
};

const getCacheKey = (address: string): string => normalizeAddress(address);

export const geocodeAddress = (address?: string | null): GeocodedLocation | null => {
  const trimmed = typeof address === 'string' ? address.trim() : '';
  if (!trimmed) {
    return null;
  }

  if (!geocodingState.enabled) {
    return null;
  }

  const cacheKey = getCacheKey(trimmed);
  if (geocodeCache.has(cacheKey)) {
    const cached = geocodeCache.get(cacheKey);
    if (!cached) {
      return null;
    }
    return {
      latitude: cached.latitude,
      longitude: cached.longitude,
      address: trimmed,
    };
  }

  const result = geocodingState.provider(trimmed);
  if (!result) {
    geocodeCache.set(cacheKey, null);
    return null;
  }

  const entry: GeocodeCacheEntry = {
    latitude: truncateCoordinate(result.latitude),
    longitude: truncateCoordinate(result.longitude),
  };
  geocodeCache.set(cacheKey, entry);

  return {
    latitude: entry.latitude,
    longitude: entry.longitude,
    address: result.address ?? trimmed,
  };
};

export interface GeocodingConfigurationOptions {
  enabled?: boolean;
  provider?: GeocodingProvider;
}

export const configureGeocoding = (options: GeocodingConfigurationOptions): void => {
  if (typeof options.enabled === 'boolean') {
    geocodingState.enabled = options.enabled;
  }
  if (options.provider) {
    geocodingState.provider = options.provider;
  }
  clearGeocodingCache();
};

export const clearGeocodingCache = (): void => {
  geocodeCache.clear();
};

export const resetGeocodingConfig = (): void => {
  geocodingState = {
    enabled: true,
    provider: deterministicGeocoder,
  };
  clearGeocodingCache();
};

export const getGeocodingCacheSize = (): number => geocodeCache.size;

export const getDeterministicGeocodingProvider = (): GeocodingProvider => deterministicGeocoder;
