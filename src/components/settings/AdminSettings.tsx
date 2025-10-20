import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Shield, Mail, Calendar, Key, Users, Link2, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { showSuccess, showError } from '../../lib/toast';
import { logger } from '../../lib/logger/logger';
import { useAuth } from '../../lib/authContext';
import { Modal } from '../common/Modal';
import type { PostgrestError } from '@supabase/supabase-js';

interface AdminUser {
  id: string;
  user_id: string;
  email: string;
  created_at: string;
  raw_user_meta_data?: {
    first_name?: string;
    last_name?: string;
    title?: string;
    organization_id?: string;
    organizationId?: string;
  } | null;
}

interface AdminFormData {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  title: string;
  organization_id: string | null;
  reason: string;
}

interface GuardianQueueEntry {
  id: string;
  guardian_id: string;
  guardian_email: string;
  status: string;
  organization_id: string | null;
  invite_token: string | null;
  metadata: Record<string, unknown> | null;
  requested_client_ids: string[] | null;
  approved_client_ids: string[] | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
  processed_by: string | null;
}

interface ClientOption {
  id: string;
  displayName: string;
}

export default function AdminSettings() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState<AdminUser | null>(null);
  const [formData, setFormData] = useState<AdminFormData>({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    title: '',
    organization_id: null,
    reason: '',
  });
  const [newPassword, setNewPassword] = useState('');
  const [accessError, setAccessError] = useState<string | null>(null);
  const [selectedClientsByRequest, setSelectedClientsByRequest] = useState<Record<string, string[]>>({});
  const [relationshipByRequest, setRelationshipByRequest] = useState<Record<string, string>>({});
  const [notesByRequest, setNotesByRequest] = useState<Record<string, string>>({});

  const addAdminEmailRef = useRef<HTMLInputElement>(null);
  const resetPasswordInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();
  const { user } = useAuth();

  const organizationId = useMemo(() => {
    const metadata = user?.user_metadata ?? {};
    const snake = typeof metadata.organization_id === 'string' ? metadata.organization_id : null;
    const camel = typeof metadata.organizationId === 'string' ? metadata.organizationId : null;
    return snake || camel || null;
  }, [user]);

  useEffect(() => {
    if (!organizationId) {
      setAccessError('Your account is missing an organization. Please contact support.');
      setFormData((previous) => ({ ...previous, organization_id: null }));
      return;
    }

    setFormData((previous) => ({ ...previous, organization_id: organizationId }));
  }, [organizationId]);

  const { data: admins = [], isLoading, error: adminsError } = useQuery<AdminUser[], Error>({
    queryKey: ['admins', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        const missingError = new Error('Organization context is required to load admin users.');
        (missingError as Error & { status?: number }).status = 400;
        throw missingError;
      }

      const { data, error } = await supabase.rpc('get_admin_users', { organization_id: organizationId });

      if (error) {
        const rpcError = error as PostgrestError & { status?: number };
        const mappedError = new Error(
          rpcError.code === '42501'
            ? 'You do not have permission to view admin users for this organization.'
            : error.message || 'Failed to load admin users.'
        );
        (mappedError as Error & { status?: number }).status = rpcError.code === '42501' ? 403 : 500;
        throw mappedError;
      }

      return (data as AdminUser[] | null) ?? [];
    },
    enabled: Boolean(organizationId),
    retry: false,
  });

  const {
    data: guardianRequests = [],
    isLoading: isGuardianQueueLoading,
    error: guardianQueueError,
  } = useQuery<GuardianQueueEntry[], Error>({
    queryKey: ['guardian-link-queue', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        const missingError = new Error('Organization context is required to review guardian requests.');
        (missingError as Error & { status?: number }).status = 400;
        throw missingError;
      }

      const { data, error } = await supabase.rpc('guardian_link_queue_admin_view', {
        p_organization_id: organizationId,
        p_status: 'pending',
      });

      if (error) {
        const rpcError = error as PostgrestError & { status?: number };
        const mapped = new Error(
          rpcError.code === '42501'
            ? 'You do not have permission to review guardian requests for this organization.'
            : error.message || 'Failed to load guardian requests.'
        );
        (mapped as Error & { status?: number }).status = rpcError.code === '42501' ? 403 : 500;
        throw mapped;
      }

      return (data as GuardianQueueEntry[] | null) ?? [];
    },
    enabled: Boolean(organizationId),
    retry: false,
  });

  const {
    data: guardianClients = [],
    isLoading: isGuardianClientsLoading,
    error: guardianClientsError,
  } = useQuery<ClientOption[], Error>({
    queryKey: ['guardian-link-clients', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        return [];
      }

      const { data, error } = await supabase
        .from('clients')
        .select('id, full_name, first_name, last_name')
        .eq('organization_id', organizationId)
        .order('last_name', { ascending: true, nullsLast: true })
        .order('first_name', { ascending: true, nullsLast: true });

      if (error) {
        throw error;
      }

      return (data ?? []).map((client) => {
        const first = typeof client.first_name === 'string' ? client.first_name : '';
        const last = typeof client.last_name === 'string' ? client.last_name : '';
        const fullName = typeof client.full_name === 'string' ? client.full_name : '';
        const displayName = fullName || [first, last].filter(Boolean).join(' ');
        return {
          id: client.id,
          displayName: displayName || client.id,
        };
      });
    },
    enabled: Boolean(organizationId),
    retry: false,
  });

  useEffect(() => {
    if (!adminsError) {
      if (organizationId) {
        setAccessError(null);
      }
      return;
    }

    const status = (adminsError as Error & { status?: number }).status;
    if (status === 403 || status === 400) {
      setAccessError(adminsError.message);
    } else if (status && status >= 400) {
      showError(adminsError);
    }
  }, [adminsError, organizationId]);

  useEffect(() => {
    if (!guardianQueueError) {
      return;
    }

    const status = (guardianQueueError as Error & { status?: number }).status;
    if (!status || status >= 500) {
      showError(guardianQueueError);
    }
  }, [guardianQueueError]);

  useEffect(() => {
    if (!guardianClientsError) {
      return;
    }

    showError(guardianClientsError);
  }, [guardianClientsError]);

  const createAdminMutation = useMutation({
    mutationFn: async (data: AdminFormData) => {
      if (!organizationId) {
        const error = new Error('Organization context is required to create an admin user.');
        logger.error('Missing organization during admin creation', {
          error,
          context: { component: 'AdminSettings', operation: 'createAdminMutation' },
          metadata: { hasOrganizationId: false },
        });
        throw error;
      }

      // Use assign_admin_role function instead of manage_admin_users
      try {
        const trimmedReason = data.reason.trim();

        // First create the user with password
        const { error: signUpError } = await supabase.auth.signUp({
          email: data.email,
          password: data.password,
          options: {
            data: {
              first_name: data.first_name,
              last_name: data.last_name,
              title: data.title,
              is_admin: true,
              organization_id: organizationId,
            },
          },
        });

        if (signUpError) throw signUpError;

        // Then assign admin role
        const { error: assignError } = await supabase.rpc('assign_admin_role', {
          user_email: data.email,
          organization_id: organizationId,
          reason: trimmedReason,
        });

        if (assignError) throw assignError;
      } catch (error) {
        logger.error('Admin creation mutation failed', {
          error,
          context: { component: 'AdminSettings', operation: 'createAdminMutation' },
          metadata: {
            hasEmail: Boolean(data.email),
            hasProfileDetails: Boolean(data.first_name || data.last_name || data.title),
            hasOrganizationId: Boolean(organizationId),
          },
        });
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admins', organizationId] });
      setIsModalOpen(false);
      resetForm();
      showSuccess('Admin user created successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const { error } = await supabase.rpc('reset_user_password', {
        target_email: email,
        new_password: password
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setIsPasswordModalOpen(false);
      setSelectedAdmin(null);
      setNewPassword('');
      showSuccess('Password reset successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const deleteAdminMutation = useMutation({
    mutationFn: async (userId: string) => {
      // Use the simplified function signature with just operation and target_user_id
      logger.info('Admin removal requested', {
        context: { component: 'AdminSettings', operation: 'removeAdmin' },
        metadata: { hasUserId: Boolean(userId) }
      });
      const { error } = await supabase.rpc('manage_admin_users', {
        operation: 'remove',
        target_user_id: userId
      });

      if (error) {
        const rpcError = error as { code?: string | null; details?: unknown; hint?: unknown };
        logger.error('Admin removal RPC failed', {
          error,
          context: { component: 'AdminSettings', operation: 'removeAdminRpc' },
          metadata: {
            hasUserId: Boolean(userId),
            supabaseCode: rpcError?.code ?? null,
            hasDetails: Boolean(rpcError?.details),
            hasHint: Boolean(rpcError?.hint)
          }
        });
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admins'] });
      showSuccess('Admin user removed successfully');
    },
    onError: (error) => {
      logger.error('Delete admin mutation lifecycle error', {
        error,
        context: { component: 'AdminSettings', operation: 'removeAdminMutation' },
        metadata: { stage: 'onError' }
      });
      showError(error);
    },
  });

  const approveGuardianMutation = useMutation({
    mutationFn: async ({
      requestId,
      clientIds,
      relationship,
      notes,
    }: {
      requestId: string;
      clientIds: string[];
      relationship: string | undefined;
      notes: string | undefined;
    }) => {
      const payload = {
        p_request_id: requestId,
        p_client_ids: clientIds.length > 0 ? clientIds : null,
        p_relationship: relationship && relationship.trim().length > 0 ? relationship.trim() : null,
        p_resolution_notes: notes && notes.trim().length > 0 ? notes.trim() : null,
      };

      const { error } = await supabase.rpc('approve_guardian_request', payload);

      if (error) {
        logger.error('Guardian approval RPC failed', {
          error,
          context: { component: 'AdminSettings', operation: 'approveGuardianRequest' },
          metadata: { requestId, clientCount: clientIds.length },
        });
        throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['guardian-link-queue', organizationId] });
      setSelectedClientsByRequest((previous) => ({
        ...previous,
        [variables.requestId]: [],
      }));
      setRelationshipByRequest((previous) => ({
        ...previous,
        [variables.requestId]: '',
      }));
      setNotesByRequest((previous) => ({
        ...previous,
        [variables.requestId]: '',
      }));
      showSuccess('Guardian request approved successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const resetForm = () => {
    setFormData({
      email: '',
      password: '',
      first_name: '',
      last_name: '',
      title: '',
      organization_id: organizationId ?? null,
      reason: '',
    });
  };

  const updateClientSelections = (requestId: string, selections: string[]) => {
    setSelectedClientsByRequest((previous) => ({
      ...previous,
      [requestId]: selections,
    }));
  };

  const updateRelationship = (requestId: string, value: string) => {
    setRelationshipByRequest((previous) => ({
      ...previous,
      [requestId]: value,
    }));
  };

  const updateNotes = (requestId: string, value: string) => {
    setNotesByRequest((previous) => ({
      ...previous,
      [requestId]: value,
    }));
  };

  const getMetadataValue = (entry: GuardianQueueEntry, key: string) => {
    if (!entry.metadata) {
      return undefined;
    }

    const raw = entry.metadata[key];
    return typeof raw === 'string' ? raw : undefined;
  };

  const closeCreateAdminModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const closePasswordModal = () => {
    setIsPasswordModalOpen(false);
    setSelectedAdmin(null);
    setNewPassword('');
  };

  const handleDelete = async (userId: string) => {
    if (window.confirm('Are you sure you want to remove this admin user?')) {
      try {
        logger.info('Admin removal confirmed by user', {
          context: { component: 'AdminSettings', operation: 'handleDelete' },
          metadata: { hasUserId: Boolean(userId) }
        });
        await deleteAdminMutation.mutateAsync(userId);
      } catch (error) {
        logger.error('Admin removal handler failed', {
          error,
          context: { component: 'AdminSettings', operation: 'handleDelete' },
          metadata: { hasUserId: Boolean(userId) }
        });
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedReason = formData.reason.trim();

    if (trimmedReason.length < 10) {
      showError(new Error('Please provide a reason with at least 10 characters.'));
      return;
    }

    await createAdminMutation.mutateAsync({ ...formData, reason: trimmedReason });
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdmin) return;

    await resetPasswordMutation.mutateAsync({
      email: selectedAdmin.email,
      password: newPassword
    });
  };

  const handleApproveGuardian = async (entry: GuardianQueueEntry) => {
    const selectedClients = selectedClientsByRequest[entry.id] ?? [];
    try {
      await approveGuardianMutation.mutateAsync({
        requestId: entry.id,
        clientIds: selectedClients,
        relationship: relationshipByRequest[entry.id],
        notes: notesByRequest[entry.id],
      });
    } catch (error) {
      logger.error('Guardian approval action failed', {
        error,
        context: { component: 'AdminSettings', operation: 'handleApproveGuardian' },
        metadata: { requestId: entry.id, selectedClientCount: selectedClients.length },
      });
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">Admin Users</h2>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <Plus className="w-4 h-4 mr-2 inline-block" />
          Add Admin
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      ) : accessError ? (
        <div className="text-center py-4 text-red-600 dark:text-red-400">{accessError}</div>
      ) : admins.length === 0 ? (
        <div className="text-center py-4 text-gray-500 dark:text-gray-400">
          No admin users found
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {admins.map((admin) => (
            <div
              key={admin.id}
              className="bg-white dark:bg-dark-lighter rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <Shield className="w-10 h-10 text-blue-600 bg-blue-100 dark:bg-blue-900/20 rounded-full p-2" />
                  <div className="ml-3">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                      {admin.raw_user_meta_data?.first_name} {admin.raw_user_meta_data?.last_name}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {admin.raw_user_meta_data?.title}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      setSelectedAdmin(admin);
                      setIsPasswordModalOpen(true);
                    }}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                    title="Reset password"
                  >
                    <Key className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(admin.user_id)}
                    className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                    title="Remove admin"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center text-sm">
                  <Mail className="w-4 h-4 text-gray-400 mr-2" />
                  <span className="text-gray-600 dark:text-gray-300">{admin.email}</span>
                </div>
                <div className="flex items-center text-sm">
                  <Calendar className="w-4 h-4 text-gray-400 mr-2" />
                  <span className="text-gray-500 dark:text-gray-400">
                    Added {new Date(admin.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-gray-200 dark:border-gray-700 pt-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            Guardian Access Requests
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Review guardian signups and connect them to the correct dependents.
          </p>
        </div>

        {!organizationId ? (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-200">
            Guardian approvals require an organization context. Confirm your account has an organization ID assigned.
          </div>
        ) : isGuardianQueueLoading || isGuardianClientsLoading ? (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : guardianRequests.length === 0 ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-dark-lighter dark:text-gray-300">
            No guardian access requests are waiting for review.
          </div>
        ) : (
          <div className="space-y-4">
            {guardianRequests.map((request) => {
              const selectedClientIds = selectedClientsByRequest[request.id] ?? [];
              const relationshipValue = relationshipByRequest[request.id] ?? '';
              const notesValue = notesByRequest[request.id] ?? '';
              const organizationHint = getMetadataValue(request, 'guardian_organization_hint');
              const inviteCode = request.invite_token ?? getMetadataValue(request, 'guardian_invite_token');
              const disableApprove = approveGuardianMutation.isPending || selectedClientIds.length === 0;
              const clientSelectId = `guardian-client-select-${request.id}`;
              const relationshipInputId = `guardian-relationship-${request.id}`;
              const notesTextareaId = `guardian-notes-${request.id}`;

              return (
                <div
                  key={request.id}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-lighter p-4 shadow-sm space-y-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-start">
                    <div className="space-y-1">
                      <div className="flex items-center text-sm text-gray-700 dark:text-gray-200">
                        <Mail className="h-4 w-4 mr-2 text-gray-400" />
                        {request.guardian_email}
                      </div>
                      <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                        <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                        Requested {new Date(request.created_at).toLocaleString()}
                      </div>
                      {organizationHint && (
                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                          <Link2 className="h-4 w-4 mr-2 text-gray-400" />
                          Organization hint: {organizationHint}
                        </div>
                      )}
                      {inviteCode && (
                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                          <CheckCircle2 className="h-4 w-4 mr-2 text-gray-400" />
                          Invite code: {inviteCode}
                        </div>
                      )}
                    </div>
                    <div className="text-xs uppercase tracking-wide text-blue-600 dark:text-blue-300 font-semibold">
                      {request.status}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label
                        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                        htmlFor={clientSelectId}
                      >
                        Select dependents to link
                      </label>
                      {guardianClients.length === 0 ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          No clients are available for this organization yet.
                        </p>
                      ) : (
                        <select
                          id={clientSelectId}
                          multiple
                          value={selectedClientIds}
                          onChange={(event) =>
                            updateClientSelections(
                              request.id,
                              Array.from(event.target.selectedOptions).map((option) => option.value)
                            )
                          }
                          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-gray-900 dark:text-gray-200 shadow-sm focus:border-blue-500 focus:ring-blue-500 h-32"
                        >
                          {guardianClients.map((client) => (
                            <option key={client.id} value={client.id}>
                              {client.displayName}
                            </option>
                          ))}
                        </select>
                      )}
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Hold Ctrl (Windows) or Cmd (Mac) to select multiple children.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label
                          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                          htmlFor={relationshipInputId}
                        >
                          Relationship label
                        </label>
                        <input
                          id={relationshipInputId}
                          type="text"
                          value={relationshipValue}
                          onChange={(event) => updateRelationship(request.id, event.target.value)}
                          placeholder="e.g., Parent or Legal Guardian"
                          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-gray-900 dark:text-gray-200 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label
                          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                          htmlFor={notesTextareaId}
                        >
                          Internal notes (optional)
                        </label>
                        <textarea
                          id={notesTextareaId}
                          value={notesValue}
                          onChange={(event) => updateNotes(request.id, event.target.value)}
                          rows={2}
                          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark text-gray-900 dark:text-gray-200 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleApproveGuardian(request)}
                      disabled={disableApprove}
                      className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                    >
                      {approveGuardianMutation.isPending ? (
                        <span className="flex items-center gap-2">
                          <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          Approving...
                        </span>
                      ) : (
                        'Approve guardian access'
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Admin Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeCreateAdminModal}
        titleId="add-admin-modal-title"
        initialFocusRef={addAdminEmailRef}
        panelClassName="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-md p-6"
      >
        <h2 id="add-admin-modal-title" className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
          Add New Admin
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="add-admin-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email*
                </label>
                <input
                  ref={addAdminEmailRef}
                  type="email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={handleInputChange}
                  id="add-admin-email"
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label htmlFor="add-admin-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Password*
                </label>
                <input
                  type="password"
                  name="password"
                  required
                  minLength={8}
                  value={formData.password}
                  onChange={handleInputChange}
                  id="add-admin-password"
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label htmlFor="add-admin-first-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  First Name*
                </label>
                <input
                  type="text"
                  name="first_name"
                  required
                  value={formData.first_name}
                  onChange={handleInputChange}
                  id="add-admin-first-name"
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label htmlFor="add-admin-last-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Last Name*
                </label>
                <input
                  type="text"
                  name="last_name"
                  required
                  value={formData.last_name}
                  onChange={handleInputChange}
                  id="add-admin-last-name"
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label htmlFor="add-admin-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  id="add-admin-title"
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label htmlFor="add-admin-organization" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Organization ID
                </label>
                <input
                  type="text"
                  name="organization_id"
                  value={formData.organization_id ?? ''}
                  readOnly
                  id="add-admin-organization"
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {!formData.organization_id && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    Organization context is required before creating additional admins.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="add-admin-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Reason for admin access*
                </label>
                <textarea
                  id="add-admin-reason"
                  name="reason"
                  required
                  minLength={10}
                  rows={3}
                  value={formData.reason}
                  onChange={handleInputChange}
                  placeholder="Explain why this user requires administrative privileges"
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Provide a short justification that will be stored in the audit log.
                </p>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={closeCreateAdminModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!formData.organization_id}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add Admin
                </button>
              </div>
            </form>
      </Modal>

      {/* Password Reset Modal */}
      <Modal
        isOpen={isPasswordModalOpen && Boolean(selectedAdmin)}
        onClose={closePasswordModal}
        titleId="reset-password-modal-title"
        initialFocusRef={resetPasswordInputRef}
        panelClassName="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-md p-6"
      >
        {selectedAdmin && (
          <>
            <h2 id="reset-password-modal-title" className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
              Reset Password for {selectedAdmin.email}
            </h2>

            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  New Password*
                </label>
                <input
                  ref={resetPasswordInputRef}
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={closePasswordModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Reset Password
                </button>
              </div>
            </form>
          </>
        )}
      </Modal>
    </div>
  );
}