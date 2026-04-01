import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { SessionNotesTab } from '../ClientDetails/SessionNotesTab';
import { fetchClientSessionNotes } from '../../lib/session-notes';
import type { SessionNote } from '../../types';

// ---------------------------------------------------------------------------
// Module mock — override fetchClientSessionNotes only; keep everything else
// from the real module (isSupabaseError, createClientSessionNote, etc.).
// ---------------------------------------------------------------------------

vi.mock('../../lib/session-notes', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/session-notes')>();
  return { ...mod, fetchClientSessionNotes: vi.fn() };
});

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CLIENT = { id: 'client-1' };

/** Note written before goal_notes existed — goal_notes is null. */
const legacyNote: SessionNote = {
  id: 'note-legacy',
  date: '2026-03-01',
  start_time: '10:00',
  end_time: '11:00',
  service_code: 'H2019',
  therapist_name: 'Dr. Smith',
  goals_addressed: ['Reduce tantrum frequency', 'Improve communication'],
  goal_ids: ['goal-uuid-aaaa', 'goal-uuid-bbbb'],
  goal_notes: null,
  narrative: 'Client showed good progress during the session.',
  is_locked: false,
  client_id: 'client-1',
};

/** Note written after Slice 2 — goal_notes has an entry per goal_id. */
const noteWithGoalNotes: SessionNote = {
  id: 'note-new',
  date: '2026-03-15',
  start_time: '14:00',
  end_time: '15:00',
  service_code: 'H2019',
  therapist_name: 'Dr. Jones',
  goals_addressed: ['Eye contact goal', 'Following instructions'],
  goal_ids: ['goal-aa11-1234', 'goal-bb22-5678'],
  goal_notes: {
    'goal-aa11-1234': 'Demonstrated improved eye contact across 3 trials.',
    'goal-bb22-5678': 'Followed 2-step instructions with 80% accuracy.',
  },
  narrative: '',
  is_locked: false,
  client_id: 'client-1',
};

/** Note where goal_ids.length (2) !== goals_addressed.length (1) — label fallback. */
const noteWithMismatchedLengths: SessionNote = {
  id: 'note-mismatch',
  date: '2026-03-20',
  start_time: '09:00',
  end_time: '10:00',
  service_code: 'H2019',
  therapist_name: 'Dr. Adams',
  // Only one goals_addressed label but two goal_ids — forces UUID fallback.
  goals_addressed: ['Only one label'],
  goal_ids: ['goal-cc33-abcd', 'goal-dd44-efgh'],
  goal_notes: {
    'goal-cc33-abcd': 'Note for cc33 goal.',
    'goal-dd44-efgh': 'Note for dd44 goal.',
  },
  narrative: '',
  is_locked: false,
  client_id: 'client-1',
};

// ---------------------------------------------------------------------------
// Auth options shared across all tests — guarantees a non-null organizationId
// so the React Query `enabled` conditions are satisfied.
// ---------------------------------------------------------------------------

const AUTH_OPTS = { auth: { organizationId: 'org-test-id' } } as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionNotesTab — goal notes display', () => {
  beforeEach(() => {
    // Default: empty note list so each test can override explicitly.
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // 1. Legacy notes (null goal_notes) → chips-only display
  // -------------------------------------------------------------------------

  it('renders goals_addressed chips for legacy notes that have no goal_notes', async () => {
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([legacyNote]);

    renderWithProviders(<SessionNotesTab client={CLIENT} />, AUTH_OPTS);

    await waitFor(() => {
      expect(screen.getByText('Reduce tantrum frequency')).toBeInTheDocument();
      expect(screen.getByText('Improve communication')).toBeInTheDocument();
    });

    // Chips are plain <span> elements, not interactive buttons.
    expect(
      screen.queryByRole('button', { name: /reduce tantrum frequency/i }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /improve communication/i }),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. Notes with goal_notes → expandable rows; note text initially hidden
  // -------------------------------------------------------------------------

  it('renders per-goal expandable rows and hides note text when collapsed', async () => {
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([noteWithGoalNotes]);

    renderWithProviders(<SessionNotesTab client={CLIENT} />, AUTH_OPTS);

    // Goal labels should be rendered as interactive buttons.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /eye contact goal/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /following instructions/i }),
      ).toBeInTheDocument();
    });

    // Note text must be hidden in the collapsed state.
    expect(
      screen.queryByText(/demonstrated improved eye contact across 3 trials/i),
    ).toBeNull();
    expect(
      screen.queryByText(/followed 2-step instructions with 80% accuracy/i),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 3. Click expands a row to reveal its stored note text
  // -------------------------------------------------------------------------

  it('expands a goal row to reveal its note text when clicked', async () => {
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([noteWithGoalNotes]);

    renderWithProviders(<SessionNotesTab client={CLIENT} />, AUTH_OPTS);

    const entryButton = await screen.findByRole('button', { name: /eye contact goal/i });

    // Collapsed: aria-expanded is false.
    expect(entryButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(entryButton);

    // After clicking: aria-expanded is true and note text is visible.
    expect(entryButton).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => {
      expect(
        screen.getByText(/demonstrated improved eye contact across 3 trials/i),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Truncated UUID fallback when goal_ids/goals_addressed lengths differ
  // -------------------------------------------------------------------------

  it('uses truncated UUID as label when goal_ids and goals_addressed have different lengths', async () => {
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([noteWithMismatchedLengths]);

    renderWithProviders(<SessionNotesTab client={CLIENT} />, AUTH_OPTS);

    // Slice pattern: goalId.slice(0, 8) + '…'
    // 'goal-cc33-abcd'.slice(0, 8) = 'goal-cc3'  → label = 'Goal goal-cc3…'
    // 'goal-dd44-efgh'.slice(0, 8) = 'goal-dd4'  → label = 'Goal goal-dd4…'
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /goal goal-cc3/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /goal goal-dd4/i }),
      ).toBeInTheDocument();
    });

    // The single goals_addressed label should NOT appear as a button.
    expect(
      screen.queryByRole('button', { name: /only one label/i }),
    ).toBeNull();
  });
});
