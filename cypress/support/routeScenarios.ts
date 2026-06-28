/// <reference types="cypress" />

export type AppRole = "client" | "therapist" | "admin" | "super_admin";
export type RouteScenario = {
  path: string;
  roles: readonly (AppRole | "public")[];
  expectedPath?: string;
  expectedPathByRole?: Partial<Record<AppRole | "public", string>>;
};

export const password = "password123";

export const roleEmail = (role: AppRole): string => (
  role === "super_admin" ? "superadmin@test.com" : `${role}@test.com`
);

export const roles: readonly AppRole[] = ["client", "therapist", "admin", "super_admin"];

export const routeGroups = {
  public: [
    { path: "/login", roles: ["public"] },
    { path: "/signup", roles: ["public"] },
    {
      path: "/auth/recovery?type=recovery&access_token=test-access-token&refresh_token=test-refresh-token",
      roles: ["public"],
      expectedPath: "/auth/recovery",
    },
    { path: "/unauthorized", roles: ["public"] },
  ],
  client: [
    { path: "/", roles: ["client", "therapist", "admin", "super_admin"] },
    { path: "/clients", roles: ["therapist", "admin", "super_admin"] },
    { path: "/clients/client-1", roles: ["therapist", "admin", "super_admin"] },
    { path: "/documentation", roles: ["client", "therapist", "admin", "super_admin"] },
    { path: "/authorizations", roles: ["admin", "super_admin"] },
    { path: "/family", roles: [] },
  ],
  schedule: [
    { path: "/schedule", roles: ["therapist", "admin", "super_admin"] },
  ],
  messages: [
    { path: "/messages", roles: ["therapist", "admin", "super_admin"] },
    { path: "/messages/new", roles: ["therapist", "admin", "super_admin"] },
    { path: "/messages/thread-1", roles: ["therapist", "admin", "super_admin"] },
  ],
  admin: [
    { path: "/therapists", roles: ["admin", "super_admin"] },
    { path: "/therapists/therapist-1", roles: ["therapist", "admin", "super_admin"] },
    { path: "/therapists/new", roles: ["admin", "super_admin"] },
    { path: "/billing", roles: ["admin", "super_admin"] },
    { path: "/monitoring", roles: ["admin", "super_admin"] },
    { path: "/monitoringdashboard", roles: ["admin", "super_admin"], expectedPath: "/monitoring" },
    { path: "/reports", roles: ["admin", "super_admin"] },
    { path: "/settings", roles: ["admin", "super_admin"] },
    {
      path: "/settings/feature-flags",
      roles: ["admin", "super_admin"],
      expectedPathByRole: { admin: "/settings", super_admin: "/settings/feature-flags" },
    },
    {
      path: "/settings/impersonation",
      roles: ["admin", "super_admin"],
      expectedPathByRole: { admin: "/settings", super_admin: "/settings/impersonation" },
    },
    { path: "/superadminfeatureflags", roles: ["admin", "super_admin"], expectedPath: "/settings" },
    { path: "/superadminimpersonation", roles: ["admin", "super_admin"], expectedPath: "/settings" },
    { path: "/super-admin/feature-flags", roles: ["super_admin"] },
    { path: "/super-admin/impersonation", roles: ["super_admin"] },
    { path: "/super-admin/prompts", roles: ["super_admin"] },
  ],
} satisfies Record<string, readonly RouteScenario[]>;

const stubClients = [
  {
    id: "client-1",
    full_name: "Test Client",
    email: "client@example.com",
    one_to_one_units: 5,
    supervision_units: 2,
    parent_consult_units: 1,
  },
];

const stubTherapists = [
  {
    id: "therapist-1",
    full_name: "Therapist Example",
    email: "therapist@example.com",
    specialties: ["cbt"],
  },
];

export const installRouteDataStubs = (): void => {
  cy.intercept("GET", "**/api/runtime-config").as("runtimeConfig");

  cy.intercept("GET", "**/__supabase/rest/v1/clients**", (req) => {
    const idQuery = req.query.id as string | undefined;
    const clientId = idQuery?.split("eq.")[1];
    if (clientId) {
      const match = stubClients.find((client) => client.id === clientId);
      req.reply({
        statusCode: 200,
        body: match ? [match] : [],
        headers: { "content-type": "application/json" },
      });
      return;
    }

    req.reply({
      statusCode: 200,
      body: stubClients,
      headers: { "content-type": "application/json" },
    });
  });

  cy.intercept("GET", "**/__supabase/rest/v1/therapists**", (req) => {
    const idQuery = req.query.id as string | undefined;
    const therapistId = idQuery?.split("eq.")[1];
    if (therapistId) {
      const match = stubTherapists.find((therapist) => therapist.id === therapistId);
      req.reply({
        statusCode: 200,
        body: match ? [match] : [],
        headers: { "content-type": "application/json" },
      });
      return;
    }

    req.reply({
      statusCode: 200,
      body: stubTherapists,
      headers: { "content-type": "application/json" },
    });
  });

  const emptyJson = { statusCode: 200, body: [], headers: { "content-type": "application/json" } };

  cy.intercept("GET", "**/__supabase/rest/v1/message_threads**", emptyJson);
  cy.intercept("GET", "**/__supabase/rest/v1/message_thread_participants**", emptyJson);
  cy.intercept("GET", "**/__supabase/rest/v1/messages**", emptyJson);
  cy.intercept("POST", "**/__supabase/rest/v1/rpc/create_staff_message_thread**", {
    statusCode: 200,
    body: "thread-1",
    headers: { "content-type": "application/json" },
  });
  cy.intercept("POST", "**/__supabase/rest/v1/rpc/list_eligible_staff_for_messaging**", {
    statusCode: 200,
    body: [
      {
        user_id: "staff-2",
        full_name: "Staff Two",
        email: "staff2@test.com",
        role: "admin",
      },
    ],
    headers: { "content-type": "application/json" },
  });
  cy.intercept("POST", "**/__supabase/rest/v1/rpc/list_staff_message_thread_participant_names**", {
    statusCode: 200,
    body: [
      { user_id: "staff-2", full_name: "Staff Two" },
    ],
    headers: { "content-type": "application/json" },
  });
};

export const assertVisibleRoute = (path: string, expectedPath = path): void => {
  cy.visit(path);
  cy.wait("@runtimeConfig");
  cy.get("body").should("be.visible");
  cy.get('[data-testid="error-boundary"]').should("not.exist");
  cy.url().should("not.include", "/login");
  cy.url().should("not.include", "/unauthorized");
  cy.location("pathname").should("eq", expectedPath);
};

export const assertBlockedRoute = (path: string): void => {
  cy.visit(path);
  cy.wait("@runtimeConfig");
  cy.url().should((current) => {
    expect(
      current.includes("/unauthorized")
      || current.includes("/login")
      || current === `${Cypress.config("baseUrl")}/`,
    ).to.be.true;
  });
};

export const runRoleMatrix = (title: string, scenarios: readonly RouteScenario[]): void => {
  describe(title, () => {
    roles.forEach((role) => {
      describe(`${role} deep-link coverage`, () => {
        beforeEach(() => {
          cy.login(roleEmail(role), password);
        });

        scenarios.forEach(({ path, roles: allowed, expectedPath, expectedPathByRole }) => {
          const shouldAllow = allowed.includes(role);
          it(`${shouldAllow ? "allows" : "blocks"} ${path}`, () => {
            if (shouldAllow) {
              assertVisibleRoute(path, expectedPathByRole?.[role] ?? expectedPath);
            } else {
              assertBlockedRoute(path);
            }
          });
        });
      });
    });
  });
};
