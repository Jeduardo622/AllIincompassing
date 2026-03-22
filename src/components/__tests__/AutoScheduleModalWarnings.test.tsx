import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AutoScheduleModal } from '../AutoScheduleModal';
import type { Therapist, Client, Session } from '../../types';
import { generateOptimalSchedule } from '../../lib/autoSchedule';

vi.mock('../../lib/autoSchedule', () => ({
  generateOptimalSchedule: vi.fn()
}));

const createTherapist = (overrides: Partial<Therapist> = {}): Therapist => ({
  id: 'therapist-1',
  email: 'therapist@example.com',
  full_name: 'Therapist Example',
  specialties: [],
  max_clients: 5,
  service_type: ['ABA'],
  weekly_hours_min: 0,
  weekly_hours_max: 30,
  availability_hours: {
    monday: { start: '08:00', end: '17:00' },
    tuesday: { start: '08:00', end: '17:00' },
    wednesday: { start: '08:00', end: '17:00' },
    thursday: { start: '08:00', end: '17:00' },
    friday: { start: '08:00', end: '17:00' },
    saturday: { start: null, end: null },
    sunday: { start: null, end: null }
  },
  created_at: new Date('2024-01-01T00:00:00Z').toISOString(),
  ...overrides
});

const createClient = (overrides: Partial<Client> = {}): Client => ({
  id: 'client-1',
  email: 'client@example.com',
  full_name: 'Client Example',
  date_of_birth: '2015-01-01',
  insurance_info: {},
  service_preference: ['ABA'],
  one_to_one_units: 0,
  supervision_units: 0,
  parent_consult_units: 0,
  assessment_units: 0,
  availability_hours: {
    monday: { start: '08:00', end: '17:00' },
    tuesday: { start: '08:00', end: '17:00' },
    wednesday: { start: '08:00', end: '17:00' },
    thursday: { start: '08:00', end: '17:00' },
    friday: { start: '08:00', end: '17:00' },
    saturday: { start: null, end: null },
    sunday: { start: null, end: null }
  },
  created_at: new Date('2024-01-01T00:00:00Z').toISOString(),
  ...overrides
});

const mockedGenerateOptimalSchedule = vi.mocked(generateOptimalSchedule);

describe('AutoScheduleModal warnings', () => {
  beforeEach(() => {
    mockedGenerateOptimalSchedule.mockReset();
  });

  it('renders as an accessible dialog with labeled controls', () => {
    render(
      <AutoScheduleModal
        isOpen
        onClose={() => {}}
        onSchedule={vi.fn()}
        therapists={[createTherapist()]}
        clients={[createClient()]}
        existingSessions={[] as Session[]}
      />
    );

    expect(
      screen.getByRole('dialog', { name: /auto schedule sessions/i })
    ).toBeInTheDocument();
    const closeButton = screen.getByRole('button', { name: /close auto schedule modal/i });
    expect(closeButton).toBeInTheDocument();
    expect(closeButton).toHaveAttribute('title', 'Close auto schedule modal');
  });

  it('exposes labeled preview pager controls when multiple preview pages exist', () => {
    const therapist = createTherapist();
    const client = createClient();
    mockedGenerateOptimalSchedule.mockReturnValue({
      slots: Array.from({ length: 6 }, (_, index) => ({
        therapist,
        client,
        startTime: new Date(`2025-03-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`).toISOString(),
        endTime: new Date(`2025-03-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`).toISOString(),
        score: 0.9,
      })),
      cappedClients: [],
    });

    render(
      <AutoScheduleModal
        isOpen
        onClose={() => {}}
        onSchedule={vi.fn()}
        therapists={[therapist]}
        clients={[client]}
        existingSessions={[] as Session[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /generate preview/i }));

    const previousButton = screen.getByRole('button', { name: /previous preview page/i });
    const nextButton = screen.getByRole('button', { name: /next preview page/i });

    expect(previousButton).toHaveAttribute('title', 'Previous preview page');
    expect(nextButton).toHaveAttribute('title', 'Next preview page');
    expect(previousButton).toBeDisabled();
    expect(nextButton).toBeEnabled();
  });

  it('displays capped client warnings when scheduling results indicate limits', () => {
    const therapist = createTherapist();
    const client = createClient();
    const cappedResult = {
      slots: [],
      cappedClients: [
        {
          client,
          remainingMinutes: 0
        }
      ]
    };
    mockedGenerateOptimalSchedule.mockReturnValue(cappedResult);

    render(
      <AutoScheduleModal
        isOpen
        onClose={() => {}}
        onSchedule={vi.fn()}
        therapists={[therapist]}
        clients={[client]}
        existingSessions={[] as Session[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /generate preview/i }));

    expect(mockedGenerateOptimalSchedule).toHaveBeenCalled();
    expect(
      screen.getByText('Some clients are at their monthly limits and were skipped.')
    ).toBeInTheDocument();
    expect(screen.getByText('Client Example')).toBeInTheDocument();
    expect(screen.getByText('No remaining hours')).toBeInTheDocument();
    expect(
      screen.getByText('All eligible clients are already at their authorized limits for the selected range.')
    ).toBeInTheDocument();
  });
});
