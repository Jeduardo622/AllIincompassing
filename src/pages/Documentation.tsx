import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Search } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import { supabase } from '../lib/supabase';
import { aiDocumentation } from '../lib/ai-documentation';
import { showError, showSuccess } from '../lib/toast';
import { logger } from '../lib/logger/logger';
import { toError } from '../lib/logger/normalizeError';

type DocumentSource =
  | 'therapist_document'
  | 'client_document'
  | 'authorization_document'
  | 'ai_session_note';

interface StoredDocumentMetadata {
  name: string;
  path: string;
  size?: number | null;
  type?: string | null;
}

interface DocumentEntry {
  id: string;
  title: string;
  description: string;
  createdAt?: string | null;
  size?: number | null;
  fileType?: string | null;
  source: DocumentSource;
  bucketId?: string;
  objectPath?: string;
  sessionNoteId?: string;
}

interface DocumentationData {
  therapistDocuments: DocumentEntry[];
  clientDocuments: DocumentEntry[];
  authorizationDocuments: DocumentEntry[];
  aiSessionNotes: DocumentEntry[];
}

const emptyDocumentationData = (): DocumentationData => ({
  therapistDocuments: [],
  clientDocuments: [],
  authorizationDocuments: [],
  aiSessionNotes: [],
});

const parseDocumentArray = (value: unknown): StoredDocumentMetadata[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : 'Untitled document',
      path: typeof item.path === 'string' ? item.path : '',
      size: typeof item.size === 'number' ? item.size : null,
      type: typeof item.type === 'string' ? item.type : null,
    }))
    .filter((item) => item.path.length > 0);
};

const formatFileSize = (size?: number | null) => {
  if (size === null || size === undefined || Number.isNaN(size)) {
    return 'Size unknown';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (value?: string | null) => {
  if (!value) {
    return 'Date unknown';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Date unknown';
  }

  return parsed.toLocaleDateString();
};

const matchesSearch = (entry: DocumentEntry, query: string) => {
  if (!query) {
    return true;
  }

  const normalized = query.toLowerCase();
  const normalizedSource = entry.source.replace(/_/g, ' ');
  return [
    entry.title,
    entry.description,
    entry.fileType ?? '',
    normalizedSource,
  ].some((value) => value.toLowerCase().includes(normalized));
};

const buildSectionEmptyMessage = (baseMessage: string, query: string, hasDocuments: boolean) => {
  return query && hasDocuments ? 'No documents in this section match your search.' : baseMessage;
};

const buildTherapistDocumentTitle = (objectPath: string, documentKey: string) => {
  const filename = objectPath.split('/').pop() ?? objectPath;
  return documentKey ? `${documentKey.replace(/_/g, ' ')} • ${filename}` : filename;
};

const mapClientRowsToDocuments = (
  rows: ReadonlyArray<{
    id: string;
    full_name: string | null;
    created_at: string | null;
    documents: unknown;
  }>,
): DocumentEntry[] =>
  rows.flatMap((client) =>
    parseDocumentArray(client.documents).map((doc) => ({
      id: `${client.id}-${doc.path}`,
      title: doc.name,
      description: client.full_name ? `Client: ${client.full_name}` : `Client ID: ${client.id}`,
      createdAt: client.created_at,
      size: doc.size ?? null,
      fileType: doc.type ?? null,
      source: 'client_document' as const,
      bucketId: 'client-documents',
      objectPath: doc.path,
    })),
  );

/** Client / guardian portal: only client-record documents (RLS-scoped); avoids staff-only parallel queries. */
const fetchDocumentationDataForClientRole = async (
  userId: string,
  fallbackEmail?: string | null,
): Promise<DocumentationData> => {
  const clientResult = await supabase
    .from('clients')
    .select('id, full_name, created_at, documents, created_by, email')
    .eq('created_by', userId)
    .order('created_at', { ascending: false });

  if (clientResult.error) {
    throw clientResult.error instanceof Error
      ? clientResult.error
      : new Error('Failed to load documentation data');
  }

  const clientDocuments = mapClientRowsToDocuments(clientResult.data ?? []);

  if ((!clientDocuments.length || !clientResult.data?.length) && fallbackEmail) {
    const clientEmailResult = await supabase
      .from('clients')
      .select('id, full_name, created_at, documents, email')
      .eq('email', fallbackEmail)
      .order('created_at', { ascending: false })
      .limit(1);
    if (!clientEmailResult.error && Array.isArray(clientEmailResult.data)) {
      clientDocuments.push(...mapClientRowsToDocuments(clientEmailResult.data));
    }
  }

  return {
    ...emptyDocumentationData(),
    clientDocuments,
  };
};

/** Therapist / admin documentation: parallel staff-scoped sources. */
const fetchDocumentationDataForStaffRoles = async (
  userId: string,
  fallbackEmail?: string | null,
): Promise<DocumentationData> => {
  const [therapistResult, notesResult, clientResult, authorizationResult] = await Promise.all([
    supabase
      .from('therapist_documents')
      .select('id, document_key, bucket_id, object_path, created_at')
      .eq('therapist_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('ai_session_notes')
      .select('id, session_date, client_id, therapist_id, created_at, signed_at, ai_confidence_score')
      .eq('therapist_id', userId)
      .order('session_date', { ascending: false }),
    supabase
      .from('clients')
      .select('id, full_name, created_at, documents, created_by, email')
      .eq('created_by', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('authorizations')
      .select('id, authorization_number, created_at, documents, created_by')
      .eq('created_by', userId)
      .order('created_at', { ascending: false }),
  ]);

  const errors = [therapistResult.error, notesResult.error, clientResult.error, authorizationResult.error].filter(
    Boolean,
  );
  if (errors.length > 0) {
    const error = errors[0];
    throw error instanceof Error ? error : new Error('Failed to load documentation data');
  }

  const therapistDocuments = (therapistResult.data ?? []).map((row) => ({
    id: row.id,
    title: buildTherapistDocumentTitle(row.object_path, row.document_key ?? ''),
    description: 'Uploaded therapist documentation',
    createdAt: row.created_at,
    source: 'therapist_document' as const,
    bucketId: row.bucket_id,
    objectPath: row.object_path,
  }));

  const aiSessionNotes = (notesResult.data ?? []).map((note) => ({
    id: note.id,
    title: `Session note • ${formatDate(note.session_date)}`,
    description: `Client ID: ${note.client_id}`,
    createdAt: note.created_at,
    source: 'ai_session_note' as const,
    sessionNoteId: note.id,
  }));

  const clientDocuments = mapClientRowsToDocuments(clientResult.data ?? []);

  const authorizationDocuments = (authorizationResult.data ?? []).flatMap((authorization) =>
    parseDocumentArray(authorization.documents).map((doc) => ({
      id: `${authorization.id}-${doc.path}`,
      title: doc.name,
      description: authorization.authorization_number
        ? `Authorization ${authorization.authorization_number}`
        : `Authorization ID: ${authorization.id}`,
      createdAt: authorization.created_at,
      size: doc.size ?? null,
      fileType: doc.type ?? null,
      source: 'authorization_document' as const,
      bucketId: 'client-documents',
      objectPath: doc.path,
    })),
  );

  if ((!clientDocuments.length || !clientResult.data?.length) && fallbackEmail) {
    const clientEmailResult = await supabase
      .from('clients')
      .select('id, full_name, created_at, documents, email')
      .eq('email', fallbackEmail)
      .order('created_at', { ascending: false })
      .limit(1);
    if (!clientEmailResult.error && Array.isArray(clientEmailResult.data)) {
      clientDocuments.push(...mapClientRowsToDocuments(clientEmailResult.data));
    }
  }

  return {
    therapistDocuments,
    clientDocuments,
    authorizationDocuments,
    aiSessionNotes,
  };
};

export function Documentation() {
  const { user, profile, profileLoading, isGuardian } = useAuth();
  const [search, setSearch] = useState('');
  const [activeDownloadId, setActiveDownloadId] = useState<string | null>(null);

  const isClientDocumentationMode = profile?.role === 'client' && !isGuardian;
  const documentationFetchMode = isClientDocumentationMode ? 'client' : 'staff';

  const { data, isLoading, error } = useQuery({
    queryKey: ['documentation', user?.id, documentationFetchMode],
    enabled: Boolean(user?.id) && !profileLoading,
    queryFn: () =>
      isClientDocumentationMode
        ? fetchDocumentationDataForClientRole(user?.id ?? '', profile?.email ?? null)
        : fetchDocumentationDataForStaffRoles(user?.id ?? '', profile?.email ?? null),
  });

  const sections = useMemo(() => {
    const query = search.trim();
    const aiSessionNotes = data?.aiSessionNotes ?? [];
    const therapistDocuments = data?.therapistDocuments ?? [];
    const clientDocuments = data?.clientDocuments ?? [];
    const authorizationDocuments = data?.authorizationDocuments ?? [];
    const allSections = [
      {
        id: 'ai-session-notes',
        title: 'AI Session Notes',
        description: 'AI-generated documentation linked to your sessions.',
        documents: aiSessionNotes.filter((entry) => matchesSearch(entry, query)),
        emptyMessage: buildSectionEmptyMessage('No AI session notes yet.', query, aiSessionNotes.length > 0),
        clientPortal: false,
      },
      {
        id: 'therapist-uploads',
        title: 'Therapist Uploads',
        description: 'Licenses, resumes, certifications, and generated templates.',
        documents: therapistDocuments.filter((entry) => matchesSearch(entry, query)),
        emptyMessage: buildSectionEmptyMessage(
          'No therapist documents found.',
          query,
          therapistDocuments.length > 0,
        ),
        clientPortal: false,
      },
      {
        id: 'client-uploads',
        title: 'Client Uploads',
        description: 'Documents you uploaded during client onboarding.',
        documents: clientDocuments.filter((entry) => matchesSearch(entry, query)),
        emptyMessage: buildSectionEmptyMessage('No client documents found.', query, clientDocuments.length > 0),
        clientPortal: true,
      },
      {
        id: 'authorization-uploads',
        title: 'Authorization Uploads',
        description: 'Pre-authorization documentation you uploaded.',
        documents: authorizationDocuments.filter((entry) => matchesSearch(entry, query)),
        emptyMessage: buildSectionEmptyMessage(
          'No authorization documents found.',
          query,
          authorizationDocuments.length > 0,
        ),
        clientPortal: false,
      },
    ];

    if (isClientDocumentationMode) {
      return allSections.filter((s) => s.clientPortal);
    }
    return allSections;
  }, [data, search, isClientDocumentationMode]);

  const handleDownload = async (entry: DocumentEntry) => {
    if (activeDownloadId) {
      return;
    }

    setActiveDownloadId(entry.id);
    try {
      if (entry.source === 'ai_session_note' && entry.sessionNoteId) {
        const payload = await aiDocumentation.exportSessionNoteForInsurance(entry.sessionNoteId);
        const blob = new Blob([payload], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `session-note-${entry.sessionNoteId}.txt`;
        anchor.click();
        URL.revokeObjectURL(url);
        showSuccess('Session note export ready.');
        return;
      }

      if (!entry.bucketId || !entry.objectPath) {
        throw new Error('Document download metadata missing.');
      }

      const { data: signed, error: signedError } = await supabase.storage
        .from(entry.bucketId)
        .createSignedUrl(entry.objectPath, 60);

      if (signedError || !signed?.signedUrl) {
        throw signedError ?? new Error('Unable to generate a download link.');
      }

      window.open(signed.signedUrl, '_blank', 'noopener,noreferrer');
      showSuccess('Download link generated.');
    } catch (downloadError) {
      logger.error('Documentation download failed', {
        error: toError(downloadError, 'Documentation download failed'),
        context: { component: 'Documentation', operation: 'handleDownload', documentId: entry.id },
      });
      showError(downloadError instanceof Error ? downloadError : 'Unable to download document.');
    } finally {
      setActiveDownloadId(null);
    }
  };

  if (error) {
    logger.error('Failed to load documentation', {
      error: toError(error, 'Failed to load documentation'),
      context: { component: 'Documentation', operation: 'fetchDocumentationData' },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Documentation</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {isClientDocumentationMode
              ? 'Documents from your onboarding and care profile.'
              : 'All documents you have uploaded or generated, organized by category.'}
          </p>
        </div>
        <div className="w-full lg:max-w-sm">
          <label htmlFor="documentation-search" className="sr-only">
            Search documentation
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input
              id="documentation-search"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search documentation..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-gray-200"
            />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <span className="font-medium text-gray-900 dark:text-gray-100">Jump to:</span>
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="rounded-full border border-gray-200 dark:border-gray-700 px-3 py-1 hover:border-blue-500 hover:text-blue-600 transition-colors"
            >
              {section.title} ({section.documents.length})
            </a>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-6 text-gray-600 dark:text-gray-300">
          Loading documentation...
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className="bg-white dark:bg-dark-lighter rounded-lg shadow"
            >
              <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{section.title}</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-300">{section.description}</p>
                </div>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {section.documents.length} item{section.documents.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="p-4 space-y-3">
                {section.documents.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">{section.emptyMessage}</div>
                ) : (
                  section.documents.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-col gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-blue-500" />
                          <p className="font-medium text-gray-900 dark:text-white">{entry.title}</p>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300">{entry.description}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {formatDate(entry.createdAt)} • {formatFileSize(entry.size)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDownload(entry)}
                          disabled={activeDownloadId === entry.id}
                          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <Download className="mr-2 h-4 w-4" />
                          {activeDownloadId === entry.id ? 'Preparing...' : 'Download'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
