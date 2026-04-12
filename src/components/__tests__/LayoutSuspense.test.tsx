import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '../Layout';

vi.mock('../Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar-shell">Sidebar shell</div>,
}));

vi.mock('../../lib/authContext', () => ({
  useAuth: () => ({
    user: { email: 'user@example.com' },
    effectiveRole: 'admin',
  }),
}));

vi.mock('../../lib/useRouteQueryRefetch', () => ({
  useRouteQueryRefetch: vi.fn(),
}));

const pendingRouteLoad = new Promise<never>(() => {});

const SuspendedChildRoute: React.FC = () => {
  throw pendingRouteLoad;
};

describe('Layout suspense boundary', () => {
  it('keeps the app shell visible while routed content is still loading', async () => {
    render(
      <MemoryRouter initialEntries={['/clients']}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route path="clients" element={<SuspendedChildRoute />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('sidebar-shell')).toBeInTheDocument();
    const roleIndicator = screen.getByText('Logged in as:').closest('div');
    expect(roleIndicator).toHaveTextContent('user@example.com');
    expect(roleIndicator).toHaveTextContent('Role: admin');

    const fallback = await screen.findByLabelText('Loading page content');
    expect(fallback).toBeInTheDocument();
  });
});
