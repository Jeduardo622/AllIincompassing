describe('Authentication Flow & Role-Based Access Control', () => {
  beforeEach(() => {
    // Clear any existing auth state
    cy.clearLocalStorage();
    cy.clearCookies();
    // Mock Supabase responses to avoid actual API calls
    cy.intercept('POST', '**/auth/v1/token*', { fixture: 'auth-success.json' }).as('authRequest');
    cy.intercept('GET', '**/auth/v1/user*', { fixture: 'auth-success.json' }).as('userRequest');
    cy.intercept('GET', '**/rest/v1/profiles*', { fixture: 'auth-success.json' }).as('profileRequest');
  });

  describe('Login Page', () => {
    beforeEach(() => {
      cy.visit('/login');
    });

    it('should display login form elements', () => {
      cy.get('input[type="email"]').should('be.visible');
      cy.get('input[type="password"]').should('be.visible');
      cy.get('button[type="submit"]').should('contain', 'Sign in');
      cy.get('a[href="/signup"]').should('contain', 'create a new account');
    });

    it('should show validation errors for empty form', () => {
      cy.get('button[type="submit"]').click();
      cy.get('input[type="email"]:invalid').should('exist');
      cy.get('input[type="password"]:invalid').should('exist');
    });

    it('should show password toggle functionality', () => {
      cy.get('input[type="password"]').type('password123');
      cy.get('button[type="button"]').click();
      cy.get('input[type="text"]').should('have.value', 'password123');
      cy.get('button[type="button"]').click();
      cy.get('input[type="password"]').should('have.value', 'password123');
    });

    it('should display forgot password form', () => {
      cy.contains('Forgot your password?').click();
      cy.get('h2').should('contain', 'Reset your password');
      cy.get('button[type="submit"]').should('contain', 'Send reset email');
      cy.contains('Back to sign in').click();
      cy.get('h2').should('contain', 'Sign in to AllIncompassing');
    });

    it('should show test account credentials', () => {
      cy.contains('Test Accounts:').should('be.visible');
      cy.contains('Client: client@test.com').should('be.visible');
      cy.contains('Therapist: therapist@test.com').should('be.visible');
      cy.contains('Admin: admin@test.com').should('be.visible');
      cy.contains('Super Admin: superadmin@test.com').should('be.visible');
    });

    it('should navigate to signup page', () => {
      cy.contains('create a new account').click();
      cy.url().should('include', '/signup');
    });
  });

  describe('Signup Page', () => {
    beforeEach(() => {
      cy.visit('/signup');
    });

    it('should display signup form elements', () => {
      cy.get('input[name="firstName"]').should('be.visible');
      cy.get('input[name="lastName"]').should('be.visible');
      cy.get('input[type="email"]').should('be.visible');
      cy.get('input[name="password"]').should('be.visible');
      cy.get('input[name="confirm-password"]').should('be.visible');
      cy.get('button[type="submit"]').should('contain', 'Create account');
    });

    it('should show password mismatch error', () => {
      cy.get('input[name="firstName"]').type('John');
      cy.get('input[name="lastName"]').type('Doe');
      cy.get('input[type="email"]').type('john@example.com');
      cy.get('input[name="password"]').type('password123');
      cy.get('input[name="confirm-password"]').type('different123');
      cy.get('button[type="submit"]').click();
      cy.contains('Passwords do not match').should('be.visible');
    });

    it('should show password length error', () => {
      cy.get('input[name="firstName"]').type('John');
      cy.get('input[name="lastName"]').type('Doe');
      cy.get('input[type="email"]').type('john@example.com');
      cy.get('input[name="password"]').type('short');
      cy.get('input[name="confirm-password"]').type('short');
      cy.get('button[type="submit"]').click();
      cy.contains('Password must be at least 8 characters long').should('be.visible');
    });

    it('should navigate to login page', () => {
      cy.contains('sign in to your account').click();
      cy.url().should('include', '/login');
    });
  });

  describe('Role-Based Access Control', () => {
    const testRoles = [
      {
        role: 'client',
        email: 'client@test.com',
        accessibleRoutes: ['/'],
        restrictedRoutes: ['/clients', '/therapists', '/admin', '/billing', '/settings'],
      },
      {
        role: 'therapist',
        email: 'therapist@test.com',
        accessibleRoutes: ['/', '/clients'],
        restrictedRoutes: ['/therapists', '/admin', '/billing', '/settings'],
      },
      {
        role: 'admin',
        email: 'admin@test.com',
        accessibleRoutes: ['/', '/clients', '/therapists', '/billing', '/settings'],
        restrictedRoutes: [],
      },
      {
        role: 'super_admin',
        email: 'superadmin@test.com',
        accessibleRoutes: ['/', '/clients', '/therapists', '/billing', '/settings'],
        restrictedRoutes: [],
      },
    ];

    testRoles.forEach(({ role, email, accessibleRoutes, restrictedRoutes }) => {
      describe(`${role} role`, () => {
        beforeEach(() => {
          // Mock auth with specific role
          cy.intercept('GET', '**/rest/v1/profiles*', {
            statusCode: 200,
            body: [{
              id: 'test-user-id',
              email: email,
              role: role,
              full_name: `Test ${role}`,
              is_active: true,
              created_at: '2023-01-01T00:00:00Z',
              updated_at: '2023-01-01T00:00:00Z',
            }],
          }).as(`${role}ProfileRequest`);

          // Login as the role
          cy.visit('/login');
          cy.get('input[type="email"]').type(email);
          cy.get('input[type="password"]').type('password123');
          cy.get('button[type="submit"]').click();
          
          // Wait for authentication
          cy.wait('@authRequest');
          cy.url().should('not.include', '/login');
        });

        it(`should access dashboard`, () => {
          cy.visit('/');
          cy.url().should('eq', Cypress.config().baseUrl + '/');
          cy.contains('Dashboard').should('be.visible');
        });

        accessibleRoutes.forEach(route => {
          if (route !== '/') {
            it(`should access ${route}`, () => {
              cy.visit(route);
              cy.url().should('include', route);
              cy.get('body').should('not.contain', 'Access Denied');
            });
          }
        });

        restrictedRoutes.forEach(route => {
          it(`should be denied access to ${route}`, () => {
            cy.visit(route);
            cy.url().should('include', '/unauthorized');
            cy.contains('Access Denied').should('be.visible');
            cy.contains(`Current role: ${role}`).should('be.visible');
          });
        });
      });
    });
  });

  describe('Authentication State Management', () => {
    it('should redirect to login when accessing protected routes unauthenticated', () => {
      cy.visit('/clients');
      cy.url().should('include', '/login');
    });

    it('should redirect to original page after login', () => {
      cy.visit('/clients');
      cy.url().should('include', '/login');
      
      cy.get('input[type="email"]').type('therapist@test.com');
      cy.get('input[type="password"]').type('password123');
      cy.get('button[type="submit"]').click();
      
      cy.wait('@authRequest');
      cy.url().should('include', '/clients');
    });

    it('should persist authentication state across page refreshes', () => {
      cy.visit('/login');
      cy.get('input[type="email"]').type('admin@test.com');
      cy.get('input[type="password"]').type('password123');
      cy.get('button[type="submit"]').click();
      
      cy.wait('@authRequest');
      cy.url().should('not.include', '/login');
      
      cy.reload();
      cy.url().should('not.include', '/login');
      cy.get('body').should('not.contain', 'Sign in to AllIncompassing');
    });

    it('should handle logout correctly', () => {
      cy.visit('/login');
      cy.get('input[type="email"]').type('admin@test.com');
      cy.get('input[type="password"]').type('password123');
      cy.get('button[type="submit"]').click();
      
      cy.wait('@authRequest');
      cy.url().should('not.include', '/login');
      
      // Look for logout button (assuming it's in the navigation)
      cy.get('[data-cy="logout-button"]').should('exist').click();
      cy.url().should('include', '/login');
    });
  });

  describe('Real-time Profile Updates', () => {
    it('should update profile information in real-time', () => {
      cy.visit('/login');
      cy.get('input[type="email"]').type('admin@test.com');
      cy.get('input[type="password"]').type('password123');
      cy.get('button[type="submit"]').click();
      
      cy.wait('@authRequest');
      
      // Mock profile update
      cy.intercept('PATCH', '**/rest/v1/profiles*', {
        statusCode: 200,
        body: {
          id: 'test-user-id',
          email: 'admin@test.com',
          role: 'admin',
          full_name: 'Updated Admin Name',
          is_active: true,
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
        },
      }).as('profileUpdateRequest');

      // Simulate profile update (this would typically be done via settings page)
      cy.visit('/settings');
      // The profile should update in real-time when the database changes
      // This would be tested with the actual real-time subscription
    });
  });

  describe('Error Handling', () => {
    it('should handle authentication errors gracefully', () => {
      cy.intercept('POST', '**/auth/v1/token*', {
        statusCode: 401,
        body: { error: 'Invalid credentials' },
      }).as('authError');

      cy.visit('/login');
      cy.get('input[type="email"]').type('invalid@test.com');
      cy.get('input[type="password"]').type('wrongpassword');
      cy.get('button[type="submit"]').click();
      
      cy.wait('@authError');
      cy.contains('Invalid credentials').should('be.visible');
    });

    it('should handle network errors gracefully', () => {
      cy.intercept('POST', '**/auth/v1/token*', {
        statusCode: 500,
        body: { error: 'Internal server error' },
      }).as('networkError');

      cy.visit('/login');
      cy.get('input[type="email"]').type('admin@test.com');
      cy.get('input[type="password"]').type('password123');
      cy.get('button[type="submit"]').click();
      
      cy.wait('@networkError');
      cy.contains('error').should('be.visible');
    });
  });

  describe('Unauthorized Page', () => {
    it('should display proper unauthorized page', () => {
      cy.visit('/unauthorized');
      cy.contains('Access Denied').should('be.visible');
      cy.get('button').contains('Go Back').should('be.visible');
      cy.get('button').contains('Return to Dashboard').should('be.visible');
    });

    it('should navigate back from unauthorized page', () => {
      cy.visit('/unauthorized');
      cy.get('button').contains('Return to Dashboard').click();
      cy.url().should('eq', Cypress.config().baseUrl + '/');
    });
  });
});