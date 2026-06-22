/// <reference types="cypress" />

import { installRouteDataStubs } from "../support/routeScenarios";

const jsonHeaders = { "content-type": "application/json" };
const nowIso = "2026-06-22T00:00:00.000Z";
const defaultOrganizationId = "5238e88b-6198-4862-80a2-dbe15bbeabdd";
const stubAdminUser = {
  id: "stub-admin",
  email: "admin@test.com",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {
    provider: "stub",
    providers: ["stub"],
    role: "admin",
  },
  user_metadata: {
    email: "admin@test.com",
    role: "admin",
    organization_id: defaultOrganizationId,
  },
  identities: [],
  created_at: nowIso,
  updated_at: nowIso,
  last_sign_in_at: nowIso,
  factors: [],
  confirmed_at: nowIso,
  email_confirmed_at: nowIso,
  phone: "",
  is_anonymous: false,
};

const installPreAuthWorkflowStubs = (): void => {
  installRouteDataStubs();

  cy.intercept("**/(rest|auth|storage)/v1/**", (req) => {
    throw new Error(`Unstubbed Supabase request in PreAuth workflow spec: ${req.method} ${req.url}`);
  });

  cy.intercept("GET", "**/rest/v1/profiles**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: {
      id: "stub-admin",
      email: "admin@test.com",
      role: "admin",
      full_name: "admin tester",
      first_name: "admin",
      last_name: "tester",
      organization_id: defaultOrganizationId,
      is_active: true,
      created_at: "2026-06-22T00:00:00.000Z",
      updated_at: "2026-06-22T00:00:00.000Z",
    },
  }).as("profileFetchForPreAuth");

  cy.intercept("GET", "**/auth/v1/user", {
    statusCode: 200,
    headers: jsonHeaders,
    body: {
      user: stubAdminUser,
    },
  }).as("supabaseUserForPreAuth");

  cy.intercept("GET", "**/rest/v1/clients**", (req) => {
    const idQuery = req.query.id as string | undefined;
    const clientId = idQuery?.split("eq.")[1];
    const client = {
      id: "client-1",
      full_name: "Test Client",
      email: "client@example.com",
      organization_id: defaultOrganizationId,
      primary_therapist_id: "therapist-provider-1",
      one_to_one_units: 5,
      supervision_units: 2,
      parent_consult_units: 1,
    };
    req.reply({
      statusCode: 200,
      headers: jsonHeaders,
      body: clientId ? (clientId === "client-1" ? client : null) : [client],
    });
  }).as("clientsForPreAuth");

  cy.intercept("GET", "**/rest/v1/sessions**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [],
  }).as("sessionsForPreAuth");

  cy.intercept("GET", "**/rest/v1/client_issues**", {
    statusCode: 200,
    headers: {
      ...jsonHeaders,
      "content-range": "0-0/0",
    },
    body: [],
  }).as("clientIssuesForPreAuth");
  cy.intercept("HEAD", "**/rest/v1/client_issues**", {
    statusCode: 200,
    headers: {
      "content-range": "0-0/0",
    },
  }).as("clientIssuesCountForPreAuth");

  cy.intercept("GET", "**/rest/v1/cpt_codes**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [
      {
        code: "97153",
        short_description: "Adaptive behavior treatment by protocol",
      },
    ],
  }).as("cptCodes");

  cy.intercept("GET", "**/rest/v1/insurance_providers**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [
      {
        id: "payer-1",
        name: "Synthetic Payer",
      },
    ],
  }).as("insuranceProviders");

  cy.intercept("GET", "**/rest/v1/client_therapist_links**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [
      {
        client_id: "client-1",
        therapist_id: "therapist-provider-1",
      },
    ],
  }).as("clientTherapistLinks");

  cy.intercept("GET", "**/rest/v1/therapists**", (req) => {
    req.reply({
      statusCode: 200,
      headers: jsonHeaders,
      body: [
        {
          id: "therapist-provider-1",
          full_name: "Rendering Therapist",
          organization_id: defaultOrganizationId,
        },
      ],
    });
  }).as("therapists");

  cy.intercept("GET", "**/rest/v1/client_session_notes**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [],
  }).as("sessionNotes");

  cy.intercept("GET", "**/rest/v1/authorizations**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: [],
  }).as("authorizations");

  cy.intercept("POST", "**/rest/v1/rpc/create_authorization_with_services", (req) => {
    expect(req.body).to.include({
      p_client_id: "client-1",
      p_provider_id: "therapist-provider-1",
      p_authorization_number: "IEHP-AUTH-CYPRESS",
      p_diagnosis_code: "F84.0",
      p_diagnosis_description: "Autistic disorder",
      p_status: "approved",
      p_insurance_provider_id: "payer-1",
      p_plan_type: "Medicaid",
      p_member_id: "SYNTH-MEMBER",
    });
    expect(req.body.p_services).to.deep.equal([
      {
        service_code: "97153",
        service_description: "Adaptive behavior treatment by protocol",
        from_date: "2026-06-23",
        to_date: "2026-12-22",
        requested_units: 120,
        approved_units: 120,
        unit_type: "Units",
        decision_status: "approved",
      },
    ]);

    req.reply({
      statusCode: 200,
      headers: jsonHeaders,
      body: {
        id: "auth-created-id",
        client_id: "client-1",
        provider_id: "therapist-provider-1",
        authorization_number: "IEHP-AUTH-CYPRESS",
      },
    });
  }).as("createAuthorization");

  cy.intercept("POST", "**/storage/v1/object/client-documents/clients/client-1/authorizations/auth-created-id/**", {
    statusCode: 200,
    headers: jsonHeaders,
    body: {
      Key: "client-documents/clients/client-1/authorizations/auth-created-id/codex-synthetic-preauth-smoke.pdf",
    },
  }).as("documentUpload");

  cy.intercept("POST", "**/rest/v1/rpc/update_authorization_documents", (req) => {
    expect(req.body.p_authorization_id).to.equal("auth-created-id");
    expect(req.body.p_documents).to.have.length(1);
    expect(req.body.p_documents[0]).to.include({
      name: "codex-synthetic-preauth-smoke.pdf",
      type: "application/pdf",
    });
    expect(req.body.p_documents[0].path).to.match(
      /^clients\/client-1\/authorizations\/auth-created-id\/.+\.pdf$/,
    );

    req.reply({
      statusCode: 200,
      headers: jsonHeaders,
      body: {
        id: "auth-created-id",
        documents: req.body.p_documents,
      },
    });
  }).as("updateAuthorizationDocuments");

};

describe("Pre Authorization workflow", () => {
  beforeEach(() => {
    installPreAuthWorkflowStubs();
  });

  it("creates an authorization and uploads the authorization notice from client details", () => {
    cy.visit("/", {
      onBeforeLoad(win) {
        win.localStorage.setItem(
          "auth-storage",
          JSON.stringify({
            user: {
              id: "stub-admin",
              email: "admin@test.com",
              role: "admin",
              organization_id: defaultOrganizationId,
              user_metadata: {
                role: "admin",
                organization_id: defaultOrganizationId,
              },
              app_metadata: {
                role: "admin",
              },
              full_name: "admin tester",
              first_name: "admin",
              last_name: "tester",
            },
            accessToken: "stub-access-token-admin",
            refreshToken: "stub-refresh-token-admin",
            expiresAt: Date.now() + 3600_000,
            provider: "stub",
          }),
        );
      },
    });
    cy.wait("@runtimeConfig");

    cy.visit("/clients/client-1");
    cy.wait("@runtimeConfig");

    cy.contains("button", "Pre-Authorizations").scrollIntoView().click({ force: true });
    cy.contains("button", "New Authorization").scrollIntoView().click({ force: true });

    cy.get("#preauth-authorization-number").type("IEHP-AUTH-CYPRESS");
    cy.get("#preauth-insurance").select("payer-1");
    cy.get("#preauth-provider-therapist").select("therapist-provider-1");
    cy.get("#preauth-plan-type").select("Medicaid");
    cy.get("#preauth-member-id").type("SYNTH-MEMBER");
    cy.get("#preauth-start-date").type("2026-06-23");
    cy.get("#preauth-end-date").type("2026-12-22");
    cy.get("#preauth-diagnosis-code").clear().type("F84.0");
    cy.get("#preauth-diagnosis-description").clear().type("Autistic disorder");

    cy.contains("button", "Next").scrollIntoView().click({ force: true });
    cy.get("#service-97153").check();

    cy.contains("button", "Next").scrollIntoView().click({ force: true });
    cy.get("#preauth-units-97153").clear().type("120");

    cy.contains("button", "Next").scrollIntoView().click({ force: true });
    cy.get('input[type="file"]').selectFile(
      {
        contents: Cypress.Buffer.from("synthetic authorization notice"),
        fileName: "codex-synthetic-preauth-smoke.pdf",
        mimeType: "application/pdf",
      },
      { force: true },
    );

    cy.contains("button", "Next").scrollIntoView().click({ force: true });
    cy.contains("button", "Submit Request").scrollIntoView().click({ force: true });

    cy.wait("@createAuthorization");
    cy.wait("@documentUpload");
    cy.wait("@updateAuthorizationDocuments");
    cy.contains("Authorization uploaded and saved.").should("be.visible");
  });
});
