/// <reference types="cypress" />

// Deliberately isolated from support/e2e.ts and support/commands.ts. The
// progression proof must use the real runtime-config endpoint and real Auth;
// importing the default support path would install global stubs and cy.login.
before(() => {
  cy.task("progression:preflight").then((result) => {
    const preflight = result as { projectId: string; baseHost: string; supabaseHost: string };
    expect(preflight.projectId).to.equal("AllIincompassing");
    expect(["127.0.0.1", "localhost", "::1"]).to.include(preflight.baseHost);
    expect(["127.0.0.1", "localhost", "::1"]).to.include(preflight.supabaseHost);
  });
});
