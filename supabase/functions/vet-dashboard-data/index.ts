import { createProtectedRoute, RouteOptions } from "../_shared/auth-middleware.ts";
import { handleGetDashboardData } from "../get-dashboard-data/index.ts";

/**
 * Compatibility alias for legacy clients still invoking `vet-dashboard-data`.
 * Delegates to the canonical dashboard handler to keep behavior identical.
 */
export default createProtectedRoute(
  (req: Request) => handleGetDashboardData({ req }),
  RouteOptions.admin,
);
