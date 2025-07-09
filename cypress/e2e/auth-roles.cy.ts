describe('Authentication & Authorization System', () => {
  // Test data
  const testUsers = {
    client: {
      email: 'client@test.com',
      password: 'password123',
      firstName: 'Client',
      lastName: 'User',
      role: 'client'
    },
    therapist: {
      email: 'therapist@test.com',
      password: 'password123',
      firstName: 'Therapist',
      lastName: 'User',
      role: 'therapist'
    },
    admin: {
      email: 'admin@test.com',
      password: 'password123',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin'
    },
    superAdmin: {
      email: 'superadmin@test.com',
      password: 'password123',
      firstName: 'Super',
      lastName: 'Admin',
      role: 'super_admin'
    }
  };

  // Helper function to get auth token
  const getAuthToken = (userType: keyof typeof testUsers) => {
    const user = testUsers[userType];
    return cy.request({
      method: 'POST',
      url: '/api/auth/login',
      body: {
        email: user.email,
        password: user.password
      }
    }).then((response) => {
      expect(response.status).to.eq(200);
      return response.body.session.access_token;
    });
  };

  // Helper function to make authenticated request
  const makeAuthenticatedRequest = (token: string, method: string, url: string, body?: any) => {
    return cy.request({
      method,
      url,
      body,
      headers: {
        Authorization: `Bearer ${token}`
      },
      failOnStatusCode: false
    });
  };

  before(() => {
    // Setup test users (this would be handled by database seeding in real tests)
    cy.log('Setting up test users...');
    // In real implementation, you would create test users in the database
    // or use a test user creation endpoint
  });

  describe('Public Routes', () => {
    it('should allow signup for client role', () => {
      cy.request({
        method: 'POST',
        url: '/api/auth/signup',
        body: {
          email: testUsers.client.email,
          password: testUsers.client.password,
          firstName: testUsers.client.firstName,
          lastName: testUsers.client.lastName
        }
      }).then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.message).to.eq('User created successfully');
        expect(response.body.user).to.have.property('id');
        expect(response.body.user).to.have.property('email', testUsers.client.email);
      });
    });

    it('should allow login with valid credentials', () => {
      cy.request({
        method: 'POST',
        url: '/api/auth/login',
        body: {
          email: testUsers.client.email,
          password: testUsers.client.password
        }
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.message).to.eq('Login successful');
        expect(response.body.user).to.have.property('id');
        expect(response.body.profile).to.have.property('role', 'client');
        expect(response.body.session).to.have.property('access_token');
      });
    });

    it('should reject login with invalid credentials', () => {
      cy.request({
        method: 'POST',
        url: '/api/auth/login',
        body: {
          email: testUsers.client.email,
          password: 'wrongpassword'
        },
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(401);
        expect(response.body.error).to.eq('Invalid credentials');
      });
    });

    it('should validate email format on signup', () => {
      cy.request({
        method: 'POST',
        url: '/api/auth/signup',
        body: {
          email: 'invalid-email',
          password: 'password123'
        },
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.eq('Invalid email format');
      });
    });

    it('should validate password strength on signup', () => {
      cy.request({
        method: 'POST',
        url: '/api/auth/signup',
        body: {
          email: 'test@example.com',
          password: 'weak'
        },
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.eq('Password must be at least 8 characters long');
      });
    });
  });

  describe('Authenticated Routes', () => {
    describe('Client Role', () => {
      it('should access own profile', () => {
        getAuthToken('client').then((token) => {
          makeAuthenticatedRequest(token, 'GET', '/api/profiles/me').then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body.profile).to.have.property('role', 'client');
            expect(response.body.profile).to.have.property('email', testUsers.client.email);
          });
        });
      });

      it('should update own profile', () => {
        getAuthToken('client').then((token) => {
          makeAuthenticatedRequest(token, 'PUT', '/api/profiles/me', {
            first_name: 'Updated',
            phone: '+1234567890'
          }).then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body.message).to.eq('Profile updated successfully');
            expect(response.body.profile.first_name).to.eq('Updated');
            expect(response.body.profile.phone).to.eq('+1234567890');
          });
        });
      });

      it('should not access admin routes', () => {
        getAuthToken('client').then((token) => {
          makeAuthenticatedRequest(token, 'GET', '/api/admin/users').then((response) => {
            expect(response.status).to.eq(403);
            expect(response.body.error).to.eq('Insufficient permissions');
          });
        });
      });

      it('should not access super admin routes', () => {
        getAuthToken('client').then((token) => {
          makeAuthenticatedRequest(token, 'PATCH', '/api/admin/users/123/roles', {
            role: 'admin'
          }).then((response) => {
            expect(response.status).to.eq(403);
            expect(response.body.error).to.eq('Insufficient permissions');
          });
        });
      });
    });

    describe('Therapist Role', () => {
      it('should access own profile', () => {
        getAuthToken('therapist').then((token) => {
          makeAuthenticatedRequest(token, 'GET', '/api/profiles/me').then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body.profile).to.have.property('role', 'therapist');
          });
        });
      });

      it('should not access admin routes', () => {
        getAuthToken('therapist').then((token) => {
          makeAuthenticatedRequest(token, 'GET', '/api/admin/users').then((response) => {
            expect(response.status).to.eq(403);
            expect(response.body.error).to.eq('Insufficient permissions');
          });
        });
      });

      it('should not access super admin routes', () => {
        getAuthToken('therapist').then((token) => {
          makeAuthenticatedRequest(token, 'PATCH', '/api/admin/users/123/roles', {
            role: 'admin'
          }).then((response) => {
            expect(response.status).to.eq(403);
            expect(response.body.error).to.eq('Insufficient permissions');
          });
        });
      });
    });

    describe('Admin Role', () => {
      it('should access own profile', () => {
        getAuthToken('admin').then((token) => {
          makeAuthenticatedRequest(token, 'GET', '/api/profiles/me').then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body.profile).to.have.property('role', 'admin');
          });
        });
      });

      it('should access admin routes', () => {
        getAuthToken('admin').then((token) => {
          makeAuthenticatedRequest(token, 'GET', '/api/admin/users').then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body).to.have.property('users');
            expect(response.body).to.have.property('pagination');
          });
        });
      });

      it('should filter users by role', () => {
        getAuthToken('admin').then((token) => {
          makeAuthenticatedRequest(token, 'GET', '/api/admin/users?role=client').then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body.filters.role).to.eq('client');
          });
        });
      });

      it('should not access super admin routes', () => {
        getAuthToken('admin').then((token) => {
          makeAuthenticatedRequest(token, 'PATCH', '/api/admin/users/123/roles', {
            role: 'therapist'
          }).then((response) => {
            expect(response.status).to.eq(403);
            expect(response.body.error).to.eq('Insufficient permissions');
          });
        });
      });
    });

    describe('Super Admin Role', () => {
      it('should access own profile', () => {
        getAuthToken('superAdmin').then((token) => {
          makeAuthenticatedRequest(token, 'GET', '/api/profiles/me').then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body.profile).to.have.property('role', 'super_admin');
          });
        });
      });

      it('should access admin routes', () => {
        getAuthToken('superAdmin').then((token) => {
          makeAuthenticatedRequest(token, 'GET', '/api/admin/users').then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body).to.have.property('users');
            expect(response.body).to.have.property('pagination');
          });
        });
      });

      it('should access super admin routes', () => {
        getAuthToken('superAdmin').then((token) => {
          // First get a user ID to update
          makeAuthenticatedRequest(token, 'GET', '/api/admin/users?role=client&limit=1').then((usersResponse) => {
            expect(usersResponse.status).to.eq(200);
            const userId = usersResponse.body.users[0]?.id;
            
            if (userId) {
              makeAuthenticatedRequest(token, 'PATCH', `/api/admin/users/${userId}/roles`, {
                role: 'therapist'
              }).then((response) => {
                expect(response.status).to.eq(200);
                expect(response.body.message).to.eq('User role updated successfully');
                expect(response.body.changes.new_role).to.eq('therapist');
              });
            }
          });
        });
      });

      it('should not allow self-demotion', () => {
        getAuthToken('superAdmin').then((token) => {
          // Get current user profile to get user ID
          makeAuthenticatedRequest(token, 'GET', '/api/profiles/me').then((profileResponse) => {
            const userId = profileResponse.body.profile.id;
            
            makeAuthenticatedRequest(token, 'PATCH', `/api/admin/users/${userId}/roles`, {
              role: 'admin'
            }).then((response) => {
              expect(response.status).to.eq(403);
              expect(response.body.error).to.eq('Cannot demote yourself from super_admin role');
            });
          });
        });
      });

      it('should not allow self-deactivation', () => {
        getAuthToken('superAdmin').then((token) => {
          makeAuthenticatedRequest(token, 'GET', '/api/profiles/me').then((profileResponse) => {
            const userId = profileResponse.body.profile.id;
            
            makeAuthenticatedRequest(token, 'PATCH', `/api/admin/users/${userId}/roles`, {
              role: 'super_admin',
              is_active: false
            }).then((response) => {
              expect(response.status).to.eq(403);
              expect(response.body.error).to.eq('Cannot deactivate your own account');
            });
          });
        });
      });
    });
  });

  describe('Unauthorized Access', () => {
    it('should reject requests without authentication token', () => {
      cy.request({
        method: 'GET',
        url: '/api/profiles/me',
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(401);
        expect(response.body.error).to.eq('Authentication required');
      });
    });

    it('should reject requests with invalid authentication token', () => {
      cy.request({
        method: 'GET',
        url: '/api/profiles/me',
        headers: {
          Authorization: 'Bearer invalid-token'
        },
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(401);
        expect(response.body.error).to.eq('Authentication required');
      });
    });
  });

  describe('Input Validation', () => {
    it('should validate phone number format', () => {
      getAuthToken('client').then((token) => {
        makeAuthenticatedRequest(token, 'PUT', '/api/profiles/me', {
          phone: 'invalid-phone'
        }).then((response) => {
          expect(response.status).to.eq(400);
          expect(response.body.error).to.eq('Invalid phone number format');
        });
      });
    });

    it('should validate time zone', () => {
      getAuthToken('client').then((token) => {
        makeAuthenticatedRequest(token, 'PUT', '/api/profiles/me', {
          time_zone: 'Invalid/Timezone'
        }).then((response) => {
          expect(response.status).to.eq(400);
          expect(response.body.error).to.eq('Invalid time zone');
        });
      });
    });

    it('should validate role in role update', () => {
      getAuthToken('superAdmin').then((token) => {
        makeAuthenticatedRequest(token, 'PATCH', '/api/admin/users/123/roles', {
          role: 'invalid_role'
        }).then((response) => {
          expect(response.status).to.eq(400);
          expect(response.body.error).to.eq('Valid role is required');
        });
      });
    });
  });

  describe('CORS', () => {
    it('should handle CORS preflight requests', () => {
      cy.request({
        method: 'OPTIONS',
        url: '/api/profiles/me'
      }).then((response) => {
        expect(response.status).to.eq(204);
        expect(response.headers).to.have.property('access-control-allow-origin', '*');
        expect(response.headers).to.have.property('access-control-allow-methods');
        expect(response.headers).to.have.property('access-control-allow-headers');
      });
    });
  });

  after(() => {
    // Cleanup test users
    cy.log('Cleaning up test users...');
    // In real implementation, you would clean up test data
  });
});