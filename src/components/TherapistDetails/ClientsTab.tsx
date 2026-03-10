import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { 
  User, Search, Calendar, Clock, Inbox,
  ArrowRight, CheckCircle, X, AlertTriangle
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { CLIENT_SELECT } from '../../lib/clients/select';
import { showSuccess, showError } from '../../lib/toast';
import { useAuth } from '../../lib/authContext';
import type { Client } from '../../types';

interface ClientsTabProps {
  therapist: { id: string };
}

interface LinkableClient {
  id: string;
  full_name: string;
  email: string | null;
  primary_therapist_id: string | null;
  primary_therapist_name: string | null;
  linked_therapist_ids: string[];
  linked_therapist_names: string[];
}

export const getMissingClientIds = (
  directAssignmentIds: string[],
  linkedClientIds: string[],
  sessionClientIds: string[],
): string[] => {
  const directSet = new Set(directAssignmentIds);
  return [...new Set([...linkedClientIds, ...sessionClientIds])].filter((clientId) => !directSet.has(clientId));
};

export const isAlreadyLinkedToTherapist = (
  client: LinkableClient,
  therapistId: string,
): boolean => (
  client.linked_therapist_ids.includes(therapistId) || client.primary_therapist_id === therapistId
);

export function ClientsTab({ therapist }: ClientsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [linkingClientId, setLinkingClientId] = useState<string | null>(null);
  const [unlinkingClientId, setUnlinkingClientId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { isAdmin, isSuperAdmin } = useAuth();
  const canManageLinks = isAdmin() || isSuperAdmin();
  
  // Fetch assigned clients
  const { data: assignedClients = [], isLoading: isLoadingClients, error: clientsError } = useQuery({
    queryKey: ['therapist-clients', therapist.id],
    queryFn: async () => {
      const { data: directAssignments, error: directError } = await supabase
        .from('clients')
        .select(CLIENT_SELECT)
        .eq('therapist_id', therapist.id)
        .order('full_name', { ascending: true });

      if (directError) throw directError;

      const { data: linkRows, error: linksError } = await supabase
        .from('client_therapist_links')
        .select('client_id')
        .eq('therapist_id', therapist.id);

      if (linksError) throw linksError;

      // Get unique client IDs from sessions
      const { data: sessions, error: sessionsError } = await supabase
        .from('sessions')
        .select('client_id')
        .eq('therapist_id', therapist.id)
        .order('start_time', { ascending: false });
        
      if (sessionsError) throw sessionsError;

      const directAssignmentsList = (directAssignments ?? []) as Client[];
      const directAssignmentsMap = new Map<string, Client>(
        directAssignmentsList.map((client) => [client.id, client]),
      );

      const linkedClientIds = Array.from(
        new Set(
          (linkRows ?? [])
            .map((row) => row.client_id)
            .filter((clientId): clientId is string => typeof clientId === 'string' && clientId.length > 0),
        ),
      );

      const sessionClientIds = Array.from(
        new Set(
          (sessions ?? [])
            .map((session) => session.client_id)
            .filter((clientId): clientId is string => typeof clientId === 'string' && clientId.length > 0),
        ),
      );

      const missingClientIds = getMissingClientIds(
        Array.from(directAssignmentsMap.keys()),
        linkedClientIds,
        sessionClientIds,
      );

      if (missingClientIds.length > 0) {
        const { data: sessionClients, error: historyError } = await supabase
          .from('clients')
          .select(CLIENT_SELECT)
          .in('id', missingClientIds);

        if (historyError) throw historyError;

        (sessionClients ?? []).forEach((client) => {
          directAssignmentsMap.set(client.id, client as Client);
        });
      }

      return Array.from(directAssignmentsMap.values());
    },
  });
  
  // Fetch recent sessions
  const { data: recentSessions = [], isLoading: isLoadingSessions, error: sessionsError } = useQuery({
    queryKey: ['therapist-recent-sessions', therapist.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select(`
          *,
          client:clients(id, full_name)
        `)
        .eq('therapist_id', therapist.id)
        .order('start_time', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data || [];
    }
  });

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200">
            <CheckCircle className="w-3 h-3 mr-1" />
            Completed
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-200">
            <X className="w-3 h-3 mr-1" />
            Cancelled
          </span>
        );
      case 'no-show':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
            <AlertTriangle className="w-3 h-3 mr-1" />
            No Show
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
            <Clock className="w-3 h-3 mr-1" />
            Scheduled
          </span>
        );
    }
  };
  
  // Filter clients based on search query
  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return assignedClients;
    
    return assignedClients.filter((client) => {
      const name = (client.full_name ?? '').toLowerCase();
      const email = (client.email ?? '').toLowerCase();
      const query = searchQuery.toLowerCase();
      return name.includes(query) || email.includes(query);
    });
  }, [assignedClients, searchQuery]);
  
  const { data: linkableClients = [], isLoading: isLoadingLinkableClients } = useQuery<LinkableClient[]>({
    queryKey: ['linkable-clients', therapist.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select(`
          id,
          full_name,
          email,
          therapist_id,
          therapist:therapists(full_name)
        `)
        .order('full_name', { ascending: true });

      if (error) throw error;

      const { data: linkRows, error: linkError } = await supabase
        .from('client_therapist_links')
        .select(`
          client_id,
          therapist_id,
          therapist:therapists(full_name)
        `);

      if (linkError) throw linkError;

      const linkMap = new Map<
        string,
        { therapistIds: Set<string>; therapistNames: Set<string> }
      >();

      (linkRows ?? []).forEach((row) => {
        const clientId = row.client_id;
        const linkedTherapistId = row.therapist_id;
        if (!clientId || !linkedTherapistId) return;

        const existing = linkMap.get(clientId) ?? {
          therapistIds: new Set<string>(),
          therapistNames: new Set<string>(),
        };
        existing.therapistIds.add(linkedTherapistId);

        const therapistName = (row as unknown as { therapist?: { full_name?: string | null } | null }).therapist
          ?.full_name;
        if (therapistName) {
          existing.therapistNames.add(therapistName);
        }

        linkMap.set(clientId, existing);
      });

      return (data ?? []).map((client) => ({
        id: client.id as string,
        full_name: (client.full_name as string) ?? 'Unnamed client',
        email: (client.email as string | null) ?? null,
        primary_therapist_id: (client.therapist_id as string | null) ?? null,
        primary_therapist_name: (client as unknown as { therapist?: { full_name?: string | null } | null })?.therapist
          ?.full_name ?? null,
        linked_therapist_ids: Array.from(linkMap.get(client.id as string)?.therapistIds ?? []),
        linked_therapist_names: Array.from(linkMap.get(client.id as string)?.therapistNames ?? []),
      }));
    },
    enabled: isLinkModalOpen && canManageLinks,
    staleTime: 30_000,
  });

  const filteredLinkableClients = useMemo(() => {
    if (!linkSearchQuery.trim()) return linkableClients;
    const query = linkSearchQuery.toLowerCase();
    return linkableClients.filter((client) => {
      const name = client.full_name.toLowerCase();
      const email = (client.email ?? '').toLowerCase();
      return name.includes(query) || email.includes(query);
    });
  }, [linkSearchQuery, linkableClients]);

  const linkClientMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const { error: linkError } = await supabase
        .from('client_therapist_links')
        .upsert(
          {
            client_id: clientId,
            therapist_id: therapist.id,
          },
          { onConflict: 'client_id,therapist_id' },
        );

      if (linkError) throw linkError;

      const { error } = await supabase
        .from('clients')
        .update({
          therapist_id: therapist.id,
          therapist_assigned_at: new Date().toISOString(),
        })
        .eq('id', clientId)
        .is('therapist_id', null);

      if (error) throw error;
    },
    onSuccess: () => {
      showSuccess('Client linked to therapist');
      queryClient.invalidateQueries({ queryKey: ['therapist-clients', therapist.id] });
      queryClient.invalidateQueries({ queryKey: ['linkable-clients', therapist.id] });
    },
    onError: (error) => {
      showError(error);
    },
  });

  const unlinkClientMutation = useMutation({
    mutationFn: async (input: { clientId: string; primaryTherapistId: string | null }) => {
      const { clientId, primaryTherapistId } = input;

      const { error: unlinkError } = await supabase
        .from('client_therapist_links')
        .delete()
        .eq('client_id', clientId)
        .eq('therapist_id', therapist.id);

      if (unlinkError) throw unlinkError;

      if (primaryTherapistId !== therapist.id) return;

      const { data: nextPrimaryLink, error: nextPrimaryError } = await supabase
        .from('client_therapist_links')
        .select('therapist_id')
        .eq('client_id', clientId)
        .neq('therapist_id', therapist.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (nextPrimaryError) throw nextPrimaryError;

      const nextPrimaryTherapistId = (nextPrimaryLink?.therapist_id as string | undefined) ?? null;

      const { error: clearPrimaryError } = await supabase
        .from('clients')
        .update({
          therapist_id: nextPrimaryTherapistId,
          therapist_assigned_at: nextPrimaryTherapistId ? new Date().toISOString() : null,
        })
        .eq('id', clientId)
        .eq('therapist_id', therapist.id);

      if (clearPrimaryError) throw clearPrimaryError;
    },
    onSuccess: () => {
      showSuccess('Client unlinked from therapist');
      queryClient.invalidateQueries({ queryKey: ['therapist-clients', therapist.id] });
      queryClient.invalidateQueries({ queryKey: ['linkable-clients', therapist.id] });
    },
    onError: (error) => {
      showError(error);
    },
  });

  const handleLinkClient = async (clientId: string) => {
    setLinkingClientId(clientId);
    try {
      await linkClientMutation.mutateAsync(clientId);
    } finally {
      setLinkingClientId(null);
    }
  };

  const handleUnlinkClient = async (input: {
    clientId: string;
    primaryTherapistId: string | null;
    clientName: string;
  }) => {
    const shouldUnlink = window.confirm(
      `Unlink ${input.clientName} from this therapist? This will remove this therapist relationship.`,
    );

    if (!shouldUnlink) return;

    setUnlinkingClientId(input.clientId);
    try {
      await unlinkClientMutation.mutateAsync({
        clientId: input.clientId,
        primaryTherapistId: input.primaryTherapistId,
      });
    } finally {
      setUnlinkingClientId(null);
    }
  };
  
  const isLoading = isLoadingClients || isLoadingSessions;
  const hasError = clientsError || sessionsError;

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  if (hasError) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 p-4 rounded-lg">
        <h3 className="font-medium mb-2">Error loading data</h3>
        <p className="text-sm">{clientsError?.message || sessionsError?.message || "An error occurred loading the data."}</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-8">
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Assigned Clients ({assignedClients.length})
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Manage your client relationships and view client information
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search clients..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>
            {canManageLinks && (
              <button
                type="button"
                className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                onClick={() => setIsLinkModalOpen(true)}
              >
                Link Client
              </button>
            )}
          </div>
        </div>
        
        {assignedClients.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <Inbox className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No clients assigned</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              No clients have been assigned to you yet
            </p>
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">No matching clients</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Try adjusting your search criteria
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
            {filteredClients.map(client => (
              <Link
                key={client.id}
                to={`/clients/${client.id}`} 
                className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex flex-col space-y-3">
                  <div className="flex items-center">
                    <div className="text-right mr-3">
                      <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="ml-3">
                      <h4 className="font-medium text-gray-900 dark:text-white">{client.full_name}</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{client.email || 'No email'}</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center text-gray-600 dark:text-gray-300">
                      <Calendar className="w-4 h-4 mr-1" />
                      <span>
                        {client.date_of_birth ? format(new Date(client.date_of_birth), 'MM/dd/yyyy') : 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center justify-end text-blue-600 dark:text-blue-400">
                      View Details
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </div>
                  </div>
                  
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                      {client.service_preference?.join(', ') || 'No service preference'}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <div className="mb-6">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Recent Sessions
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            View your recent and upcoming client sessions
          </p>
        </div>
        
        {recentSessions.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <Calendar className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No sessions</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              No recent sessions found for this therapist
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {recentSessions.map(session => (
              <div 
                key={session.id}
                className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg"
              >
                <div className="flex items-center">
                  <User className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-3" />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      {session.client?.full_name}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {format(parseISO(session.start_time), 'EEEE, MMMM d, yyyy')}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center">
                  <div className="text-right mr-4">
                    <div className="font-medium text-gray-900 dark:text-white">
                        {format(parseISO(session.start_time), 'h:mm a')}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {format(parseISO(session.end_time), 'h:mm a')}
                    </div>
                  </div>
                  
                  {getStatusBadge(session.status)}
                </div>
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-2">
                  {session.notes || 'No session notes'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <LinkClientModal
        isOpen={isLinkModalOpen && canManageLinks}
        onClose={() => setIsLinkModalOpen(false)}
        searchValue={linkSearchQuery}
        onSearchChange={setLinkSearchQuery}
        clients={filteredLinkableClients}
        isLoading={isLoadingLinkableClients || linkClientMutation.isPending || unlinkClientMutation.isPending}
        onLink={handleLinkClient}
        onUnlink={handleUnlinkClient}
        linkingClientId={linkingClientId}
        unlinkingClientId={unlinkingClientId}
        therapistId={therapist.id}
      />
    </div>
  );
}

interface LinkClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  clients: LinkableClient[];
  isLoading: boolean;
  onLink: (clientId: string) => void;
  onUnlink: (input: {
    clientId: string;
    primaryTherapistId: string | null;
    clientName: string;
  }) => void;
  linkingClientId: string | null;
  unlinkingClientId: string | null;
  therapistId: string;
}

const LinkClientModal: React.FC<LinkClientModalProps> = ({
  isOpen,
  onClose,
  searchValue,
  onSearchChange,
  clients,
  isLoading,
  onLink,
  onUnlink,
  linkingClientId,
  unlinkingClientId,
  therapistId,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-dark-lighter">
        <div className="flex items-center justify-between border-b px-6 py-4 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Link Client to Therapist</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Select a client to associate with this therapist profile.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
            aria-label="Close link client modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search by client name or email..."
              className="w-full rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-dark dark:text-gray-200"
            />
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
              </div>
            ) : clients.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 py-8 text-center dark:border-gray-700">
                <p className="text-sm font-medium text-gray-900 dark:text-white">No clients available</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  All clients are currently linked to therapists.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {clients.map((client) => {
                  const alreadyLinkedHere = isAlreadyLinkedToTherapist(client, therapistId);
                  const isLinking = linkingClientId === client.id;
                  const isUnlinking = unlinkingClientId === client.id;
                  const linkedToOtherNames = client.linked_therapist_names.filter((name) => name.trim().length > 0);
                  const currentLinkText = linkedToOtherNames.length > 0
                    ? `Currently linked to ${linkedToOtherNames.join(', ')}`
                    : `Currently linked to ${client.primary_therapist_name ?? 'another therapist'}`;
                  return (
                    <li key={client.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{client.full_name}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{client.email ?? 'No email listed'}</p>
                        {(client.primary_therapist_id || client.linked_therapist_ids.length > 0) && (
                          <p className="text-xs text-amber-600 dark:text-amber-300">
                            {alreadyLinkedHere
                              ? 'Already linked to this therapist'
                              : currentLinkText}
                          </p>
                        )}
                      </div>
                      {alreadyLinkedHere ? (
                        <button
                          type="button"
                          onClick={() => onUnlink({
                            clientId: client.id,
                            primaryTherapistId: client.primary_therapist_id,
                            clientName: client.full_name,
                          })}
                          disabled={isUnlinking}
                          className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:border-red-900/50 dark:bg-transparent dark:text-red-300"
                        >
                          {isUnlinking ? 'Unlinking…' : 'Unlink'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onLink(client.id)}
                          disabled={isLinking}
                          className="rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                        >
                          {isLinking ? 'Linking…' : 'Link'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};