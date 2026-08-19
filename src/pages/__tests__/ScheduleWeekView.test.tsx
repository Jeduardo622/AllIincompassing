import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScheduleWeekView } from '../ScheduleWeekView';

vi.mock('../ScheduleCalendarViewShared', () => ({
  DayColumn: () => <div data-testid="day-column">Day column</div>,
}));

describe('ScheduleWeekView', () => {
  it('shows a visible horizontal-scroll affordance', () => {
    render(
      <ScheduleWeekView
        weekDays={[
          new Date('2026-08-17T08:00:00Z'),
          new Date('2026-08-18T08:00:00Z'),
          new Date('2026-08-19T08:00:00Z'),
          new Date('2026-08-20T08:00:00Z'),
          new Date('2026-08-21T08:00:00Z'),
          new Date('2026-08-22T08:00:00Z'),
        ]}
        timeSlots={['08:00', '08:30']}
        sessionSlotIndex={new Map()}
        onCreateSession={vi.fn()}
        onEditSession={vi.fn()}
      />,
    );

    expect(screen.getByText(/Scroll horizontally if schedule details are clipped/i)).toBeInTheDocument();
  });
});
