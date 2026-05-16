/// <reference types="cypress" />

import { installRouteDataStubs, routeGroups, runRoleMatrix } from "../support/routeScenarios";

describe("Client and documentation route coverage", () => {
  beforeEach(() => {
    installRouteDataStubs();
  });

  runRoleMatrix("client/documentation routes", routeGroups.client);

  it("handles invalid client route parameters without an error boundary", () => {
    cy.login("admin@test.com", "password123");
    cy.visit("/clients/invalid-id");
    cy.wait("@runtimeConfig");
    cy.get("body").should("be.visible");
    cy.get('[data-testid="error-boundary"]').should("not.exist");
  });
});
