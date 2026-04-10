import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

type RouteQueryEntry = {
  matches: (pathname: string) => boolean;
  keys: readonly unknown[][];
};

const matchesRoutePath = (pathname: string, routePath: string): boolean =>
  pathname === routePath || pathname.startsWith(`${routePath}/`);

const ROUTE_QUERY_KEYS: readonly RouteQueryEntry[] = [
  { matches: (pathname) => pathname === '/', keys: [['dashboard'], ['session-metrics'], ['dropdowns']] },
  { matches: (pathname) => matchesRoutePath(pathname, '/schedule'), keys: [['sessions'], ['sessions-batch'], ['dropdowns']] },
  { matches: (pathname) => matchesRoutePath(pathname, '/reports'), keys: [['session-metrics'], ['dropdowns']] },
  { matches: (pathname) => matchesRoutePath(pathname, '/clients'), keys: [['clients'], ['dropdowns']] },
  { matches: (pathname) => matchesRoutePath(pathname, '/therapists'), keys: [['therapists'], ['dropdowns']] },
  { matches: (pathname) => matchesRoutePath(pathname, '/authorizations'), keys: [['authorizations']] },
  { matches: (pathname) => matchesRoutePath(pathname, '/billing'), keys: [['billing']] },
  { matches: (pathname) => matchesRoutePath(pathname, '/monitoring'), keys: [['monitoring']] },
  { matches: (pathname) => matchesRoutePath(pathname, '/settings'), keys: [['settings']] },
];

const DEFAULT_ROUTE_QUERY_KEYS: readonly unknown[][] = [];

export const getRouteInvalidationKeys = (pathname: string): readonly unknown[][] => {
  for (const routeEntry of ROUTE_QUERY_KEYS) {
    if (routeEntry.matches(pathname)) {
      return routeEntry.keys;
    }
  }
  return DEFAULT_ROUTE_QUERY_KEYS;
};

export const useRouteQueryRefetch = () => {
  const location = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    const keys = getRouteInvalidationKeys(location.pathname);
    for (const queryKey of keys) {
      queryClient.invalidateQueries({ queryKey, refetchType: 'active' });
    }
  }, [location.pathname, queryClient]);
};
