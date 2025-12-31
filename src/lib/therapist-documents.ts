export type TherapistDocumentUploadKey =
  | 'license'
  | 'resume'
  | 'background_check'
  | 'certifications'
  | string;

export interface TherapistDocumentUploadResult {
  bucketId: string;
  objectPath: string;
  documentKey: string;
}

interface StorageBucketClient {
  upload: (
    path: string,
    file: File,
  ) => Promise<{ error: unknown | null | undefined }>;
}

interface StorageClient {
  from: (bucketId: string) => StorageBucketClient;
}

interface TableInsertClient {
  insert: (values: Record<string, unknown>) => Promise<{ error: unknown | null | undefined }>;
}

interface SupabaseLikeClient {
  storage: StorageClient;
  from: (table: string) => TableInsertClient;
}

export interface UploadTherapistDocumentParams {
  supabase: SupabaseLikeClient;
  therapistId: string;
  organizationId: string;
  documentKey: TherapistDocumentUploadKey;
  file: File;
  bucketId?: string;
}

export async function uploadTherapistDocumentAndRecordManifest({
  supabase,
  therapistId,
  organizationId,
  documentKey,
  file,
  bucketId = 'therapist-documents',
}: UploadTherapistDocumentParams): Promise<TherapistDocumentUploadResult> {
  const objectPath = `therapists/${therapistId}/${documentKey}/${file.name}`;

  const { error: uploadError } = await supabase.storage.from(bucketId).upload(objectPath, file);
  if (uploadError) {
    throw uploadError;
  }

  const { error: manifestError } = await supabase.from('therapist_documents').insert({
    therapist_id: therapistId,
    organization_id: organizationId,
    document_key: documentKey,
    bucket_id: bucketId,
    object_path: objectPath,
  });

  if (manifestError) {
    throw manifestError;
  }

  return { bucketId, objectPath, documentKey: String(documentKey) };
}

