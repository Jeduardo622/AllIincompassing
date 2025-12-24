import React, { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import {
  User, Mail, Calendar, Phone, MapPin,
  Edit2, Plus, CheckCircle, AlertTriangle, RefreshCw,
  FileText
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { updateClientRecord } from '../../lib/clientPayload';
import { showSuccess, showError } from '../../lib/toast';
import ClientModal from '../ClientModal';
import AddGeneralNoteModal from '../AddGeneralNoteModal';
import type { Note, Issue } from '../../types';
import { useClientIssues, useClientNotes } from '../../lib/clients/hooks';
import { useAuth } from '../../lib/authContext';

interface ProfileTabProps {
  client: {
    id: string;
    full_name: string;
    client_id?: string;
    date_of_birth?: string;
    email?: string;
    phone?: string;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string;
    state?: string;
    zip_code?: string;
    gender?: string;
    cin_number?: string;
  };
  viewerRole?: 'client' | 'therapist' | 'admin' | 'super_admin';
}

export default function ProfileTab({ client, viewerRole }: ProfileTabProps) {
  const { profile, user } = useAuth();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false);
  const [isAddIssueModalOpen, setIsAddIssueModalOpen] = useState(false);

  const activeRole = viewerRole ?? profile?.role;
  const isGuardianView = activeRole === 'client';

  const {
    data: notes = [],
    isLoading: isLoadingNotes,
  } = useClientNotes(client.id);
  const {
    data: issues = [],
    isLoading: isLoadingIssues,
  } = useClientIssues(client.id);
  
  const queryClient = useQueryClient();

  const updateClientMutation = useMutation({
    mutationFn: async (updatedClient: Partial<ProfileTabProps['client']>) => {
      return updateClientRecord(supabase, client.id, updatedClient);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', client.id] });
      setIsEditModalOpen(false);
      showSuccess('Client updated successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: async (newNote: Omit<Note, 'id' | 'created_at' | 'author'>) => {
      const payload = {
        client_id: client.id,
        content: newNote.content,
        status: newNote.status,
        is_visible_to_parent: newNote.is_visible_to_parent,
        is_visible_to_therapist: true,
        created_by: user?.id ?? null,
      };

      const { error } = await supabase.from('client_notes').insert(payload);
      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-notes', client.id, 'all'] });
      queryClient.invalidateQueries({ queryKey: ['client-notes', client.id, 'parent'] });
      setIsAddNoteModalOpen(false);
      showSuccess('Note added successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const addIssueMutation = useMutation({
    mutationFn: async (issue: Omit<Issue, 'id' | 'date_opened' | 'last_action'>) => {
      const timestamp = new Date().toISOString();
      const payload = {
        client_id: client.id,
        category: issue.category,
        description: issue.description,
        status: issue.status,
        priority: issue.priority,
        date_opened: timestamp,
        last_action: timestamp,
        created_by: user?.id ?? null,
      };

      const { error } = await supabase.from('client_issues').insert(payload);
      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-issues', client.id] });
      setIsAddIssueModalOpen(false);
      showSuccess('Issue added successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const updateIssueStatusMutation = useMutation({
    mutationFn: async ({ issueId, newStatus }: { issueId: string; newStatus: Issue['status'] }) => {
      const { error } = await supabase
        .from('client_issues')
        .update({ status: newStatus, last_action: new Date().toISOString() })
        .eq('id', issueId);

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-issues', client.id] });
      showSuccess('Issue status updated');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const handleAddNote = async (newNote: Omit<Note, 'id' | 'created_at' | 'author'>) => {
    await addNoteMutation.mutateAsync(newNote);
  };

  const handleAddIssue = async (issue: Omit<Issue, 'id' | 'date_opened' | 'last_action'>) => {
    await addIssueMutation.mutateAsync(issue);
  };

  const handleUpdateIssueStatus = (issueId: string, newStatus: Issue['status']) => {
    updateIssueStatusMutation.mutate({ issueId, newStatus });
  };

  const updateClientErrorMessage =
    updateClientMutation.error instanceof Error
      ? updateClientMutation.error.message
      : updateClientMutation.error
        ? 'Failed to update client'
        : null;
  
  const getStatusIcon = (status: string | null | undefined) => {
    const normalized = status?.toLowerCase();
    switch (normalized) {
      case 'resolved':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'open':
        return <AlertTriangle className="w-5 h-5 text-amber-500" />;
      case 'follow-up':
        return <RefreshCw className="w-5 h-5 text-blue-500" />;
      default:
        return null;
    }
  };

  const getPriorityClass = (priority: string | null | undefined) => {
    const normalized = priority?.toLowerCase();
    switch (normalized) {
      case 'high':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      case 'medium':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300';
      case 'low':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300';
    }
  };

  const getStatusClass = (status: string | null | undefined) => {
    const normalized = status?.toLowerCase();
    switch (normalized) {
      case 'open':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      case 'in progress':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
      case 'resolved':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300';
    }
  };

  return (
    <div className="space-y-8">
      {/* Client Header */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center">
            <div className="h-16 w-16 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
              <User className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="ml-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{client.full_name}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Client ID: {client.client_id}
              </p>
            </div>
          </div>
          {!isGuardianView && (
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
              type="button"
            >
              <Edit2 className="w-4 h-4 mr-1" />
              Edit
            </button>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="flex items-start">
            <Calendar className="w-5 h-5 text-gray-400 mt-0.5 mr-2" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Date of Birth</p>
              <p className="text-sm text-gray-900 dark:text-white">
                {client.date_of_birth ? new Date(client.date_of_birth).toLocaleDateString() : 'N/A'}
              </p>
            </div>
          </div>
          
          <div className="flex items-start">
            <Mail className="w-5 h-5 text-gray-400 mt-0.5 mr-2" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Email</p>
              <p className="text-sm text-gray-900 dark:text-white">{client.email || 'N/A'}</p>
            </div>
          </div>
          
          <div className="flex items-start">
            <Phone className="w-5 h-5 text-gray-400 mt-0.5 mr-2" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Phone</p>
              <p className="text-sm text-gray-900 dark:text-white">{client.phone || 'N/A'}</p>
            </div>
          </div>
          
          <div className="flex items-start">
            <MapPin className="w-5 h-5 text-gray-400 mt-0.5 mr-2" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Address</p>
              <p className="text-sm text-gray-900 dark:text-white">
                {client.address_line1 ? (
                  <>
                    {client.address_line1}
                    {client.address_line2 ? <><br />{client.address_line2}</> : null}
                    <br />
                    {client.city}, {client.state} {client.zip_code}
                  </>
                ) : (
                  'N/A'
                )}
              </p>
            </div>
          </div>
          
          <div className="flex items-start">
            <User className="w-5 h-5 text-gray-400 mt-0.5 mr-2" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Gender</p>
              <p className="text-sm text-gray-900 dark:text-white">{client.gender || 'N/A'}</p>
            </div>
          </div>
          
          <div className="flex items-start">
            <FileText className="w-5 h-5 text-gray-400 mt-0.5 mr-2" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">CIN Number</p>
              <p className="text-sm text-gray-900 dark:text-white">{client.cin_number || 'N/A'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Notes Panel */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Notes</h2>
          {!isGuardianView && (
            <button
              onClick={() => setIsAddNoteModalOpen(true)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
              type="button"
              disabled={addNoteMutation.isPending}
            >
              {addNoteMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-b-2 border-white" />
                  Saving…
                </span>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Note
                </>
              )}
            </button>
          )}
        </div>

        <div className="space-y-4">
          {isLoadingNotes ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" />
            </div>
          ) : notes.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">No notes found.</p>
          ) : (
            notes.map(note => (
              <div
                key={note.id}
                className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center">
                    {getStatusIcon(note.status)}
                    <span className="ml-2 font-medium text-gray-900 dark:text-white">
                      {note.createdByName ?? note.createdBy ?? 'Care team member'}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {note.createdAt ? new Date(note.createdAt).toLocaleString() : '—'}
                  </div>
                </div>
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {note.content || 'No note content provided.'}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  {note.isVisibleToParent && (
                    <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300 px-2 py-0.5 rounded">
                      Visible to parent
                    </span>
                  )}
                  {!note.isVisibleToTherapist && (
                    <span className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300 px-2 py-0.5 rounded">
                      Hidden from therapist
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Issues Log */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Issues Log</h2>
          {!isGuardianView && (
            <button
              onClick={() => setIsAddIssueModalOpen(true)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
              type="button"
              disabled={addIssueMutation.isPending}
            >
              {addIssueMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-b-2 border-white" />
                  Saving…
                </span>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Issue
                </>
              )}
            </button>
          )}
        </div>

        {isLoadingIssues ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" />
          </div>
        ) : issues.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-8">No active issues tracked.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Priority
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Date Opened
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Last Action
                  </th>
                  {!isGuardianView && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-dark-lighter divide-y divide-gray-200 dark:divide-gray-700">
                {issues.map(issue => (
                  <tr key={issue.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                      {issue.category ?? '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-normal text-sm text-gray-500 dark:text-gray-300">
                      {issue.description ?? '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusClass(issue.status)}`}>
                        {issue.status ?? 'Unknown'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getPriorityClass(issue.priority)}`}>
                        {issue.priority ?? 'Unassigned'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                      {issue.dateOpened ? new Date(issue.dateOpened).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                      {issue.lastAction ? new Date(issue.lastAction).toLocaleDateString() : '—'}
                    </td>
                    {!isGuardianView && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleUpdateIssueStatus(issue.id, 'Open')}
                            className="px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                            type="button"
                            disabled={updateIssueStatusMutation.isPending}
                          >
                            Open
                          </button>
                          <button
                            onClick={() => handleUpdateIssueStatus(issue.id, 'In Progress')}
                            className="px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                            type="button"
                            disabled={updateIssueStatusMutation.isPending}
                          >
                            In Progress
                          </button>
                          <button
                            onClick={() => handleUpdateIssueStatus(issue.id, 'Resolved')}
                            className="px-2 py-1 text-xs font-medium text-green-600 hover:text-green-800 disabled:opacity-50"
                            type="button"
                            disabled={updateIssueStatusMutation.isPending}
                          >
                            Resolved
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Client Modal */}
      {isEditModalOpen && (
        <ClientModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSubmit={updateClientMutation.mutateAsync}
          client={client}
          isSaving={updateClientMutation.isPending}
          saveError={updateClientErrorMessage}
        />
      )}
      
      {/* Add Note Modal */}
      <AddGeneralNoteModal
        isOpen={!isGuardianView && isAddNoteModalOpen}
        onClose={() => setIsAddNoteModalOpen(false)}
        onSubmit={handleAddNote}
        currentUser={profile?.full_name ?? profile?.email ?? 'Current User'}
      />

      {/* Add Issue Modal */}
      {!isGuardianView && isAddIssueModalOpen && (
        <AddIssueModal
          onClose={() => setIsAddIssueModalOpen(false)}
          onSubmit={handleAddIssue}
        />
      )}
    </div>
  );
}

interface AddIssueModalProps {
  onClose: () => void;
  onSubmit: (issue: Omit<Issue, 'id' | 'date_opened' | 'last_action'>) => void;
}

function AddIssueModal({ onClose, onSubmit }: AddIssueModalProps) {
  const [category, setCategory] = useState<Issue['category']>('Authorization');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Issue['priority']>('Medium');
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      category,
      description,
      status: 'Open',
      priority
    });
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          Add Issue
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="issue-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Category
            </label>
            <select
              id="issue-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as Issue['category'])}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            >
              <option value="Authorization">Authorization</option>
              <option value="Scheduling">Scheduling</option>
              <option value="Clinical">Clinical</option>
              <option value="Billing">Billing</option>
              <option value="Other">Other</option>
            </select>
          </div>
          
          <div>
            <label htmlFor="issue-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              id="issue-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              placeholder="Describe the issue..."
              required
            />
          </div>
          
          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Priority
            </p>
            <div className="flex space-x-4">
              <button
                type="button"
                onClick={() => setPriority('Low')}
                className={`flex-1 py-2 rounded-md ${
                  priority === 'Low'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                Low
              </button>
              <button
                type="button"
                onClick={() => setPriority('Medium')}
                className={`flex-1 py-2 rounded-md ${
                  priority === 'Medium'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                Medium
              </button>
              <button
                type="button"
                onClick={() => setPriority('High')}
                className={`flex-1 py-2 rounded-md ${
                  priority === 'High'
                    
                    ? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                High
              </button>
            </div>
          </div>
          
          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!description.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Issue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}