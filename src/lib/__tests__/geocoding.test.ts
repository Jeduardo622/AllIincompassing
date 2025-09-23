import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureGeocoding,
  geocodeAddress,
  resetGeocodingConfig,
} from '../geocoding';

describe('geocoding utilities', () => {
  afterEach(() => {
    resetGeocodingConfig();
  });

  it('returns deterministic coordinates for the same address', () => {
    const address = '123 Main Street, New York, NY';
    const first = geocodeAddress(address);
    const second = geocodeAddress(address);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
  });

  it('caches results per normalized address and avoids repeated provider calls', () => {
    const provider = vi.fn(() => ({ latitude: 10, longitude: 20 }));
    configureGeocoding({ provider });

    const address = '500 Elm Street, Boston, MA';
    const first = geocodeAddress(address);
    const second = geocodeAddress(address.toUpperCase());

    expect(provider).toHaveBeenCalledTimes(1);
    expect(first?.latitude).toBeCloseTo(second?.latitude ?? 0, 6);
    expect(first?.longitude).toBeCloseTo(second?.longitude ?? 0, 6);
  });

  it('supports disabling geocoding via configuration', () => {
    configureGeocoding({ enabled: false });
    expect(geocodeAddress('987 Maple Avenue, Albany, NY')).toBeNull();
  });
});
