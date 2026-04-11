type RouteModulePreloader = () => Promise<unknown>;

const routeModulePreloaders: Record<string, RouteModulePreloader> = {
  '/': () => import('../pages/Dashboard'),
  '/schedule': () => import('../pages/Schedule'),
  '/clients': () => import('../pages/Clients'),
  '/therapists': () => import('../pages/Therapists'),
  '/authorizations': () => import('../pages/Authorizations'),
  '/documentation': () => import('../pages/Documentation'),
  '/fill-docs': () => import('../pages/FillDocs'),
  '/billing': () => import('../pages/Billing'),
  '/reports': () => import('../pages/Reports'),
  '/monitoring': () => import('../pages/MonitoringDashboard'),
  '/settings': () => import('../pages/Settings'),
  '/family': () => import('../pages/FamilyDashboard'),
};

export const createRouteModulePrefetcher = (
  preloaders: Record<string, RouteModulePreloader>,
): ((pathname: string) => void) => {
  const preloadCache = new Set<string>();

  return (pathname: string): void => {
    const preloader = preloaders[pathname];
    if (!preloader || preloadCache.has(pathname)) {
      return;
    }

    preloadCache.add(pathname);
    void preloader().catch(() => {
      preloadCache.delete(pathname);
    });
  };
};

export const preloadRouteModule = createRouteModulePrefetcher(routeModulePreloaders);
