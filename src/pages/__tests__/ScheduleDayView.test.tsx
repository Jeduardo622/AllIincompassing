import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScheduleDayView } from '../ScheduleDayView';

vi.mock('../ScheduleCalendarViewShared', () => ({
  DayColumn: () => <div data-testid="day-column">Day column</div>,
}));

describe('ScheduleDayView', () => {
  it('shows a visible horizontal-scroll affordance', () => {
    render(
      <ScheduleDayView
        selectedDate={new Date('2026-08-19T08:00:00Z')}
        timeSlots={['08:00', '08:30']}
        sessionSlotIndex={new Map()}
        onCreateSession={vi.fn()}
        onEditSession={vi.fn()}
      />,
    );

    expect(screen.getByText(/Scroll horizontally if schedule details are clipped/i)).toBeInTheDocument();
  });
});
