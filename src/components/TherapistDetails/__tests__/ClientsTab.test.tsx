import { describe, expect, it } from 'vitest';
import { getMissingClientIds, isAlreadyLinkedToTherapist } from '../ClientsTab';

describe('Therapist client linking helpers', () => {
  it('keeps previously linked therapist assignments when adding another link', () => {
    const missingIds = getMissingClientIds(
      ['client-direct'],
      ['client-direct', 'client-linked-existing'],
      ['client-linked-existing', 'client-from-session'],
    );

    expect(missingIds).toEqual(['client-linked-existing', 'client-from-session']);
  });

  it('treats bridge-table and primary therapist links as linked', () => {
    const linkedViaBridge = isAlreadyLinkedToTherapist(
      {
        id: 'client-1',
        full_name: 'Client One',
        email: null,
        primary_therapist_id: null,
        primary_therapist_name: null,
        linked_therapist_ids: ['therapist-1'],
        linked_therapist_names: ['Therapist One'],
      },
      'therapist-1',
    );

    const linkedViaPrimary = isAlreadyLinkedToTherapist(
      {
        id: 'client-2',
        full_name: 'Client Two',
        email: null,
        primary_therapist_id: 'therapist-2',
        primary_therapist_name: 'Therapist Two',
        linked_therapist_ids: [],
        linked_therapist_names: [],
      },
      'therapist-2',
    );

    expect(linkedViaBridge).toBe(true);
    expect(linkedViaPrimary).toBe(true);
  });
});
