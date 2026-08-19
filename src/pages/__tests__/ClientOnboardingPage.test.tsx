import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ClientOnboardingPage } from '../ClientOnboardingPage';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../components/ClientOnboarding', () => ({
  ClientOnboarding: () => <div>Client Onboarding Form</div>,
}));

describe('ClientOnboardingPage', () => {
  it('gives the back control an accessible name', () => {
    render(
      <MemoryRouter>
        <ClientOnboardingPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: /back to clients/i })).toBeInTheDocument();
  });
});
