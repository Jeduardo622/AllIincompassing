import { beforeEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import { fireEvent } from '@testing-library/react';
import { SessionModal } from '../SessionModal';
import { supabase } from '../../lib/supabase';
import type { Session } from '../../types';

type SupabaseQueryChain = {
  select: () => SupabaseQueryChain;
  eq: () => SupabaseQueryChain;
  order: () => Promise<{ data: unknown[]; error: null }>;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  limit: () => Promise<{ data: unknown[]; error: null }>;
};

describe('SessionModal', () => {
  const mockPrograms = [
    {
      id: 'program-1',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      name: 'Default Program',
      description: 'Default program for tests',
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ];

  const mockGoals = [
    {
      id: 'goal-1',
      organization_id: 'org-a',
      client_id: 'test-client-1',
      program_id: 'program-1',
      title: 'Default Goal',
      description: 'Default goal for tests',
      original_text: 'Default clinical wording',
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    const buildChain = (rows: unknown[]) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    const defaultChain = buildChain([]);

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      return defaultChain;
    });
  });

  const mockTherapists = [
    {
      id: 'test-therapist-1',
      organization_id: 'org-a',
      email: 'therapist1@example.com',
      full_name: 'Test Therapist 1',
      status: 'active',
      specialties: ['ABA Therapy'],
      service_type: ['In clinic'],
      availability_hours: {
        monday: { start: '09:00', end: '17:00' },
        tuesday: { start: '09:00', end: '17:00' },
      },
    },
  ];

  const mockClients = [
    {
      id: 'test-client-1',
      email: 'client1@example.com',
      full_name: 'Test Client 1',
      date_of_birth: '2020-01-01',
      service_preference: ['In clinic'],
      authorized_hours: 10,
      availability_hours: {
        monday: { start: '09:00', end: '17:00' },
        tuesday: { start: '09:00', end: '17:00' },
      },
    },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    therapists: mockTherapists,
    clients: mockClients,
    existingSessions: [],
    timeZone: "America/New_York",
  };

  it('renders the modal when open', () => {
    renderWithProviders(<SessionModal {...defaultProps} />);
    expect(screen.getByText(/New Session/)).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'session-modal-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'session-modal-description');
    expect(screen.queryByRole('region', { name: /Session not saved/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Scheduling Conflicts/i })).not.toBeInTheDocument();
  });

  it('shows validation errors for required fields', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);
    
    const form = document.getElementById('session-form');
    expect(form).toBeInstanceOf(HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByText(/Therapist is required/)).toBeInTheDocument();
      expect(screen.getByText(/Client is required/)).toBeInTheDocument();
      expect(screen.getByText(/Program is required/)).toBeInTheDocument();
      expect(screen.getByText(/Primary goal is required/)).toBeInTheDocument();
    });
  });

  it('calls onSubmit with form data when valid', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);

    // Fill out the form
    await userEvent.selectOptions(
      screen.getByLabelText(/Therapist/i),
      'test-therapist-1'
    );
    await userEvent.selectOptions(
      screen.getByLabelText(/Client/i),
      'test-client-1'
    );
    await screen.findByRole('option', { name: /Default Program/i });
    await userEvent.selectOptions(
      screen.getByLabelText(/Program/i),
      'program-1'
    );
    await screen.findByRole('option', { name: /Default Goal/i });
    await userEvent.selectOptions(
      screen.getByLabelText(/Primary Goal/i),
      'goal-1'
    );

    // Set start and end times
    const startTime = screen.getByLabelText(/Start Time/i);
    const endTime = screen.getByLabelText(/End Time/i);
    fireEvent.change(startTime, { target: { value: '2025-03-18T10:00' } });
    fireEvent.change(endTime, { target: { value: '2025-03-18T11:00' } });

    // Submit the form (no conflicts path)
    const submitButton = screen.getByRole('button', { name: /Create Session/i });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(defaultProps.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        therapist_id: 'test-therapist-1',
        client_id: 'test-client-1',
        program_id: 'program-1',
        goal_id: 'goal-1',
        start_time: '2025-03-18T14:00:00.000Z',
        end_time: '2025-03-18T15:00:00.000Z',
        status: 'scheduled',
      }));
    });
  }, 15000);

  it('shows conflict banner and proceeds after user confirmation', async () => {
    // Existing overlapping session to trigger conflict
    const existingSessions = [{
      id: 'conflict-1',
      therapist_id: 'test-therapist-1',
      client_id: 'test-client-1',
      program_id: 'program-1',
      goal_id: 'goal-1',
      start_time: '2025-03-18T14:15:00.000Z',
      end_time: '2025-03-18T14:45:00.000Z',
      status: 'scheduled',
      notes: 'Existing conflicting session',
      created_at: '2025-03-18T14:00:00.000Z',
      created_by: 'test-user',
      updated_at: '2025-03-18T14:00:00.000Z',
      updated_by: 'test-user',
    }] satisfies Session[];

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        existingSessions={existingSessions}
        retryHint="Pick a different time or refresh the schedule."
      />
    );

    // Fill out the form
    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await screen.findByRole('option', { name: /Default Program/i });
    await userEvent.selectOptions(screen.getByLabelText(/Program/i), 'program-1');
    await screen.findByRole('option', { name: /Default Goal/i });
    await userEvent.selectOptions(screen.getByLabelText(/Primary Goal/i), 'goal-1');
    // Use change events for datetime-local inputs to ensure value is set reliably
    const startInput = screen.getByLabelText(/Start Time/i);
    const endInput = screen.getByLabelText(/End Time/i);
    fireEvent.change(startInput, { target: { value: '2025-03-18T10:00' } });
    fireEvent.change(endInput, { target: { value: '2025-03-18T11:00' } });

    // Conflict banner should render
    await waitFor(() => {
      expect(screen.getByText(/Scheduling Conflicts/i)).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('session-modal-description');
    expect(describedBy).toContain('session-modal-retry-description');
    expect(describedBy).toContain('session-modal-conflicts-description');
    expect(screen.getByRole('region', { name: /Session not saved/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Scheduling Conflicts/i })).toBeInTheDocument();

    // User chooses to proceed
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /Create Session/i }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(defaultProps.onSubmit).toHaveBeenCalled();
    });
  });

  it('wires conflict-only callout into dialog description when retry hint is absent', async () => {
    const existingSessions = [{
      id: 'conflict-only',
      therapist_id: 'test-therapist-1',
      client_id: 'test-client-1',
      program_id: 'program-1',
      goal_id: 'goal-1',
      start_time: '2025-03-18T14:15:00.000Z',
      end_time: '2025-03-18T14:45:00.000Z',
      status: 'scheduled',
      notes: 'Existing conflicting session',
      created_at: '2025-03-18T14:00:00.000Z',
      created_by: 'test-user',
      updated_at: '2025-03-18T14:00:00.000Z',
      updated_by: 'test-user',
    }] satisfies Session[];

    renderWithProviders(<SessionModal {...defaultProps} existingSessions={existingSessions} />);

    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await screen.findByRole('option', { name: /Default Program/i });
    await userEvent.selectOptions(screen.getByLabelText(/Program/i), 'program-1');
    await screen.findByRole('option', { name: /Default Goal/i });
    await userEvent.selectOptions(screen.getByLabelText(/Primary Goal/i), 'goal-1');
    fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: '2025-03-18T10:00' } });
    fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: '2025-03-18T11:00' } });

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /Scheduling Conflicts/i })).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('session-modal-description');
    expect(describedBy).toContain('session-modal-conflicts-description');
    expect(describedBy).not.toContain('session-modal-retry-description');
  });

  it('includes retry hint content in dialog description when retry guidance is shown', () => {
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        retryHint="Pick a different time or refresh the schedule."
      />
    );

    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('session-modal-description');
    expect(describedBy).toContain('session-modal-retry-description');
    expect(screen.getByText(/Session not saved/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Session not saved/i })).toBeInTheDocument();
  });

  it('closes modal when cancel button is clicked', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);
    
    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    await userEvent.click(cancelButton);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('uses an accessible close button label and closes on Escape', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);

    const closeButton = screen.getByRole('button', { name: /close session modal/i });
    expect(closeButton).toBeInTheDocument();
    expect(closeButton).toHaveAttribute('title', 'Close session modal');
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('traps focus within the modal when tabbing', async () => {
    renderWithProviders(<SessionModal {...defaultProps} />);

    const closeButton = screen.getByRole('button', { name: /close session modal/i });
    const createButton = screen.getByRole('button', { name: /create session/i });

    closeButton.focus();
    expect(closeButton).toHaveFocus();

    createButton.focus();
    expect(createButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
  });

  it('restores prior focus when modal closes', async () => {
    const outsideButton = document.createElement('button');
    outsideButton.textContent = 'Outside button';
    document.body.appendChild(outsideButton);
    outsideButton.focus();

    const { rerender } = renderWithProviders(
      <SessionModal {...defaultProps} isOpen />
    );

    rerender(<SessionModal {...defaultProps} isOpen={false} />);

    await waitFor(() => {
      expect(outsideButton).toHaveFocus();
    });

    outsideButton.remove();
  });

  it('disables start session when authoritative details already show started_at', async () => {
    const buildChain = (rows: unknown[], singleRow: unknown = null) => {
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: rows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: singleRow, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'sessions') {
        return buildChain([], {
          program_id: 'program-1',
          goal_id: 'goal-1',
          started_at: '2026-01-01T10:00:00.000Z',
        });
      }
      if (table === 'session_goals') {
        return buildChain([{ goal_id: 'goal-1' }]);
      }
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        session={{
          id: 'session-started',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-01-01T10:00:00.000Z',
          end_time: '2026-01-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-01-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-01-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    const startButton = await screen.findByRole('button', { name: /Start Session/i });
    await waitFor(() => {
      expect(startButton).toBeDisabled();
    });
  });
});
