const { defineConfig } = require("cypress");
const { validateProgressionHarnessEnvironment } = require("./cypress/progression/safety.cjs");

// Validation runs while Cypress loads its Node-side configuration, before a
// browser launches or any fixture task can mutate the database.
const safe = validateProgressionHarnessEnvironment(process.env);

module.exports = defineConfig({
  e2e: {
    baseUrl: safe.baseUrl,
    specPattern: "cypress/e2e/goal_target_progression.cy.ts",
    supportFile: "cypress/support/progression-e2e.ts",
    setupNodeEvents(on, config) {
      on("task", {
        "progression:preflight"() {
          return {
            projectId: safe.projectId,
            baseHost: new URL(safe.baseUrl).hostname,
            supabaseHost: new URL(safe.supabaseUrl).hostname,
          };
        },
      });
      return config;
    },
  },
});
