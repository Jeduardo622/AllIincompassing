import { describe, expect, it, vi } from 'vitest';

import { cleanupAssessmentImportArtifacts } from '../../scripts/lib/assessment-import-cleanup';

describe('cleanupAssessmentImportArtifacts', () => {
  const baseArgs = {
    accessToken: 'token',
    baseUrl: 'https://app.allincompassing.ai',
    supabaseAnonKey: 'anon',
    supabaseUrl: 'https://example.supabase.co',
    target: {
      assessmentDocumentId: 'doc-1',
      bucketId: 'client-documents',
      objectPath: 'clients/client-1/assessments/fba.pdf',
    },
  } as const;

  it('deletes the assessment document row first, then removes the storage object', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await cleanupAssessmentImportArtifacts({ ...baseArgs, fetchImpl });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://app.allincompassing.ai/api/assessment-documents?assessment_document_id=doc-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://example.supabase.co/storage/v1/object/client-documents/clients/client-1/assessments/fba.pdf',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('continues when the storage object is already gone', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response('not found', { status: 404 }));

    await expect(cleanupAssessmentImportArtifacts({ ...baseArgs, fetchImpl })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails and leaves storage untouched when DB cleanup cannot complete', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('delete failed', { status: 500 }))
      .mockResolvedValueOnce(new Response('delete failed', { status: 500 }))
      .mockResolvedValueOnce(new Response('delete failed', { status: 500 }));

    await expect(cleanupAssessmentImportArtifacts({ ...baseArgs, fetchImpl })).rejects.toThrow(
      'Cleanup failed for doc-1: 500 delete failed',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries storage cleanup and then fails if the blob still cannot be removed', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));

    await expect(cleanupAssessmentImportArtifacts({ ...baseArgs, fetchImpl })).rejects.toThrow(
      'Storage cleanup failed for client-documents/clients/client-1/assessments/fba.pdf: 500 boom',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
