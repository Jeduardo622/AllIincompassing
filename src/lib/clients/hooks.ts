import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAuth } from '../authContext';
import {
  confirmGuardianContactInfo,
  fetchClientIssues,
  fetchClientNotes,
  fetchGuardianClientById,
  fetchGuardianClients,
  fetchGuardianContactMetadata,
  type ClientIssue,
  type ClientNote,
  type FetchClientNotesOptions,
  type GuardianContactConfirmationResult,
  type GuardianContactMetadataEntry,
  type GuardianPortalClient,
} from './fetchers';

type GuardianClientsQueryKey = ['guardian', 'clients'];
type GuardianClientQueryKey = ['guardian', 'clients', string];
type ClientNotesQueryKey = ['client-notes', string, 'parent' | 'all'];
type ClientIssuesQueryKey = ['client-issues', string];
type GuardianContactMetadataKey = ['guardian', 'contact', string];

const buildClientNotesKey = (clientId: string, options?: FetchClientNotesOptions): ClientNotesQueryKey => [
  'client-notes',
  clientId,
  options?.visibleToParentOnly ? 'parent' : 'all',
];

export const useGuardianClients = () => {
  return useQuery<GuardianPortalClient[], Error>({
    queryKey: ['guardian', 'clients'] satisfies GuardianClientsQueryKey,
    queryFn: () => fetchGuardianClients(),
  });
};

export const useGuardianClient = (clientId: string | null | undefined) => {
  return useQuery<GuardianPortalClient | null, Error>({
    queryKey: ['guardian', 'clients', clientId ?? 'unknown'] satisfies GuardianClientQueryKey,
    queryFn: async () => {
      if (!clientId) {
        return null;
      }

      return fetchGuardianClientById(clientId);
    },
    enabled: Boolean(clientId),
  });
};

export const useClientNotes = (
  clientId: string | null | undefined,
  options?: FetchClientNotesOptions,
) => {
  const queryKey = useMemo(
    () => (clientId ? buildClientNotesKey(clientId, options) : null),
    [clientId, options?.visibleToParentOnly],
  );
  const fallbackKey: ClientNotesQueryKey = ['client-notes', 'placeholder', 'all'];

  return useQuery<ClientNote[], Error>({
    queryKey: queryKey ?? fallbackKey,
    queryFn: async () => {
      if (!clientId) {
        return [];
      }

      return fetchClientNotes(clientId, options);
    },
    enabled: Boolean(clientId),
  });
};

export const useClientIssues = (clientId: string | null | undefined) => {
  return useQuery<ClientIssue[], Error>({
    queryKey: ['client-issues', clientId ?? 'unknown'] satisfies ClientIssuesQueryKey,
    queryFn: async () => {
      if (!clientId) {
        return [];
      }

      return fetchClientIssues(clientId);
    },
    enabled: Boolean(clientId),
  });
};

export const useConfirmGuardianContact = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<GuardianContactConfirmationResult, Error, string>({
    mutationFn: async (clientId: string) => {
      if (!user?.id) {
        throw new Error('You must be signed in to confirm contact information.');
      }

      return confirmGuardianContactInfo(user.id, clientId);
    },
    onSuccess: (_result, clientId) => {
      queryClient.invalidateQueries({ queryKey: ['guardian', 'clients'] satisfies GuardianClientsQueryKey });
      if (clientId) {
        queryClient.invalidateQueries({ queryKey: ['guardian', 'clients', clientId] satisfies GuardianClientQueryKey });
      }
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: ['guardian', 'contact', user.id] satisfies GuardianContactMetadataKey });
      }
    },
  });
};

export const useGuardianContactMetadata = () => {
  const { user } = useAuth();

  return useQuery<GuardianContactMetadataEntry[], Error>({
    queryKey: ['guardian', 'contact', user?.id ?? 'anonymous'] satisfies GuardianContactMetadataKey,
    queryFn: async () => {
      if (!user?.id) {
        return [];
      }

      return fetchGuardianContactMetadata(user.id);
    },
    enabled: Boolean(user?.id),
  });
};
