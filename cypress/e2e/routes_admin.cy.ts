/// <reference types="cypress" />

import { installRouteDataStubs, routeGroups, runRoleMatrix } from "../support/routeScenarios";

describe("Admin and back-office route coverage", () => {
  beforeEach(() => {
    installRouteDataStubs();
  });

  runRoleMatrix("admin/back-office routes", routeGroups.admin);

  it("keeps the impersonation settings deep link within desktop and mobile viewports", () => {
    cy.login("superadmin@test.local", "synthetic-password");

    [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ].forEach(({ width, height }) => {
      cy.viewport(width, height);
      cy.visit("/settings/impersonation");
      cy.wait("@runtimeConfig");
      cy.contains("h1", "Settings").should("be.visible");
      cy.contains("button", "Impersonation").should("be.visible").and("have.attr", "aria-current", "page");
      cy.document().then((document) => {
        expect(document.documentElement.scrollWidth).to.equal(document.documentElement.clientWidth);
      });
    });
  });

  it("renders the protected not-found shell without exposing a stale route title", () => {
    cy.login("superadmin@test.local", "synthetic-password");
    cy.visit("/route-audit-not-found");
    cy.wait("@runtimeConfig");

    cy.contains("h1", "Page not found").should("be.visible");
    cy.title().should("equal", "Not Found | AllIncompassing");
    cy.location("pathname").should("equal", "/route-audit-not-found");
  });
});
