/// <reference types="cypress" />

import { installRouteDataStubs, password, roleEmail } from "../support/routeScenarios";

describe("Authentication route smoke", () => {
  beforeEach(() => {
    installRouteDataStubs();
  });

  it("redirects unauthenticated users from protected pages to login", () => {
    cy.visit("/clients");
    cy.wait("@runtimeConfig");
    cy.url().should("include", "/login");
  });

  it("keeps password recovery callback tokens out of app URL", () => {
    cy.visit("/auth/recovery#type=recovery&access_token=test-access&refresh_token=test-refresh");
    cy.location("hash").should("not.include", "access_token");
    cy.location("hash").should("not.include", "refresh_token");
  });

  it("blocks non-guardian clients from the family dashboard", () => {
    cy.login(roleEmail("client"), password);
    cy.visit("/family");
    cy.wait("@runtimeConfig");
    cy.url().should("include", "/unauthorized");
  });

  (["therapist", "admin", "super_admin"] as const).forEach((role) => {
    it(`allows ${role} to access dashboard routes`, () => {
      cy.login(roleEmail(role), password);
      cy.visit("/");
      cy.wait("@runtimeConfig");
      cy.url().should("not.include", "/login");
      cy.url().should("not.include", "/unauthorized");
    });
  });
});
