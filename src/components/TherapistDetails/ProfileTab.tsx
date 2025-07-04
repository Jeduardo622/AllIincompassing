import React, { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { 
  User, Mail, Calendar, Phone, MapPin, 
  Edit2, Plus, Award, CheckCircle, AlertTriangle, RefreshCw,
  FileText, Briefcase, Building2
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { showSuccess, showError } from '../../lib/toast';
import TherapistModal from '../TherapistModal';

interface ProfileTabProps {
  therapist: any;
}

interface Note {
  id: string;
  content: string;
  author: string;
  created_at: string;
  is_visible_to_therapist: boolean;
  status: 'resolved' | 'open' | 'follow-up';
}

interface Issue {
  id: string;
  category: 'Certification' | 'Scheduling' | 'Training' | 'Performance' | 'Other';
  description: string;
  status: 'Open' | 'In Progress' | 'Resolved';
  priority: 'Low' | 'Medium' | 'High';
  date_opened: string;
  last_action: string;
}

export default function ProfileTab({ therapist }: ProfileTabProps) {
  const { hasRole, user } = useAuth();
  
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false);
  const [isAddIssueModalOpen, setIsAddIssueModalOpen] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [isVisibleToTherapist, setIsVisibleToTherapist] = useState(false);
  const [noteStatus, setNoteStatus] = useState<'resolved' | 'open' | 'follow-up'>('open');
  
  // Mock data for notes and issues
  const [notes, setNotes] = useState<Note[]>([
    {
      id: '1',
      content: 'Completed annual HIPAA training. All certificates updated in the system.',
      author: 'Admin User',
      created_at: '2025-05-15T14:30:00Z',
      is_visible_to_therapist: true,
      status: 'resolved'
    },
    {
      id: '2',
      content: 'Requested time off for the week of July 15-19. Need to reassign clients during this period.',
      author: 'Admin User',
      created_at: '2025-05-10T09:15:00Z',
      is_visible_to_therapist: true,
      status: 'open'
    }
  ]);
  
  const [issues, setIssues] = useState<Issue[]>([
    {
      id: '1',
      category: 'Certification',
      description: 'RBT certification expires in 30 days. Reminder sent for renewal.',
      status: 'Open',
      priority: 'High',
      date_opened: '2025-05-01T00:00:00Z',
      last_action: '2025-05-01T00:00:00Z'
    },
    {
      id: '2',
      category: 'Scheduling',
      description: 'Requested schedule change to accommodate additional client.',
      status: 'In Progress',
      priority: 'Medium',
      date_opened: '2025-04-28T00:00:00Z',
      last_action: '2025-05-05T00:00:00Z'
    }
  ]);
  
  const queryClient = useQueryClient();
  
  const updateTherapistMutation = useMutation({
    mutationFn: async (updatedTherapist: any) => {
      const { data, error } = await supabase
        .from('therapists')
        .update(updatedTherapist)
        .eq('id', therapist.id)
        .select()
        .single();
        
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['therapist', therapist.id] });
      setIsEditModalOpen(false);
      showSuccess('Therapist updated successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });
  
  const handleAddNote = () => {
    const newNote: Note = {
      id: Date.now().toString(),
      content: noteContent,
      author: 'Current User', // This would be the actual logged-in user
      created_at: new Date().toISOString(),
      is_visible_to_therapist: isVisibleToTherapist,
      status: noteStatus
    };
    
    setNotes([newNote, ...notes]);
    setNoteContent('');
    setIsVisibleToTherapist(false);
    setNoteStatus('open');
    setIsAddNoteModalOpen(false);
  };
  
  const handleAddIssue = (issue: Omit<Issue, 'id' | 'date_opened' | 'last_action'>) => {
    const newIssue: Issue = {
      ...issue,
      id: Date.now().toString(),
      date_opened: new Date().toISOString(),
      last_action: new Date().toISOString()
    };
    
    setIssues([newIssue, ...issues]);
    setIsAddIssueModalOpen(false);
  };
  
  const handleUpdateIssueStatus = (issueId: string, newStatus: Issue['status']) => {
    setIssues(issues.map(issue => 
      issue.id === issueId 
        ? { ...issue, status: newStatus, last_action: new Date().toISOString() } 
        : issue
    ));
  };
  
  const getStatusIcon = (status: Note['status']) => {
    switch (status) {
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
  
  const getPriorityClass = (priority: Issue['priority']) => {
    switch (priority) {
      case 'High':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      case 'Medium':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300';
      case 'Low':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300';
    }
  };
  
  const getStatusClass = (status: Issue['status']) => {
    switch (status) {
      case 'Open':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      case 'In Progress':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
      case 'Resolved':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300';
    }
  };

  return (
    <div className="space-y-8">
      {/* Therapist Header */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center">
            <div className="h-16 w-16 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
              <User className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="ml-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{therapist.full_name}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {therapist.title || 'Therapist'}
              </p>
            </div>
          </div>
          {(hasRole('admin') || isOwnProfile) && (
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
            >
              <Edit2 className="w-4 h-4 mr-1" />
              Edit
            </button>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="flex items-start">
            <Mail className="w-5 h-5 text-gray-400 mt-0.5 mr-2" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Email</p>
              <p className="text-sm text-gray-900 dark:text-white">{therapist.email}</p>
            </div>
          </div>
          
          <div className="flex items-start">
            <Phone className="w-5 h-5 text-gray-400 mt-0.5 mr-2" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Phone</p>
              <p className="text-sm text-gray-900 dark:text-white">{therapist.phone || 'N/A'}</p>
            </div>
          </div>
          
          <div className="flex items-start">
            <Award className="w-5 h-5 text-blue-500 mt-0.5 mr-2" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Specialties</p>
              <p className="text-sm text-gray-900 dark:text-white">
                {therapist.specialties?.join(', ') || 'N/A'}
              </p>
            </div>
          </div>
          
          <div className="flex items-start">
            <MapPin className="w-5 h-5 text-gray-400 mt-0.5 mr-2" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Address</p>
              <p className="text-sm text-gray-900 dark:text-white">
                {therapist.street ? (
                  <>
                    {therapist.street}<br />
                    {therapist.city}, {therapist.state} {therapist.zip_code}
                  </>
                ) : (
                  'N/A'
                )}
              </p>
            </div>
          </div>
          
          <div className="flex items-start">
            <Building2 className="w-5 h-5 text-gray-400 mt-0.5 mr-2" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Facility</p>
              <p className="text-sm text-gray-900 dark:text-white">{therapist.facility || 'N/A'}</p>
            </div>
          </div>
          
          <div className="flex items-start">
            <Briefcase className="w-5 h-5 text-gray-400 mt-0.5 mr-2" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Employee Type</p>
              <p className="text-sm text-gray-900 dark:text-white">{therapist.employee_type || 'N/A'}</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Notes Panel */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white">Professional Notes</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Internal notes about this therapist's practice and performance
            </p>
          </div>
          {hasRole('admin') && (
            <button
              onClick={() => setIsAddNoteModalOpen(true)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Note
            </button>
          )}
        </div>
        
        <div className="space-y-4">
          {notes.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">
              No notes found. Add your first note to get started.
            </p>
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
                      {note.author}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {new Date(note.created_at).toLocaleString()}
                  </div>
                </div>
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {note.content}
                </p>
                <div className="mt-2 flex items-center">
                  {note.is_visible_to_therapist && (
                    <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300 px-2 py-0.5 rounded">
                      Visible to therapist
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
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white">Issues Log</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Track and resolve issues related to this therapist
            </p>
          </div>
          {hasRole('admin') && (
            <button
              onClick={() => setIsAddIssueModalOpen(true)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Issue
            </button>
          )}
        </div>
        
        {issues.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <CheckCircle className="mx-auto h-8 w-8 text-green-500 mb-2" />
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">No issues</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              No issues currently logged for this therapist
            </p>
          </div>
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-dark-lighter divide-y divide-gray-200 dark:divide-gray-700">
              {issues.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                    No issues found.
                  </td>
                </tr>
              ) : (
                issues.map(issue => (
                  <tr key={issue.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-900 dark:text-white">
                        {issue.category}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-900 dark:text-white">
                        {issue.description}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusClass(issue.status)}`}>
                        {issue.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getPriorityClass(issue.priority)}`}>
                        {issue.priority}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(issue.date_opened).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(issue.last_action).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        {issue.status !== 'Open' && (
                          <button
                            onClick={() => handleUpdateIssueStatus(issue.id, 'Open')}
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            Open
                          </button>
                        )}
                        {issue.status !== 'In Progress' && (
                          <button
                            onClick={() => handleUpdateIssueStatus(issue.id, 'In Progress')}
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            In Progress
                          </button>
                        )}
                        {issue.status !== 'Resolved' && (
                          <button
                            onClick={() => handleUpdateIssueStatus(issue.id, 'Resolved')}
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            Resolve
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>
      
      {/* Edit Therapist Modal */}
      {isEditModalOpen && (
        <TherapistModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSubmit={updateTherapistMutation.mutateAsync}
          therapist={therapist}
        />
      )}
      
      {/* Add Note Modal */}
      {isAddNoteModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Add Note
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Note Content
                </label>
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  rows={5}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  placeholder="Enter your note here..."
                />
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="visible-to-therapist"
                  checked={isVisibleToTherapist}
                  onChange={(e) => setIsVisibleToTherapist(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="visible-to-therapist" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                  Visible to therapist
                </label>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Status
                </label>
                <div className="flex space-x-4">
                  <button
                    type="button"
                    onClick={() => setNoteStatus('resolved')}
                    className={`flex items-center px-3 py-2 rounded-md ${
                      noteStatus === 'resolved'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Resolved
                  </button>
                  <button
                    type="button"
                    onClick={() => setNoteStatus('open')}
                    className={`flex items-center px-3 py-2 rounded-md ${
                      noteStatus === 'open'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    Open Issue
                  </button>
                  <button
                    type="button"
                    onClick={() => setNoteStatus('follow-up')}
                    className={`flex items-center px-3 py-2 rounded-md ${
                      noteStatus === 'follow-up'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Follow-up
                  </button>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => setIsAddNoteModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddNote}
                disabled={!noteContent.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Note
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Add Issue Modal */}
      {isAddIssueModalOpen && (
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
  const [category, setCategory] = useState<Issue['category']>('Certification');
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Issue['category'])}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            >
              <option value="Certification">Certification</option>
              <option value="Scheduling">Scheduling</option>
              <option value="Training">Training</option>
              <option value="Performance">Performance</option>
              <option value="Other">Other</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              placeholder="Describe the issue..."
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Priority
            </label>
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