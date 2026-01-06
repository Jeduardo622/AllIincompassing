import { describe, expect, it } from 'vitest';

import { getFillDocsDownloadPlan } from '../result';

describe('fillDocs result helpers', () => {
  it('prefers signed URL when present', () => {
    const plan = getFillDocsDownloadPlan({
      success: true,
      template: 'ER',
      filename: 'test.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      downloadUrl: 'https://example.com/signed',
    });

    expect(plan.kind).toBe('signed-url');
    if (plan.kind === 'signed-url') {
      expect(plan.url).toBe('https://example.com/signed');
      expect(plan.filename).toBe('test.docx');
    }
  });

  it('falls back to base64 payload', () => {
    const plan = getFillDocsDownloadPlan({
      success: true,
      template: 'PR',
      filename: 'test.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      base64: 'AA==',
    });

    expect(plan.kind).toBe('base64');
    if (plan.kind === 'base64') {
      expect(plan.base64).toBe('AA==');
      expect(plan.filename).toBe('test.docx');
    }
  });
});

