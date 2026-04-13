import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { SessionNotesTab } from '../ClientDetails/SessionNotesTab';
import type { SessionNoteFormValues } from '../AddSessionNoteModal';
import type { SessionNote } from '../../types';

const { updateClientSessionNote } = vi.hoisted(() => ({
  updateClientSessionNote: vi.fn(),
}));

vi.mock('../AddSessionNoteModal', () => ({
  AddSessionNoteModal: (props: {
    isOpen: boolean;
    existingNote: SessionNote | null | undefined;
    onSubmit: (values: SessionNoteFormValues) => void;
  }) => {
    if (!props.isOpen || !props.existingNote) {
      return null;
    }
    return (
      <button
        type="button"
        data-testid="stub-session-note-submit"
        onClick={() =>
          props.onSubmit({
            id: props.existingNote.id,
            date: props.existingNote.date,
            start_time: props.existingNote.start_time,
            end_time: props.existingNote.end_time,
            service_code: props.existingNote.service_code,
            therapist_id: props.existingNote.therapist_id ?? 'therapist-1',
            therapist_name: props.existingNote.therapist_name,
            goals_addressed: props.existingNote.goals_addressed,
            goal_ids: props.existingNote.goal_ids ?? [],
            goal_notes: props.existingNote.goal_notes ?? { 'goal-aa11-1234': 'updated note text' },
            goal_measurements: {
              'goal-aa11-1234': {
                version: 1 as const,
                data: { metric_value: 99, opportunities: 10, metric_label: 'Count', metric_unit: null },
              },
            },
            session_id: props.existingNote.session_id ?? null,
            narrative: props.existingNote.narrative,
            is_locked: props.existingNote.is_locked,
          })
        }
      >
        Stub save measurement edit
      </button>
    );
  },
}));

vi.mock('../../lib/session-notes', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/session-notes')>();
  return {
    ...mod,
    fetchClientSessionNotes: vi.fn(),
    updateClientSessionNote,
  };
});

import { fetchClientSessionNotes } from '../../lib/session-notes';

const CLIENT = { id: 'client-1' };

const noteForEdit: SessionNote = {
  id: 'note-edit-meas',
  date: '2026-03-15',
  start_time: '14:00',
  end_time: '15:00',
  service_code: 'H2019',
  therapist_id: 'therapist-1',
  therapist_name: 'Dr. Jones',
  goals_addressed: ['Eye contact goal'],
  goal_ids: ['goal-aa11-1234'],
  goal_notes: {
    'goal-aa11-1234': 'Original text',
  },
  goal_measurements: {
    'goal-aa11-1234': {
      version: 1,
      data: {
        metric_value: 4,
        opportunities: 5,
        metric_label: 'Count',
        metric_unit: null,
      },
    },
  },
  narrative: '',
  is_locked: false,
  client_id: 'client-1',
  authorization_id: 'auth-uuid-1111',
  session_id: 'session-uuid-2222',
};

const AUTH_OPTS = { auth: { organizationId: 'org-test-id', userId: 'user-1' } } as const;

describe('SessionNotesTab — edit mutation sends goal_measurements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchClientSessionNotes).mockResolvedValue([noteForEdit]);
    updateClientSessionNote.mockResolvedValue({
      ...noteForEdit,
      goal_measurements: {
        'goal-aa11-1234': {
          version: 1,
          data: { metric_value: 99, opportunities: 10, metric_label: 'Count', metric_unit: null },
        },
      },
    });
  });

  it('routes edit saves through updateClientSessionNote with goal_measurements payload', async () => {
    renderWithProviders(<SessionNotesTab client={CLIENT} />, AUTH_OPTS);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Edit$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('stub-session-note-submit')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('stub-session-note-submit'));

    await waitFor(() => {
      expect(updateClientSessionNote).toHaveBeenCalledTimes(1);
    });

    const call = updateClientSessionNote.mock.calls[0][0];
    expect(call.goalMeasurements).toEqual({
      'goal-aa11-1234': {
        version: 1,
        data: {
          metric_value: 99,
          opportunities: 10,
          metric_label: 'Count',
          metric_unit: null,
        },
      },
    });
    expect(call.noteId).toBe('note-edit-meas');
  });
});
