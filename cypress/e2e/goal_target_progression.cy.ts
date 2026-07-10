/// <reference types="cypress" />

/**
 * Live, synthetic-only progression proof.
 *
 * This spec intentionally has no network stubs: it is the browser half of the
 * local Supabase contract and must run only against a disposable seeded tenant.
 */
describe("goal target automatic progression", () => {
  const clientId = Cypress.env("PROGRESSION_CLIENT_ID") as string | undefined;
  const bcbaEmail = Cypress.env("PROGRESSION_BCBA_EMAIL") as string | undefined;
  const bcbaPassword = Cypress.env("PROGRESSION_BCBA_PASSWORD") as string | undefined;

  before(() => {
    expect(clientId, "PROGRESSION_CLIENT_ID").to.be.a("string").and.not.be.empty;
    expect(bcbaEmail, "PROGRESSION_BCBA_EMAIL").to.be.a("string").and.not.be.empty;
    expect(bcbaPassword, "PROGRESSION_BCBA_PASSWORD").to.be.a("string").and.not.be.empty;
  });

  it("advances ordered targets and permits an audited move back", () => {
    cy.login(bcbaEmail!, bcbaPassword!);
    cy.visit(`/clients/${clientId}?tab=programs-goals`);
    cy.wait("@runtimeConfig");

    cy.contains("Target 1 of 2").should("be.visible");
    cy.contains("Current phase: Baseline").should("be.visible");

    // The synthetic fixture has already completed the configured qualifying
    // sessions through the real finalization API. A reload proves persisted,
    // automatic target sequencing rather than optimistic client state.
    cy.reload();
    cy.contains("Target 2 of 2").should("be.visible");
    cy.contains("Current phase: Baseline").should("be.visible");

    cy.contains("button", "Move back").click();
    cy.get('[role="dialog"]').within(() => {
      cy.get("textarea").type("Synthetic regression proof: return one phase");
      cy.contains("button", "Confirm manual change").click();
    });
    cy.contains("Target progression updated.").should("be.visible");
    cy.reload();
    cy.contains("Synthetic regression proof: return one phase").should("be.visible");
  });

  it("keeps completed-session data scoped when a stale target is discarded and retried", () => {
    cy.login(bcbaEmail!, bcbaPassword!);
    cy.intercept("POST", "**/api/session-notes/upsert").as("sessionCompletion");
    cy.visit("/schedule");
    cy.contains("button", "Open session").click();
    cy.contains("The completed session is preserved. Current target:").should("be.visible");
    cy.contains("button", "Discard stale trials and retry").click();
    cy.get('[role="alert"]').should("not.exist");
    cy.get("@sessionCompletion.all").should("have.length", 1);
  });
});
