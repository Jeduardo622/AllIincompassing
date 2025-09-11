import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AlternativeTimes from '../AlternativeTimes';
import { parseISO, addHours } from 'date-fns';

describe('AlternativeTimes', () => {
  const mockStartTime = new Date().toISOString();
  const mockEndTime = addHours(parseISO(mockStartTime), 1).toISOString();
  
  const mockAlternatives = [
    {
      startTime: mockStartTime,
      endTime: mockEndTime,
      score: 0.9,
      reason: 'This time works well for both therapist and client'
    },
    {
      startTime: addHours(parseISO(mockStartTime), 2).toISOString(),
      endTime: addHours(parseISO(mockEndTime), 2).toISOString(),
      score: 0.7,
      reason: 'Both are available but not their preferred time'
    }
  ];

  it('renders loading state correctly', () => {
    render(
      <AlternativeTimes
        alternatives={[]}
        isLoading={true}
        onSelectTime={() => {}}
      />
    );
    
    expect(screen.getByText('Finding alternative times...')).toBeInTheDocument();
  });

  it('renders empty state correctly', () => {
    render(
      <AlternativeTimes
        alternatives={[]}
        isLoading={false}
        onSelectTime={() => {}}
      />
    );
    
    expect(screen.getByText('No alternative times could be found. Try adjusting the date or participants.')).toBeInTheDocument();
  });

  it('renders alternatives correctly', () => {
    render(
      <AlternativeTimes
        alternatives={mockAlternatives}
        isLoading={false}
        onSelectTime={() => {}}
      />
    );
    
    expect(screen.getByText(/Alternative Times|Suggested Alternative Times/i)).toBeInTheDocument();
    expect(screen.getByText('This time works well for both therapist and client')).toBeInTheDocument();
    expect(screen.getByText('Both are available but not their preferred time')).toBeInTheDocument();
  });

  it('calls onSelectTime when an alternative is clicked', () => {
    const mockOnSelectTime = vi.fn();
    
    render(
      <AlternativeTimes
        alternatives={mockAlternatives}
        isLoading={false}
        onSelectTime={mockOnSelectTime}
      />
    );
    
    // Click the first alternative
    fireEvent.click(screen.getAllByRole('button')[0]);
    
    expect(mockOnSelectTime).toHaveBeenCalledWith(
      mockAlternatives[0].startTime,
      mockAlternatives[0].endTime
    );
  });

  it('sorts alternatives by score', () => {
    const lowScoreAlt = {
      startTime: addHours(parseISO(mockStartTime), 4).toISOString(),
      endTime: addHours(parseISO(mockEndTime), 4).toISOString(),
      score: 0.3,
      reason: 'Not ideal but possible'
    };
    
    render(
      <AlternativeTimes
        alternatives={[lowScoreAlt, ...mockAlternatives]}
        isLoading={false}
        onSelectTime={() => {}}
      />
    );
    
    const reasons = screen.getAllByText(/This time works|Both are available|Not ideal but possible/);
    
    // First should be highest score (0.9)
    expect(reasons[0].textContent).toBe('This time works well for both therapist and client');
    // Last should be lowest score (0.3)
    expect(reasons[2].textContent).toBe('Not ideal but possible');
  });
});