import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { AddSessionNoteModal } from '../AddSessionNoteModal';
import { supabase } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const mockProgram = {
  id: 'program-1',
  organization_id: 'org-a',
  client_id: 'client-1',
  name: 'Default Program',
  status: 'active',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockGoal = {
  id: 'goal-1',
  organization_id: 'org-a',
  client_id: 'client-1',
  program_id: 'program-1',
  title: 'Default Goal',
  description: 'Default goal for tests',
  original_text: 'Default clinical wording',
  status: 'active',
  measurement_type: null,
  baseline_data: null,
  target_criteria: null,
  mastery_criteria: null,
  maintenance_criteria: null,
  generalization_criteria: null,
  objective_data_points: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockSession = {
  id: 'session-1',
  start_time: '2026-03-31T10:00:00Z',
  end_time: '2026-03-31T11:00:00Z',
  therapist_id: 'therapist-1',
  therapist: { full_name: 'Test Therapist' },
};

const mockTherapist = {
  id: 'therapist-1',
  full_name: 'Test Therapist',
  title: 'BCBA',
};

// ---------------------------------------------------------------------------
// Chain builders — mirrors the pattern used in SessionModal.test.tsx.
//
// `buildChain`          — `order()` is terminal (programs, goals, session_goals)
// `buildChainWithLimit` — `order()` returns chain, `limit()` is terminal (sessions)
// ---------------------------------------------------------------------------

type QueryChain = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function buildChain(rows: unknown[] = []): QueryChain {
  const chain: QueryChain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(async () => ({ data: rows, error: null })),
    limit: vi.fn(async () => ({ data: rows, error: null })),
    maybeSingle: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
  };
  return chain;
}

// Sessions query ends with .order(...).limit(50) — order must return the chain
// so that .limit() can be called on it as the actual terminal method.
function buildChainWithLimit(rows: unknown[] = []): QueryChain {
  const chain: QueryChain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),  // Returns chain, not a Promise
    limit: vi.fn(async () => ({ data: rows, error: null })),  // Terminal
    maybeSingle: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
  };
  return chain;
}

// ---------------------------------------------------------------------------
// Accessible-label tests (no data needed; use auth: false to keep them fast)
// ---------------------------------------------------------------------------

describe('AddSessionNoteModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    therapists: [],
    clientId: 'client-1',
  };

  it('uses an accessible close button label and title', () => {
    renderWithProviders(<AddSessionNoteModal {...defaultProps} />, { auth: false });

    const closeButton = screen.getByRole('button', { name: /close add session note modal/i });
    expect(closeButton).toBeInTheDocument();
    expect(closeButton).toHaveAttribute('title', 'Close add session note modal');
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();

    renderWithProviders(<AddSessionNoteModal {...defaultProps} onClose={onClose} />, { auth: false });

    fireEvent.click(screen.getByRole('button', { name: /close add session note modal/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// session_goals auto-population tests
// ---------------------------------------------------------------------------

describe('AddSessionNoteModal — session_goals auto-population', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    therapists: [],
    clientId: 'client-1',
  };

  // Configure the supabase mock before each test. The mock pattern matches
  // the one used in SessionModal.test.tsx.  The modal's session-goals query
  // ends with .order(), so buildChain's `order` mock is the terminal method.
  // By default we return an empty session_goals list; individual tests
  // override this where needed.
  beforeEach(() => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') return buildChain([mockProgram]) as any;
      if (table === 'goals') return buildChain([mockGoal]) as any;
      if (table === 'sessions') return buildChainWithLimit([mockSession]) as any;
      if (table === 'session_goals') return buildChain([]) as any;  // empty by default
      return buildChain([]) as any;
    });
  });

  it('pre-selects goals returned by session_goals when a session is linked', async () => {
    // Override session_goals to return goal-1 for the test session.
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') return buildChain([mockProgram]) as any;
      if (table === 'goals') return buildChain([mockGoal]) as any;
      if (table === 'sessions') return buildChainWithLimit([mockSession]) as any;
      if (table === 'session_goals') {
        return buildChain([{ goal_id: 'goal-1', program_id: 'program-1' }]) as any;
      }
      return buildChain([]) as any;
    });

    renderWithProviders(<AddSessionNoteModal {...defaultProps} />);

    // Wait for goals to appear in the UI (programs + goals must both load).
    const goalCheckbox = await screen.findByRole('checkbox', { name: /default goal/i });

    // The checkbox must be pre-checked via the session_goals → goal pre-selection flow.
    await waitFor(() => {
      expect(goalCheckbox).toBeChecked();
    });
  });

  it('does not pre-select goals when session_goals returns an empty list', async () => {
    // Default beforeEach mock returns [] for session_goals.
    renderWithProviders(<AddSessionNoteModal {...defaultProps} />);

    const goalCheckbox = await screen.findByRole('checkbox', { name: /default goal/i });

    // Goal must NOT be pre-checked when there are no session_goals.
    expect(goalCheckbox).not.toBeChecked();
  });

  it('allows the therapist to uncheck an auto-populated goal', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') return buildChain([mockProgram]) as any;
      if (table === 'goals') return buildChain([mockGoal]) as any;
      if (table === 'sessions') return buildChainWithLimit([mockSession]) as any;
      if (table === 'session_goals') {
        return buildChain([{ goal_id: 'goal-1', program_id: 'program-1' }]) as any;
      }
      return buildChain([]) as any;
    });

    renderWithProviders(<AddSessionNoteModal {...defaultProps} />);

    const goalCheckbox = await screen.findByRole('checkbox', { name: /default goal/i });

    // Wait for auto-population.
    await waitFor(() => expect(goalCheckbox).toBeChecked());

    // Therapist manually unchecks the goal.
    fireEvent.click(goalCheckbox);

    // Manual edit overrides auto-population.
    expect(goalCheckbox).not.toBeChecked();
  });

  it('allows the therapist to check a goal that was not auto-populated', async () => {
    // session_goals is empty — no auto-population.
    renderWithProviders(<AddSessionNoteModal {...defaultProps} />);

    const goalCheckbox = await screen.findByRole('checkbox', { name: /default goal/i });
    expect(goalCheckbox).not.toBeChecked();

    fireEvent.click(goalCheckbox);

    expect(goalCheckbox).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// Per-goal note textarea tests
// ---------------------------------------------------------------------------

describe('AddSessionNoteModal — per-goal note textareas', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    therapists: [],
    clientId: 'client-1',
  };

  beforeEach(() => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') return buildChain([mockProgram]) as any;
      if (table === 'goals') return buildChain([mockGoal]) as any;
      if (table === 'sessions') return buildChainWithLimit([mockSession]) as any;
      if (table === 'session_goals') return buildChain([]) as any;
      return buildChain([]) as any;
    });
  });

  it('shows a per-goal note textarea when a goal is checked', async () => {
    renderWithProviders(<AddSessionNoteModal {...defaultProps} />);

    const goalCheckbox = await screen.findByRole('checkbox', { name: /default goal/i });
    expect(screen.queryByLabelText(/note for this goal/i)).not.toBeInTheDocument();

    fireEvent.click(goalCheckbox);

    expect(screen.getByLabelText(/note for this goal/i)).toBeInTheDocument();
  });

  it('removes the per-goal note textarea when a goal is unchecked', async () => {
    renderWithProviders(<AddSessionNoteModal {...defaultProps} />);

    const goalCheckbox = await screen.findByRole('checkbox', { name: /default goal/i });
    fireEvent.click(goalCheckbox);
    expect(screen.getByLabelText(/note for this goal/i)).toBeInTheDocument();

    fireEvent.click(goalCheckbox);

    expect(screen.queryByLabelText(/note for this goal/i)).not.toBeInTheDocument();
  });

  it('accepts text in the per-goal note textarea', async () => {
    renderWithProviders(<AddSessionNoteModal {...defaultProps} />);

    const goalCheckbox = await screen.findByRole('checkbox', { name: /default goal/i });
    fireEvent.click(goalCheckbox);

    const textarea = screen.getByLabelText(/note for this goal/i);
    fireEvent.change(textarea, { target: { value: 'Good progress today.' } });

    expect(textarea).toHaveValue('Good progress today.');
  });

  it('goals are grouped under a program header', async () => {
    renderWithProviders(<AddSessionNoteModal {...defaultProps} />);

    // Program header text appears above the goal list.
    await screen.findByText(/default program/i);
    // Goal checkbox still reachable.
    expect(screen.getByRole('checkbox', { name: /default goal/i })).toBeInTheDocument();
  });

  it('shows measurement snapshot controls when a goal is checked', async () => {
    renderWithProviders(<AddSessionNoteModal {...defaultProps} />);

    const goalCheckbox = await screen.findByRole('checkbox', { name: /default goal/i });
    fireEvent.click(goalCheckbox);

    expect(screen.getByText(/measurement snapshot/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/count \(responses\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/opportunities/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/prompt level/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/measurement note/i)).toBeInTheDocument();
  });

  it('submits normalized goal_measurements when provided', async () => {
    const onSubmit = vi.fn();

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') return buildChain([mockProgram]) as any;
      if (table === 'goals') {
        return buildChain([{ ...mockGoal, measurement_type: 'frequency' }]) as any;
      }
      if (table === 'sessions') return buildChainWithLimit([]) as any;
      if (table === 'session_goals') return buildChain([]) as any;
      return buildChain([]) as any;
    });

    renderWithProviders(
      <AddSessionNoteModal
        {...defaultProps}
        onSubmit={onSubmit}
        therapists={[mockTherapist] as any}
        selectedAuth="auth-1"
      />
    );

    fireEvent.change(await screen.findByLabelText(/therapist/i), {
      target: { value: 'therapist-1' },
    });

    const goalCheckbox = await screen.findByRole('checkbox', { name: /default goal/i });
    fireEvent.click(goalCheckbox);

    fireEvent.change(screen.getByLabelText(/note for this goal/i), {
      target: { value: 'Observed steady progress' },
    });
    fireEvent.change(screen.getByLabelText(/count \(responses\)/i), {
      target: { value: '4' },
    });
    fireEvent.change(screen.getByLabelText(/opportunities/i), {
      target: { value: '5' },
    });
    fireEvent.change(screen.getByLabelText(/prompt level/i), {
      target: { value: 'Gestural' },
    });
    fireEvent.change(screen.getByLabelText(/measurement note/i), {
      target: { value: 'Needed one reminder at the start' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        therapist_id: 'therapist-1',
        goal_notes: {
          'goal-1': 'Observed steady progress',
        },
        goal_measurements: {
          'goal-1': {
            version: 1,
            data: {
              measurement_type: 'frequency',
              metric_label: 'Count',
              metric_unit: 'responses',
              metric_value: 4,
              opportunities: 5,
              prompt_level: 'Gestural',
              note: 'Needed one reminder at the start',
            },
          },
        },
      }));
    });
  });

  it('hydrates existing goal_measurements for editing', async () => {
    renderWithProviders(
      <AddSessionNoteModal
        {...defaultProps}
        therapists={[mockTherapist] as any}
        selectedAuth="auth-1"
        existingNote={{
          id: 'note-1',
          date: '2026-03-31',
          start_time: '09:00:00',
          end_time: '10:00:00',
          service_code: '97153',
          therapist_id: 'therapist-1',
          therapist_name: 'Test Therapist',
          goals_addressed: ['Default Goal'],
          goal_ids: ['goal-1'],
          goal_notes: { 'goal-1': 'Existing goal note' },
          goal_measurements: {
            'goal-1': {
              version: 1,
              data: {
                measurement_type: 'frequency',
                metric_label: 'Count',
                metric_unit: 'responses',
                metric_value: 4,
                opportunities: 5,
                prompt_level: 'Gestural',
                note: 'Existing measurement note',
              },
            },
          },
          session_id: null,
          narrative: 'Existing narrative',
          is_locked: false,
          client_id: 'client-1',
          authorization_id: 'auth-1',
        }}
      />
    );

    expect(await screen.findByDisplayValue('Existing goal note')).toBeInTheDocument();
    expect(screen.getByDisplayValue('4')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Gestural')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Existing measurement note')).toBeInTheDocument();
  });

  it('preserves an unlinked existing note without auto-attaching a session', async () => {
    const onSubmit = vi.fn();

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') return buildChain([mockProgram]) as any;
      if (table === 'goals') return buildChain([mockGoal]) as any;
      if (table === 'sessions') return buildChainWithLimit([mockSession]) as any;
      if (table === 'session_goals') return buildChain([]) as any;
      return buildChain([]) as any;
    });

    renderWithProviders(
      <AddSessionNoteModal
        {...defaultProps}
        onSubmit={onSubmit}
        therapists={[mockTherapist] as any}
        selectedAuth="auth-1"
        existingNote={{
          id: 'note-unlinked',
          date: '2026-03-31',
          start_time: '09:00:00',
          end_time: '10:00:00',
          service_code: '97153',
          therapist_id: 'therapist-1',
          therapist_name: 'Test Therapist',
          goals_addressed: ['Default Goal'],
          goal_ids: ['goal-1'],
          goal_notes: { 'goal-1': 'Existing goal note' },
          goal_measurements: null,
          session_id: null,
          narrative: 'Existing narrative',
          is_locked: false,
          client_id: 'client-1',
          authorization_id: 'auth-1',
        }}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /save note/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        id: 'note-unlinked',
        session_id: null,
      }));
    });
  });

  it('preserves goal note and measurement entries that were stored outside goal_ids', async () => {
    const onSubmit = vi.fn();

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'programs') return buildChain([mockProgram]) as any;
      if (table === 'goals') return buildChain([mockGoal]) as any;
      if (table === 'sessions') return buildChainWithLimit([]) as any;
      if (table === 'session_goals') return buildChain([]) as any;
      return buildChain([]) as any;
    });

    renderWithProviders(
      <AddSessionNoteModal
        {...defaultProps}
        onSubmit={onSubmit}
        therapists={[mockTherapist] as any}
        selectedAuth="auth-1"
        existingNote={{
          id: 'note-misaligned',
          date: '2026-03-31',
          start_time: '09:00:00',
          end_time: '10:00:00',
          service_code: '97153',
          therapist_id: 'therapist-1',
          therapist_name: 'Test Therapist',
          goals_addressed: [],
          goal_ids: [],
          goal_notes: { 'goal-1': 'Legacy stored goal note' },
          goal_measurements: {
            'goal-1': {
              version: 1,
              data: {
                measurement_type: 'frequency',
                metric_label: 'Count',
                metric_unit: 'responses',
                metric_value: 6,
                opportunities: 8,
              },
            },
          },
          session_id: null,
          narrative: 'Existing narrative',
          is_locked: false,
          client_id: 'client-1',
          authorization_id: 'auth-1',
        }}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /save note/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        goal_ids: ['goal-1'],
        goal_notes: {
          'goal-1': 'Legacy stored goal note',
        },
        goal_measurements: {
          'goal-1': expect.objectContaining({
            version: 1,
          }),
        },
      }));
    });
  });
});
