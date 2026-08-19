/// <reference types="cypress" />

import { installRouteDataStubs, routeGroups } from "../support/routeScenarios";

describe("Public route coverage", () => {
  beforeEach(() => {
    installRouteDataStubs();
  });

  routeGroups.public.forEach((route) => {
    it(`loads ${route.path} without authentication`, () => {
      cy.visit(route.path);
      cy.wait("@runtimeConfig");
      cy.get("body").should("be.visible").invoke("text").should("match", /\S+/);
      cy.get('[data-testid="error-boundary"]').should("not.exist");
      cy.location("pathname").should("eq", route.expectedPath ?? route.path);
    });
  });

  it("shows a non-interactive terminal state for a tokenless invite", () => {
    cy.visit("/accept-invite");
    cy.wait("@runtimeConfig");
    cy.contains("h1", "Invite link unavailable").should("be.visible");
    cy.contains("button", "Go to login").should("be.visible");
    cy.contains("button", "Accept invite").should("not.exist");
    cy.document().its("title").should("eq", "Accept Invite | AllIncompassing");
  });

  it("shows an authentication-specific unauthorized state", () => {
    cy.visit("/unauthorized");
    cy.wait("@runtimeConfig");
    cy.contains("h1", "Sign in required").should("be.visible");
    cy.contains("button", "Go to Login").should("be.visible");
  });

  it("redirects unknown public routes to login without a blank screen", () => {
    cy.visit("/route-audit-not-found");
    cy.wait("@runtimeConfig");
    cy.get("body").should("be.visible").invoke("text").should("match", /\S+/);
    cy.get('[data-testid="error-boundary"]').should("not.exist");
    cy.location("pathname").should("eq", "/login");
    cy.document().its("title").should("eq", "Login | AllIncompassing");
  });
});
