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
      cy.get("body").should("be.visible");
      cy.get('[data-testid="error-boundary"]').should("not.exist");
      cy.location("pathname").should("eq", route.expectedPath ?? route.path);
    });
  });
});
