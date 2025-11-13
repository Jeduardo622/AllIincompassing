import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createRef } from 'react';
import ErrorBoundary from '../ErrorBoundary';

describe('ErrorBoundary', () => {
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Test content</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('renders error UI when an error occurs', async () => {
    const boundaryRef = createRef<ErrorBoundary>();

    render(
      <ErrorBoundary ref={boundaryRef}>
        <div>Normal child</div>
      </ErrorBoundary>
    );

    await act(async () => {
      boundaryRef.current?.setState({ hasError: true, error: new Error('Test error') });
    });

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/We apologize for the inconvenience/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh Page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Homepage' })).toBeInTheDocument();
  });
});