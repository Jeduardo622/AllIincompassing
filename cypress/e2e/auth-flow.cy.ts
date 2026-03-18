describe('Authentication Flow', () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    cy.clearCookies();
  });

  it('renders login form and allows forgot-password toggle', () => {
    cy.visit('/login');

    cy.get('input[name="email"]').should('be.visible');
    cy.get('input[name="password"]').should('be.visible');
    cy.contains('button', 'Sign in').should('be.visible');
    cy.contains('a', 'create a new account').should('be.visible');

    cy.contains('button', 'Forgot your password?').click();
    cy.contains('h2', 'Reset your password').should('be.visible');
    cy.contains('button', 'Send reset email').should('be.visible');
    cy.contains('button', 'Back to sign in').click();
    cy.contains('h2', 'Sign in to AllIncompassing').should('be.visible');
  });

  it('navigates between login and signup pages', () => {
    cy.visit('/login');
    cy.contains('a', 'create a new account').click();
    cy.url().should('include', '/signup');
    cy.contains('h2', 'Create your account').should('be.visible');

    cy.contains('a', 'sign in to your existing account').click();
    cy.url().should('include', '/login');
  });

  it('validates signup password mismatch', () => {
    cy.visit('/signup');

    cy.get('input[name="firstName"]').type('Jane');
    cy.get('input[name="lastName"]').type('Doe');
    cy.get('input[name="email"]').type('jane@example.com');
    cy.get('input[name="password"]').type('password123');
    cy.get('input[name="confirm-password"]').type('different123');
    cy.contains('button', 'Create account').click();

    cy.contains('Passwords do not match').should('be.visible');
  });

  it('shows unauthorized page content', () => {
    cy.visit('/unauthorized');
    cy.contains('h1', 'Access Denied').should('be.visible');
    cy.contains('button', 'Go Back').should('be.visible');
    cy.contains('button', 'Return to Dashboard').should('be.visible');
  });
});