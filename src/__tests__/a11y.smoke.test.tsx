import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
vi.mock('../lib/authContext', async () => {
  return {
    useAuth: () => ({
      user: null,
      profile: null,
      session: null,
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      resetPassword: vi.fn(),
      updateProfile: vi.fn(),
      hasRole: () => false,
      hasAnyRole: () => false,
      isAdmin: () => false,
      isSuperAdmin: () => false,
    }),
  };
});

import Login from '../pages/Login';
import Signup from '../pages/Signup';

expect.extend(toHaveNoViolations);

const renderWithRouter = (ui: React.ReactElement) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

describe('a11y: forms smoke', () => {
  it('Login has labeled inputs and no axe violations in scope', async () => {
    const { container } = renderWithRouter(
      <main role="main">
        <Login />
      </main>
    );

    // Labeled controls presence
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('Signup critical fields are labeled and no axe violations in scope', async () => {
    const { container } = renderWithRouter(
      <main role="main">
        <Signup />
      </main>
    );

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm/i)).toBeInTheDocument();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});


