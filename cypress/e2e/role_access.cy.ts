/// <reference types="cypress" />

// Deep-link authorization checks per role using stub auth (cy.login)

type AppRole = 'client' | 'therapist' | 'admin' | 'super_admin';

const ROUTES = [
  { path: '/login', roles: ['public'] },
  { path: '/signup', roles: ['public'] },
  { path: '/unauthorized', roles: ['public'] },
  { path: '/', roles: ['client', 'therapist', 'admin', 'super_admin'] },
  { path: '/schedule', roles: ['client', 'therapist', 'admin', 'super_admin'] },
  { path: '/family', roles: ['client'] },
  { path: '/clients', roles: ['therapist', 'admin', 'super_admin'] },
  { path: '/therapists', roles: ['admin', 'super_admin'] },
  { path: '/authorizations', roles: ['therapist', 'admin', 'super_admin'] },
  { path: '/billing', roles: ['admin', 'super_admin'] },
  { path: '/monitoring', roles: ['admin', 'super_admin'] },
  { path: '/reports', roles: ['admin', 'super_admin'] },
  { path: '/settings', roles: ['admin', 'super_admin'] },
] as const;

const roleEmail = (role: AppRole): string => (
  role === 'super_admin' ? 'superadmin@test.com' : `${role}@test.com`
);

const PASSWORD = 'password123';

describe('Role-based deep-link access', () => {
  const roles: AppRole[] = ['client', 'therapist', 'admin', 'super_admin'];

  it('unauth deep-link to protected route redirects to /login', () => {
    cy.visit('/clients');
    cy.url().should('include', '/login');
  });

  roles.forEach((role) => {
    describe(`${role} deep-link coverage`, () => {
      beforeEach(() => {
        cy.login(roleEmail(role), PASSWORD);
      });

      ROUTES.filter(r => !r.roles.includes('public')).forEach(({ path, roles: allowed }) => {
        const shouldAllow = allowed.includes(role);
        it(`${shouldAllow ? 'allows' : 'blocks'} ${path}`, () => {
          cy.visit(path);
          if (shouldAllow) {
            cy.url().should('not.include', '/unauthorized');
            cy.url().should('not.include', '/login');
            cy.get('body').should('be.visible');
          } else {
            cy.url().should((current) => {
              expect(current.includes('/unauthorized') || current.includes('/login') || current === Cypress.config('baseUrl') + '/').to.be.true;
            });
          }
        });
      });
    });
  });
});
