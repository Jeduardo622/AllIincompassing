import { describe, expect, it } from 'vitest';

import {
  assertPersistedAssessmentEvidence,
  REQUIRED_CALOPTIMA_STRUCTURED_KEYS,
} from '../../scripts/playwright-assessment-import-smoke';

const completeEvidence = {
  checklistCount: 54,
  extractedChecklistCount: 42,
  extractionCount: 54,
  extractedExtractionCount: 42,
  structuredSectionCount: 64,
  structuredFieldKeys: [...REQUIRED_CALOPTIMA_STRUCTURED_KEYS],
  draftProgramCount: 3,
  draftGoalCount: 50,
};

describe('assessment import smoke persisted evidence', () => {
  it('rejects seeded-only upload rows without extracted statuses', () => {
    expect(() =>
      assertPersistedAssessmentEvidence({
        ...completeEvidence,
        extractedChecklistCount: 0,
        extractedExtractionCount: 0,
        structuredSectionCount: 0,
        draftProgramCount: 0,
        draftGoalCount: 0,
      }),
    ).toThrow(/did not populate extracted checklist and extraction row statuses/i);
  });

  it('rejects completed rows when required CalOptima structured keys are missing', () => {
    expect(() =>
      assertPersistedAssessmentEvidence({
        ...completeEvidence,
        structuredFieldKeys: ['CALOPTIMA_FBA_SKILL_ACQUISITION_GOALS'],
      }),
    ).toThrow(/missing structured field keys/i);
  });

  it('accepts completed metadata-only evidence', () => {
    expect(() => assertPersistedAssessmentEvidence(completeEvidence)).not.toThrow();
  });
});
