// ***********************************************************
// This example support/e2e.ts is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import './commands'

// Alternatively you can use CommonJS syntax:
// require('./commands') 

beforeEach(() => {
  const runtimeConfig = {
    supabaseUrl: Cypress.env('SUPABASE_URL') ?? 'https://example.supabase.co',
    supabaseAnonKey: Cypress.env('SUPABASE_ANON_KEY') ?? 'cypress-anon-key',
    defaultOrganizationId:
      Cypress.env('DEFAULT_ORGANIZATION_ID') ?? '00000000-0000-0000-0000-000000000001',
  };

  cy.intercept('GET', '**/api/runtime-config', {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: runtimeConfig,
  }).as('runtimeConfig');
});