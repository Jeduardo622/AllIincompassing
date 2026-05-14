export type AssessmentImportCleanupTarget = {
  assessmentDocumentId: string;
  bucketId: string;
  objectPath?: string | null;
};

type CleanupArgs = {
  accessToken: string;
  baseUrl: string;
  supabaseAnonKey: string;
  supabaseUrl: string;
  target: AssessmentImportCleanupTarget;
  fetchImpl?: typeof fetch;
};

const pause = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const withRetry = async (operation: () => Promise<void>, attempts = 3): Promise<void> => {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) {
        await pause(500 * (index + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const deleteAssessmentDocument = async (
  fetchImpl: typeof fetch,
  baseUrl: string,
  accessToken: string,
  assessmentDocumentId: string,
): Promise<void> => {
  const response = await fetchImpl(
    `${baseUrl}/api/assessment-documents?assessment_document_id=${encodeURIComponent(assessmentDocumentId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cleanup failed for ${assessmentDocumentId}: ${response.status} ${body}`);
  }
};

export const deleteAssessmentStorageObject = async (
  fetchImpl: typeof fetch,
  args: {
    supabaseUrl: string;
    supabaseAnonKey: string;
    accessToken: string;
    bucketId: string;
    objectPath: string;
  },
): Promise<void> => {
  const { supabaseUrl, supabaseAnonKey, accessToken, bucketId, objectPath } = args;
  const encodedPath = objectPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const response = await fetchImpl(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucketId)}/${encodedPath}`, {
    method: 'DELETE',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.ok || response.status === 404) {
    return;
  }

  const body = await response.text().catch(() => response.statusText);
  if (response.status === 400 && /"statusCode"\s*:\s*"404"|"error"\s*:\s*"not_found"/i.test(body)) {
    return;
  }
  throw new Error(`Storage cleanup failed for ${bucketId}/${objectPath}: ${response.status} ${body}`);
};

export const cleanupAssessmentImportArtifacts = async (args: CleanupArgs): Promise<void> => {
  const fetchImpl = args.fetchImpl ?? fetch;
  await withRetry(
    () => deleteAssessmentDocument(fetchImpl, args.baseUrl, args.accessToken, args.target.assessmentDocumentId),
    3,
  );

  const objectPath = args.target.objectPath?.trim();
  if (!objectPath) {
    return;
  }

  await withRetry(
    () =>
      deleteAssessmentStorageObject(fetchImpl, {
        supabaseUrl: args.supabaseUrl,
        supabaseAnonKey: args.supabaseAnonKey,
        accessToken: args.accessToken,
        bucketId: args.target.bucketId,
        objectPath,
      }),
    3,
  );
};
