import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions } from "../_shared/auth-middleware.ts";
import { createRequestClient } from "../_shared/database.ts";
import { assertAdmin } from "../_shared/auth.ts";

interface AdminUsersError extends Error {
  status?: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const respond = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export default createProtectedRoute(async (req: Request, userContext) => {
  if (req.method !== 'GET') {
    return respond(405, { error: "Method not allowed" });
  }

  try {
    const adminClient = createRequestClient(req);
    await assertAdmin(adminClient);

    const url = new URL(req.url);
    const organizationId = url.searchParams.get("organization_id")?.trim();

    if (!organizationId) {
      logApiAccess("GET", "/admin/users", userContext, 400);
      return respond(400, { error: "organization_id is required" });
    }

    if (!UUID_PATTERN.test(organizationId)) {
      logApiAccess("GET", "/admin/users", userContext, 400);
      return respond(400, { error: "organization_id must be a valid UUID" });
    }

    const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 100);
    const search = url.searchParams.get("search")?.trim().toLowerCase();

    const { data: rpcUsers, error } = await adminClient.rpc("get_admin_users", { organization_id: organizationId });

    if (error) {
      const rpcError = error as AdminUsersError & { code?: string };
      const status = rpcError.code === "42501" ? 403 : 500;

      if (status === 403) {
        logApiAccess("GET", "/admin/users", userContext, 403);
        return respond(403, { error: "Access denied" });
      }

      console.error("get_admin_users RPC error", error);
      logApiAccess("GET", "/admin/users", userContext, 500);
      return respond(500, { error: "Failed to fetch users" });
    }

    const users = Array.isArray(rpcUsers) ? rpcUsers : [];

    const filteredUsers = search
      ? users.filter((user) => {
          const metadata = (user?.raw_user_meta_data ?? {}) as Record<string, unknown>;
          const first = typeof metadata.first_name === "string" ? metadata.first_name.toLowerCase() : "";
          const last = typeof metadata.last_name === "string" ? metadata.last_name.toLowerCase() : "";
          const title = typeof metadata.title === "string" ? metadata.title.toLowerCase() : "";
          const email = typeof user?.email === "string" ? user.email.toLowerCase() : "";

          return [first, last, title, email]
            .filter(Boolean)
            .some((value) => value.includes(search));
        })
      : users;

    const totalCount = filteredUsers.length;
    const totalPages = Math.max(Math.ceil(totalCount / limit), 1);
    const startIndex = (page - 1) * limit;
    const pagedUsers = filteredUsers.slice(startIndex, startIndex + limit);

    logApiAccess("GET", "/admin/users", userContext, 200);

    return respond(200, {
      users: pagedUsers,
      pagination: {
        currentPage: page,
        limit,
        totalPages,
        totalCount,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      filters: {
        role: null,
        active: null,
        search: search || null,
      },
    });
  } catch (error) {
    console.error("Admin users error:", error);
    logApiAccess("GET", "/admin/users", userContext, 500);
    return respond(500, { error: "Internal server error" });
  }
}, RouteOptions.admin);
