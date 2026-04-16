import { beforeEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import { fireEvent } from '@testing-library/react';
import { SessionModal } from '../SessionModal';
import { supabase } from '../../lib/supabase';
import type { Session } from '../../types';
import { startSessionFromModal } from '../../features/scheduling/domain/sessionStart';

vi.mock('../../features/scheduling/domain/sessionStart', () => ({
  startSessionFromModal: vi.fn(),
}));

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
      measurement_type: 'frequency',
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.mocked(startSessionFromModal).mockReset();
    defaultProps.onClose.mockClear();
    defaultProps.onSubmit.mockClear();

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
    expect(dialog).toHaveAttribute('data-session-modal-mode', 'create');
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

  it('shows unsaved state and asks before closing dirty changes', async () => {
    const onClose = vi.fn();
    renderWithProviders(<SessionModal {...defaultProps} onClose={onClose} />);

    const notesInput = screen.getByLabelText(/Schedule Notes/i);
    await userEvent.type(notesInput, 'Therapist working note');

    expect(screen.getByTestId('session-modal-save-state')).toHaveTextContent('Unsaved changes.');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const closeCountBeforeCancel = onClose.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(closeCountBeforeCancel);

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(onClose.mock.calls.length).toBeGreaterThan(closeCountBeforeCancel);
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

  it('hides start session when authoritative details already show started_at', async () => {
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

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Start Session/i })).not.toBeInTheDocument();
    });
    expect(screen.getByText('Live session')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('data-session-modal-mode', 'live');
    expect(screen.getByTestId('session-modal-in-progress-guidance')).toBeInTheDocument();
    expect(screen.getByTestId('session-modal-notes-guidance')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save progress/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Close Session$/i })).toBeInTheDocument();
  });

  it('keeps update-session submit copy when edit session has not started', () => {
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        session={{
          id: 'session-edit-copy',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    expect(screen.getByRole('button', { name: /Update Session/i })).toBeInTheDocument();
    expect(screen.queryByTestId('session-modal-in-progress-guidance')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Close Session$/i })).not.toBeInTheDocument();
  });

  it('does not show in-progress guidance for completed sessions with started_at', async () => {
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
          id: 'session-completed',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-01-01T10:00:00.000Z',
          end_time: '2026-01-01T11:00:00.000Z',
          status: 'completed',
          notes: '',
          created_at: '2026-01-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-01-01T09:00:00.000Z',
          updated_by: null,
          started_at: '2026-01-01T10:00:00.000Z',
        } satisfies Session}
      />
    );

    await waitFor(() => {
      expect(screen.queryByTestId('session-modal-in-progress-guidance')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Update Session/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Close Session$/i })).not.toBeInTheDocument();
  });

  it('submits completed status when Close Session is clicked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-close-action',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: '2026-03-01T10:00:00.000Z',
        } satisfies Session}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^Close Session$/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        status: 'completed',
      }));
    });
  });

  it('blocks Close Session when session capture needs billing defaults but none exist', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
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
          started_at: '2026-03-01T10:00:00.000Z',
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
      if (table === 'authorizations') {
        return buildChain([]);
      }
      if (table === 'client_session_notes') {
        return buildChain([]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-close-clinical-validation',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: '2026-03-01T10:00:00.000Z',
        } satisfies Session}
      />
    );

    fireEvent.change(await screen.findByLabelText(/^Per-goal note$/i), {
      target: { value: 'Progress details' },
    });
    await userEvent.click(screen.getByRole('button', { name: /^Close Session$/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSessionStarted after a successful Start Session', async () => {
    vi.mocked(startSessionFromModal).mockResolvedValue(undefined);
    const onSessionStarted = vi.fn();

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSessionStarted={onSessionStarted}
        session={{
          id: 'session-to-start',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    const startButton = await screen.findByRole('button', { name: /Start Session/i });
    await waitFor(() => expect(startButton).not.toBeDisabled());
    await userEvent.click(startButton);

    await waitFor(() => {
      expect(vi.mocked(startSessionFromModal)).toHaveBeenCalledOnce();
      expect(onSessionStarted).toHaveBeenCalledOnce();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('status select — create mode (no session prop)', () => {
    it('disables in_progress option in create mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} />);
      const option = screen.getByRole('option', { name: /In Progress/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(true);
    });

    it('disables completed option in create mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} />);
      const option = screen.getByRole('option', { name: /^Completed$/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(true);
    });

    it('disables no-show option in create mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} />);
      const option = screen.getByRole('option', { name: /No Show/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(true);
    });

    it('keeps scheduled enabled in create mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} />);
      const option = screen.getByRole('option', { name: /^Scheduled$/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(false);
    });

    it('keeps cancelled enabled in create mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} />);
      const option = screen.getByRole('option', { name: /^Cancelled$/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(false);
    });
  });

  describe('status select — edit mode (session prop present)', () => {
    const editSession: Session = {
      id: 'session-edit',
      therapist_id: 'test-therapist-1',
      client_id: 'test-client-1',
      program_id: 'program-1',
      goal_id: 'goal-1',
      start_time: '2026-03-31T10:00:00.000Z',
      end_time: '2026-03-31T11:00:00.000Z',
      status: 'scheduled',
      notes: '',
      created_at: '2026-03-31T09:00:00.000Z',
      created_by: null,
      updated_at: '2026-03-31T09:00:00.000Z',
      updated_by: null,
      started_at: null,
    };

    it('enables completed option in edit mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} session={editSession} />);
      const option = screen.getByRole('option', { name: /^Completed$/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(false);
    });

    it('enables no-show option in edit mode', () => {
      renderWithProviders(<SessionModal {...defaultProps} session={editSession} />);
      const option = screen.getByRole('option', { name: /No Show/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(false);
    });

    it('keeps in_progress disabled in edit mode (display-only state)', () => {
      renderWithProviders(<SessionModal {...defaultProps} session={editSession} />);
      const option = screen.getByRole('option', { name: /In Progress/i }) as HTMLOptionElement;
      expect(option.disabled).toBe(true);
    });

    it('shows in_progress as current value when session status is in_progress', () => {
      renderWithProviders(
        <SessionModal
          {...defaultProps}
          session={{ ...editSession, status: 'in_progress' }}
        />
      );
      const select = screen.getByRole('combobox', { name: /Status/i }) as HTMLSelectElement;
      expect(select.value).toBe('in_progress');
    });
  });

  it('shows saved state after successful update for edit sessions', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-save-success',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await screen.findByRole('option', { name: /Default Program/i });
    await userEvent.selectOptions(screen.getByLabelText(/Program/i), 'program-1');
    await screen.findByRole('option', { name: /Default Goal/i });
    await userEvent.selectOptions(screen.getByLabelText(/Primary Goal/i), 'goal-1');
    fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: '2026-03-01T10:00' } });
    fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: '2026-03-01T11:00' } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /Update Session/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    confirmSpy.mockRestore();
    const saveState = screen.getByTestId('session-modal-save-state');
    expect(saveState).toHaveTextContent('Session details saved.');
    expect(saveState).toHaveAttribute('role', 'status');
    expect(saveState).toHaveAttribute('aria-live', 'polite');
  });

  it('resets saved status after close and reopen', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const props = {
      ...defaultProps,
      onSubmit,
      session: {
        id: 'session-save-reset',
        therapist_id: 'test-therapist-1',
        client_id: 'test-client-1',
        program_id: 'program-1',
        goal_id: 'goal-1',
        start_time: '2026-03-01T10:00:00.000Z',
        end_time: '2026-03-01T11:00:00.000Z',
        status: 'scheduled',
        notes: '',
        created_at: '2026-03-01T09:00:00.000Z',
        created_by: null,
        updated_at: '2026-03-01T09:00:00.000Z',
        updated_by: null,
        started_at: null,
      } satisfies Session,
    };
    const { rerender } = renderWithProviders(<SessionModal {...props} />);

    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await screen.findByRole('option', { name: /Default Program/i });
    await userEvent.selectOptions(screen.getByLabelText(/Program/i), 'program-1');
    await screen.findByRole('option', { name: /Default Goal/i });
    await userEvent.selectOptions(screen.getByLabelText(/Primary Goal/i), 'goal-1');
    fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: '2026-03-01T10:00' } });
    fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: '2026-03-01T11:00' } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /Update Session/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    confirmSpy.mockRestore();
    expect(screen.getByTestId('session-modal-save-state')).toHaveTextContent('Session details saved.');

    rerender(<SessionModal {...props} isOpen={false} />);
    rerender(<SessionModal {...props} isOpen />);

    expect(screen.queryByTestId('session-modal-save-state')).not.toBeInTheDocument();
  });

  it('shows save error state when update fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Save failed'));
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-save-failure',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText(/Therapist/i), 'test-therapist-1');
    await userEvent.selectOptions(screen.getByLabelText(/Client/i), 'test-client-1');
    await screen.findByRole('option', { name: /Default Program/i });
    await userEvent.selectOptions(screen.getByLabelText(/Program/i), 'program-1');
    await screen.findByRole('option', { name: /Default Goal/i });
    await userEvent.selectOptions(screen.getByLabelText(/Primary Goal/i), 'goal-1');
    fireEvent.change(screen.getByLabelText(/Start Time/i), { target: { value: '2026-03-01T10:00' } });
    fireEvent.change(screen.getByLabelText(/End Time/i), { target: { value: '2026-03-01T11:00' } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /Update Session/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    confirmSpy.mockRestore();
    expect(screen.getByTestId('session-modal-save-state')).toHaveTextContent(
      'Unable to save session details. Try again.'
    );
  });

  it('renders session capture section for existing sessions', () => {
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        session={{
          id: 'session-clinical-ui',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    expect(screen.getByTestId('session-modal-capture-section')).toBeInTheDocument();
    expect(screen.getByText('Live session')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('data-session-modal-mode', 'live');
    expect(screen.queryByRole('button', { name: /Start Session/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Skill$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^BX$/i })).toBeInTheDocument();
  });

  it('submits normalized per-goal measurements with session capture', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
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

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-clinical-measurements',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await screen.findByRole('button', { name: /Increase correct trials/i });
    fireEvent.change(screen.getByLabelText(/^Per-goal note$/i), {
      target: { value: 'Observed steady progress' },
    });
    for (let i = 0; i < 4; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: /Increase correct trials/i }));
    }
    fireEvent.change(screen.getByLabelText(/Prompts & reactions/i), {
      target: { value: 'Needed one reminder at the start' },
    });

    await userEvent.click(screen.getByRole('button', { name: /Save progress/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        session_note_authorization_id: 'auth-1',
        session_note_service_code: '97153',
        session_note_goal_measurements: {
          'goal-1': {
            version: 1,
            data: expect.objectContaining({
              measurement_type: 'frequency',
              metric_label: 'Count',
              metric_unit: 'responses',
              metric_value: 4,
              trial_prompt_note: 'Needed one reminder at the start',
            }),
          },
        },
      }));
    });
  }, 10000);

  it('includes +5 trial shortcut in saved correct counts', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
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

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        return buildChain(mockPrograms);
      }
      if (table === 'goals') {
        return buildChain(mockGoals);
      }
      if (table === 'authorizations') {
        return buildChain([
          {
            id: 'auth-1',
            authorization_number: 'AUTH-001',
            services: [{ service_code: '97153' }],
          },
        ]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-trial-plus-five',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await screen.findByRole('button', { name: /Add 5 correct trials/i });
    fireEvent.change(screen.getByLabelText(/^Per-goal note$/i), {
      target: { value: 'Bundled trials' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Add 5 correct trials/i }));
    await userEvent.click(screen.getByRole('button', { name: /Increase correct trials/i }));

    await userEvent.click(screen.getByRole('button', { name: /Save Session Details/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          session_note_goal_measurements: {
            'goal-1': {
              version: 1,
              data: expect.objectContaining({
                metric_value: 6,
              }),
            },
          },
        }),
      );
    });
  }, 10000);

  it('disables subtract-5 correct trials when count is under five', async () => {
    renderWithProviders(
      <SessionModal
        {...defaultProps}
        session={{
          id: 'session-trial-minus-five-disabled',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await screen.findByRole('button', { name: /Subtract 5 correct trials/i });
    expect(screen.getByRole('button', { name: /Subtract 5 correct trials/i })).toBeDisabled();
  });

  it('normalizes linked legacy goal_measurements payloads on save', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const linkedSessionNote = {
      id: 'linked-note-1',
      authorization_id: 'auth-1',
      service_code: '97153',
      narrative: '',
      goal_notes: {
        'goal-1': 'Observed steady progress',
      },
      goal_measurements: {
        'goal-1': {
          count: 4,
          trials: 5,
          promptLevel: 'Gestural',
        },
      },
      goal_ids: ['goal-1'],
      goals_addressed: ['Default Goal'],
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockPrograms, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'goals') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockGoals, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'authorizations') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(async () => ({
            data: [{ id: 'auth-1', authorization_number: 'AUTH-001', services: [{ service_code: '97153' }] }],
            error: null,
          })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'client_session_notes') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: linkedSessionNote, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-linked-legacy-measurements',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Observed steady progress')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Save progress/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        session_note_goal_measurements: {
          'goal-1': {
            version: 1,
            data: expect.objectContaining({
              metric_label: 'Count',
              metric_value: 4,
              opportunities: 5,
              prompt_level: 'Gestural',
            }),
          },
        },
      }));
    });
  }, 10000);

  it('preserves linked note measurements for drifted saved goals when saving', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const linkedSessionNote = {
      id: 'linked-note-drifted-goals',
      authorization_id: 'auth-1',
      service_code: '97153',
      narrative: '',
      goal_notes: {
        'goal-1': 'Observed steady progress',
        'goal-legacy': 'Maintained prior skill with faded prompts',
      },
      goal_measurements: {
        'goal-1': {
          version: 1,
          data: {
            measurement_type: 'frequency',
            metric_label: 'Count',
            metric_unit: 'responses',
            metric_value: 4,
          },
        },
        'goal-legacy': {
          count: 2,
          promptLevel: 'Independent',
          note: 'Legacy goal stayed stable',
        },
      },
      goal_ids: ['goal-1', 'goal-legacy'],
      goals_addressed: ['Default Goal', 'Legacy Goal'],
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockPrograms, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'goals') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockGoals, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'authorizations') {
        const chain: SupabaseQueryChain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(async () => ({
            data: [{ id: 'auth-1', authorization_number: 'AUTH-001', services: [{ service_code: '97153' }] }],
            error: null,
          })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          limit: vi.fn(async () => ({ data: [], error: null })),
        };
        return chain;
      }
      if (table === 'client_session_notes') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: linkedSessionNote, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      const chain: SupabaseQueryChain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: [], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
      };
      return chain;
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-linked-drifted-goals',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Maintained prior skill with faded prompts')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Save progress/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        goal_ids: ['goal-1'],
        session_note_goal_ids: ['goal-1', 'goal-legacy'],
        session_note_goal_measurements: {
          'goal-1': {
            version: 1,
            data: expect.objectContaining({
              metric_value: 4,
            }),
          },
          'goal-legacy': {
            version: 1,
            data: expect.objectContaining({
              metric_label: 'Count',
              metric_value: 2,
              prompt_level: 'Independent',
              note: 'Legacy goal stayed stable',
            }),
          },
        },
      }));
    });
  }, 10000);

  it('blocks submit when session capture is present without authorization metadata', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
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
          started_at: null,
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
      if (table === 'authorizations') {
        return buildChain([]);
      }
      if (table === 'client_session_notes') {
        return buildChain([]);
      }
      return buildChain([]);
    });

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSubmit={onSubmit}
        session={{
          id: 'session-clinical-validation',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'in_progress',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    fireEvent.change(await screen.findByLabelText(/^Per-goal note$/i), {
      target: { value: 'Progress details' },
    });
    await userEvent.click(screen.getByRole('button', { name: /Save progress/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not call onSessionStarted when startSessionFromModal rejects', async () => {
    vi.mocked(startSessionFromModal).mockRejectedValue(new Error('RPC failure'));
    const onSessionStarted = vi.fn();

    renderWithProviders(
      <SessionModal
        {...defaultProps}
        onSessionStarted={onSessionStarted}
        session={{
          id: 'session-fail-start',
          therapist_id: 'test-therapist-1',
          client_id: 'test-client-1',
          program_id: 'program-1',
          goal_id: 'goal-1',
          start_time: '2026-03-01T10:00:00.000Z',
          end_time: '2026-03-01T11:00:00.000Z',
          status: 'scheduled',
          notes: '',
          created_at: '2026-03-01T09:00:00.000Z',
          created_by: null,
          updated_at: '2026-03-01T09:00:00.000Z',
          updated_by: null,
          started_at: null,
        } satisfies Session}
      />
    );

    const startButton = await screen.findByRole('button', { name: /Start Session/i });
    await waitFor(() => expect(startButton).not.toBeDisabled());
    await userEvent.click(startButton);

    await waitFor(() => {
      expect(vi.mocked(startSessionFromModal)).toHaveBeenCalledOnce();
    });
    expect(onSessionStarted).not.toHaveBeenCalled();
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });
});
