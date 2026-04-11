import { describe, expect, it, vi } from 'vitest';
import { createRouteModulePrefetcher } from '../routeModulePrefetch';

describe('createRouteModulePrefetcher', () => {
  it('prefetches each registered route module at most once after a successful load', async () => {
    const scheduleLoader = vi.fn().mockResolvedValue({});
    const preloadRouteModule = createRouteModulePrefetcher({
      '/schedule': scheduleLoader,
    });

    preloadRouteModule('/schedule');
    preloadRouteModule('/schedule');
    await Promise.resolve();

    expect(scheduleLoader).toHaveBeenCalledTimes(1);
  });

  it('allows retrying a route preload after a failed import', async () => {
    const scheduleLoader = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValueOnce({});
    const preloadRouteModule = createRouteModulePrefetcher({
      '/schedule': scheduleLoader,
    });

    preloadRouteModule('/schedule');
    await Promise.resolve();
    await Promise.resolve();

    preloadRouteModule('/schedule');
    await Promise.resolve();

    expect(scheduleLoader).toHaveBeenCalledTimes(2);
  });

  it('ignores paths that do not have a registered route preloader', () => {
    const scheduleLoader = vi.fn().mockResolvedValue({});
    const preloadRouteModule = createRouteModulePrefetcher({
      '/schedule': scheduleLoader,
    });

    preloadRouteModule('/reports');

    expect(scheduleLoader).not.toHaveBeenCalled();
  });
});
