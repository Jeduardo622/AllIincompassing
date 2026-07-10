/// <reference types="cypress" />

type TestRole = "midtier" | "bcba";
type DeleteMode = "success" | "conflict";

const jsonHeaders = { "content-type": "application/json" };
const organizationId = "00000000-0000-0000-0000-000000000001";
const nowIso = "2026-07-10T00:00:00.000Z";

const syntheticClient = {
  id: "client-1",
  organization_id: organizationId,
  full_name: "Synthetic Lifecycle Client",
  email: "synthetic-client@example.test",
  date_of_birth: "2018-01-01",
  insurance_info: {},
  service_preference: [],
  one_to_one_units: 0,
  supervision_units: 0,
  parent_consult_units: 0,
  assessment_units: 0,
  auth_units: 0,
  availability_hours: {},
  created_at: nowIso,
};

const syntheticProgram = {
  id: "program-1",
  organization_id: organizationId,
  client_id: syntheticClient.id,
  name: "Synthetic Communication Program",
  description: "Synthetic browser-only program",
  status: "active",
  created_at: nowIso,
  updated_at: nowIso,
};

const syntheticGoal = {
  id: "goal-1",
  organization_id: organizationId,
  client_id: syntheticClient.id,
  program_id: syntheticProgram.id,
  domain_id: null,
  title: "Synthetic Functional Communication Goal",
  description: "Synthetic browser-only goal",
  original_text: "Synthetic source wording",
  measurement_type: "frequency",
  status: "active",
  source: "manual",
  created_at: nowIso,
  updated_at: nowIso,
};

const buildTargets = () => [
  {
    id: "target-active",
    organization_id: organizationId,
    client_id: syntheticClient.id,
    goal_id: syntheticGoal.id,
    name: "Synthetic Active Target",
    measurement_type: "frequency",
    graph_config: { defaultChart: "bar", source: "trial_events", aggregation: "sum" },
    status: "active",
    sort_order: 0,
    created_at: nowIso,
    updated_at: nowIso,
  },
  {
    id: "target-archived",
    organization_id: organizationId,
    client_id: syntheticClient.id,
    goal_id: syntheticGoal.id,
    name: "Synthetic Archived Target",
    measurement_type: "frequency",
    graph_config: { defaultChart: "bar", source: "trial_events", aggregation: "sum" },
    status: "archived",
    sort_order: 1,
    created_at: nowIso,
    updated_at: nowIso,
  },
];

const seedAuth = (role: TestRole): void => {
  cy.visit("/clients/client-1?tab=programs-goals", {
    onBeforeLoad(win) {
      win.localStorage.setItem("auth-storage", JSON.stringify({
        user: {
          id: `stub-${role}`,
          email: `${role}@example.test`,
          role,
          full_name: `${role} synthetic tester`,
        },
        role,
        accessToken: `stub-access-token-${role}`,
        refreshToken: `stub-refresh-token-${role}`,
        expiresAt: Date.now() + 3_600_000,
        profile: {
          id: `stub-${role}`,
          email: `${role}@example.test`,
          role,
          organization_id: organizationId,
          is_active: true,
          created_at: nowIso,
          updated_at: nowIso,
        },
      }));
    },
  });
  cy.wait("@runtimeConfig");
};

const installLifecycleStubs = (deleteMode: DeleteMode = "success"): void => {
  let targets = buildTargets();

  cy.intercept("**/(rest|auth|storage)/v1/**", (req) => {
    throw new Error(`Unstubbed Supabase request in goal-target lifecycle spec: ${req.method} ${req.url}`);
  });
  cy.intercept("**/functions/v1/**", (req) => {
    throw new Error(`Unstubbed Edge request in goal-target lifecycle spec: ${req.method} ${req.url}`);
  });

  cy.intercept("GET", "**/auth/v1/user", {
    statusCode: 200,
    headers: jsonHeaders,
    body: { user: null },
  });
  cy.intercept("GET", "**/rest/v1/profiles**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [],
  });
  cy.intercept("GET", "**/rest/v1/user_roles**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [],
  });
  cy.intercept("GET", "**/rest/v1/user_therapist_links**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [{ therapist_id: "synthetic-staff-1" }],
  });
  cy.intercept("GET", "**/rest/v1/client_therapist_links**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [{ client_id: syntheticClient.id, therapist_id: "synthetic-staff-1" }],
  });
  cy.intercept("GET", "**/rest/v1/clients**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: syntheticClient,
  }).as("clientDetail");
  cy.intercept("GET", "**/rest/v1/sessions**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [],
  });
  cy.intercept("GET", "**/rest/v1/client_issues**", {
    statusCode: 200,
    headers: { ...jsonHeaders, "content-range": "0-0/0" },
    body: [],
  });
  cy.intercept("HEAD", "**/rest/v1/client_issues**", {
    statusCode: 200,
    headers: { "content-range": "0-0/0" },
  });
  cy.intercept("GET", "**/rest/v1/authorizations**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [],
  });
  cy.intercept("GET", "**/rest/v1/goal_domains**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [],
  });

  cy.intercept("GET", "**/functions/v1/programs**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [syntheticProgram],
  }).as("programs");
  cy.intercept("GET", "**/functions/v1/goals**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [syntheticGoal],
  }).as("goals");
  cy.intercept("GET", "**/functions/v1/goal-targets**", (req) => {
    req.reply({ statusCode: 200, headers: jsonHeaders, body: targets });
  }).as("goalTargets");
  cy.intercept("PATCH", "**/functions/v1/goal-targets**", (req) => {
    const targetId = new URL(req.url).searchParams.get("target_id");
    const requestedStatus = req.body?.status as "active" | "archived";
    const existing = targets.find((target) => target.id === targetId);
    if (!existing) {
      req.reply({ statusCode: 404, headers: jsonHeaders, body: { error: "Goal target not found" } });
      return;
    }
    targets = targets.map((target) => target.id === targetId ? { ...target, status: requestedStatus } : target);
    req.reply({ statusCode: 200, headers: jsonHeaders, body: { ...existing, status: requestedStatus } });
  }).as("patchGoalTarget");
  cy.intercept("DELETE", "**/functions/v1/goal-targets**", (req) => {
    const targetId = new URL(req.url).searchParams.get("target_id");
    if (deleteMode === "conflict") {
      req.reply({
        statusCode: 409,
        headers: jsonHeaders,
        body: { error: "Goal target has trial history and cannot be deleted" },
      });
      return;
    }
    targets = targets.filter((target) => target.id !== targetId);
    req.reply({ statusCode: 200, headers: jsonHeaders, body: { id: targetId } });
  }).as("deleteGoalTarget");
  cy.intercept("GET", "**/functions/v1/trial-events**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [],
  });
  cy.intercept("GET", "**/functions/v1/program-notes**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [],
  });
  cy.intercept("GET", "**/api/assessment-documents**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [],
  });
};

describe("goal target lifecycle", () => {
  it("allows midtier Archive and Restore actions but never exposes Delete", () => {
    installLifecycleStubs();
    seedAuth("midtier");

    cy.get('[aria-label="Archive target Synthetic Active Target"]').should("be.visible");
    cy.get('[aria-label^="Delete target"]').should("not.exist");
    cy.get('[aria-label="Archive target Synthetic Active Target"]').click();
    cy.wait("@patchGoalTarget").its("request.body").should("deep.equal", { status: "archived" });
    cy.contains("Synthetic Active Target").should("not.exist");

    cy.contains("button", "Show archived targets").click();
    cy.contains("Synthetic Active Target").should("be.visible");
    cy.get('[aria-label="Restore target Synthetic Archived Target"]').should("be.visible");
    cy.get('[aria-label^="Delete target"]').should("not.exist");

    cy.get('[aria-label="Restore target Synthetic Archived Target"]').click();
    cy.wait("@patchGoalTarget").its("request.body").should("deep.equal", { status: "active" });
    cy.get('[aria-label^="Delete target"]').should("not.exist");
  });

  it("limits BCBA Delete to archived targets, honors cancellation, and removes on success", () => {
    installLifecycleStubs();
    seedAuth("bcba");
    let shouldConfirmDelete = false;

    cy.get('[aria-label="Delete target Synthetic Active Target"]').should("not.exist");
    cy.contains("button", "Show archived targets").click();
    cy.get('[aria-label="Delete target Synthetic Archived Target"]').should("be.visible");

    cy.window().then((win) => {
      cy.stub(win, "confirm").callsFake(() => shouldConfirmDelete);
    });
    cy.get('[aria-label="Delete target Synthetic Archived Target"]').click();
    cy.get("@deleteGoalTarget.all").should("have.length", 0);
    cy.contains("Synthetic Archived Target").should("be.visible");

    cy.then(() => {
      shouldConfirmDelete = true;
    });
    cy.get('[aria-label="Delete target Synthetic Archived Target"]').click();
    cy.wait("@deleteGoalTarget").its("response.statusCode").should("eq", 200);
    cy.contains("Synthetic Archived Target").should("not.exist");
  });

  it("retains the archived target and Delete action after a 409 conflict", () => {
    installLifecycleStubs("conflict");
    seedAuth("bcba");

    cy.contains("button", "Show archived targets").click();
    cy.window().then((win) => {
      cy.stub(win, "confirm").returns(true);
    });
    cy.get('[aria-label="Delete target Synthetic Archived Target"]').click();
    cy.wait("@deleteGoalTarget").its("response.statusCode").should("eq", 409);

    cy.contains("Goal target has trial history and cannot be deleted").should("be.visible");
    cy.contains("Synthetic Archived Target").should("be.visible");
    cy.get('[aria-label="Delete target Synthetic Archived Target"]').should("be.visible");
  });
});
