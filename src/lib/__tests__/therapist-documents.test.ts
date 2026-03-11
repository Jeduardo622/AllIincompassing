import { describe, expect, it, vi } from 'vitest';
import {
  reconcileTherapistDocumentPathSets,
  uploadTherapistDocumentAndRecordManifest,
} from '../therapist-documents';

const buildSupabaseMock = () => {
  const upload = vi.fn();
  const remove = vi.fn();
  const insert = vi.fn();

  const supabase = {
    storage: {
      from: vi.fn(() => ({ upload, remove })),
    },
    from: vi.fn(() => ({ insert })),
  };

  return { supabase, upload, remove, insert };
};

describe('uploadTherapistDocumentAndRecordManifest', () => {
  it('uploads to storage then inserts a manifest row', async () => {
    const { supabase, upload, insert } = buildSupabaseMock();
    upload.mockResolvedValue({ error: null });
    insert.mockResolvedValue({ error: null });

    const file = new File(['hello'], 'license.pdf', { type: 'application/pdf' });
    const result = await uploadTherapistDocumentAndRecordManifest({
      supabase,
      therapistId: 'therapist-1',
      organizationId: 'org-1',
      documentKey: 'license',
      file,
    });

    expect(supabase.storage.from).toHaveBeenCalledWith('therapist-documents');
    expect(upload).toHaveBeenCalledWith('therapists/therapist-1/license/license.pdf', file);
    expect(supabase.from).toHaveBeenCalledWith('therapist_documents');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        therapist_id: 'therapist-1',
        organization_id: 'org-1',
        document_key: 'license',
        bucket_id: 'therapist-documents',
        object_path: 'therapists/therapist-1/license/license.pdf',
      }),
    );
    expect(result.objectPath).toBe('therapists/therapist-1/license/license.pdf');
  });

  it('throws when storage upload fails', async () => {
    const { supabase, upload, insert } = buildSupabaseMock();
    const uploadError = new Error('upload failed');
    upload.mockResolvedValue({ error: uploadError });
    insert.mockResolvedValue({ error: null });

    const file = new File(['hello'], 'license.pdf', { type: 'application/pdf' });
    await expect(
      uploadTherapistDocumentAndRecordManifest({
        supabase,
        therapistId: 'therapist-1',
        organizationId: 'org-1',
        documentKey: 'license',
        file,
      }),
    ).rejects.toBe(uploadError);
  });

  it('throws when manifest insert fails', async () => {
    const { supabase, upload, remove, insert } = buildSupabaseMock();
    const insertError = new Error('insert failed');
    upload.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
    insert.mockResolvedValue({ error: insertError });

    const file = new File(['hello'], 'license.pdf', { type: 'application/pdf' });
    await expect(
      uploadTherapistDocumentAndRecordManifest({
        supabase,
        therapistId: 'therapist-1',
        organizationId: 'org-1',
        documentKey: 'license',
        file,
      }),
    ).rejects.toBe(insertError);
    expect(remove).toHaveBeenCalledWith(['therapists/therapist-1/license/license.pdf']);
  });

  it('detects orphaned storage and manifest paths', () => {
    expect(
      reconcileTherapistDocumentPathSets({
        storagePaths: [
          'therapists/therapist-1/license/license.pdf',
          'therapists/therapist-1/license/extra.pdf',
        ],
        manifestPaths: [
          'therapists/therapist-1/license/license.pdf',
          'therapists/therapist-1/resume/resume.pdf',
        ],
      }),
    ).toEqual({
      orphanStoragePaths: ['therapists/therapist-1/license/extra.pdf'],
      orphanManifestPaths: ['therapists/therapist-1/resume/resume.pdf'],
    });
  });
});

