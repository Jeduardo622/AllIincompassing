import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

const ROUTE_QUERY_KEYS: Array<{ prefix: string; keys: readonly unknown[][] }> = [
  { prefix: '/schedule', keys: [['sessions'], ['sessions-batch'], ['dropdowns']] },
  { prefix: '/reports', keys: [['session-metrics'], ['dropdowns'], ['sessions']] },
  { prefix: '/dashboard', keys: [['dashboard'], ['sessions'], ['clients', 'dashboard-summary'], ['therapists']] },
  { prefix: '/clients', keys: [['clients'], ['dropdowns']] },
  { prefix: '/therapists', keys: [['therapists'], ['dropdowns']] },
  { prefix: '/authorizations', keys: [['authorizations']] },
  { prefix: '/billing', keys: [['billing']] },
  { prefix: '/monitoring', keys: [['monitoring']] },
  { prefix: '/settings', keys: [['settings']] },
];

const DEFAULT_ROUTE_QUERY_KEYS: readonly unknown[][] = [['dashboard']];

export const getRouteInvalidationKeys = (pathname: string): readonly unknown[][] => {
  for (const routeEntry of ROUTE_QUERY_KEYS) {
    if (pathname.startsWith(routeEntry.prefix)) {
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
