import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingSteps } from '../OnboardingSteps';

describe('OnboardingSteps', () => {
  it('renders labels and highlights current step', () => {
    render(<OnboardingSteps labels={['A', 'B', 'C']} currentStep={2} />);

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();

    // active step should show number 2
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
