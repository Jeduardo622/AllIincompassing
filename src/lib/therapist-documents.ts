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
  remove?: (
    paths: string[],
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

export interface TherapistDocumentReconciliationInput {
  manifestPaths: string[];
  storagePaths: string[];
}

export interface TherapistDocumentReconciliationResult {
  orphanStoragePaths: string[];
  orphanManifestPaths: string[];
}

const normalizePath = (path: string): string => path.trim();

export const reconcileTherapistDocumentPathSets = ({
  manifestPaths,
  storagePaths,
}: TherapistDocumentReconciliationInput): TherapistDocumentReconciliationResult => {
  const manifestSet = new Set(manifestPaths.map(normalizePath).filter((path) => path.length > 0));
  const storageSet = new Set(storagePaths.map(normalizePath).filter((path) => path.length > 0));

  return {
    orphanStoragePaths: Array.from(storageSet).filter((path) => !manifestSet.has(path)),
    orphanManifestPaths: Array.from(manifestSet).filter((path) => !storageSet.has(path)),
  };
};

export async function uploadTherapistDocumentAndRecordManifest({
  supabase,
  therapistId,
  organizationId,
  documentKey,
  file,
  bucketId = 'therapist-documents',
}: UploadTherapistDocumentParams): Promise<TherapistDocumentUploadResult> {
  const sanitizedFileName = file.name.replace(/[\\/]+/g, "_");
  const objectPath = `therapists/${therapistId}/${documentKey}/${sanitizedFileName}`;
  const bucket = supabase.storage.from(bucketId);

  const { error: uploadError } = await bucket.upload(objectPath, file);
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
    const { error: cleanupError } = await bucket.remove?.([objectPath]) ?? { error: null };
    if (cleanupError) {
      console.error("Failed to cleanup therapist document after manifest insert failure", {
        bucketId,
        objectPath,
        cleanupError,
      });
    }
    throw manifestError;
  }

  return { bucketId, objectPath, documentKey: String(documentKey) };
}

