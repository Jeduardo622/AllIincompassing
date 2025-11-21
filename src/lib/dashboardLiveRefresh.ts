import { useMemo } from 'react';
import { useAuth } from './authContext';
import { CACHE_STRATEGIES } from './cacheStrategy';

export const DASHBOARD_LIVE_REFRESH_INTERVAL_MS = 30 * 1000;

export const useDashboardLiveRefresh = () => {
  const { isAdmin, isSuperAdmin } = useAuth();
  const isLiveRole = isSuperAdmin() || isAdmin();

  return useMemo(
    () => ({
      isLiveRole,
      intervalMs: isLiveRole ? DASHBOARD_LIVE_REFRESH_INTERVAL_MS : CACHE_STRATEGIES.DASHBOARD.summary,
    }),
    [isLiveRole],
  );
};

