import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { 
  FileText, Calendar, DollarSign, Plus, Download, ChevronDown, ChevronUp, Inbox,
  Clock, CheckCircle, X, AlertTriangle, User, Search
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { SessionNote, Therapist } from '../../types';
import AddSessionNoteModal from '../AddSessionNoteModal';

interface SessionNotesTabProps {
  client: any;
}

export default function SessionNotesTab({ client }: SessionNotesTabProps) {
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false);
  const [selectedAuth, setSelectedAuth] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  
  // Fetch authorizations
  const { data: authorizations = [], isLoading: isLoadingAuths } = useQuery({
    queryKey: ['authorizations', client.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('authorizations')
        .select(`
          *,
          services:authorization_services(*)
        `)
        .eq('client_id', client.id)
        .eq('status', 'approved');
        
      if (error) throw error;
      return data as any[];
    },
  });

  // Fetch therapists for the session note modal
  const { data: therapists = [] } = useQuery({
    queryKey: ['therapists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('therapists')
        .select('*')
        .order('full_name');
      
      if (error) throw error;
      return data as Therapist[];
    },
  });
  
  // Mock session notes data
  const [sessionNotes, setSessionNotes] = useState<SessionNote[]>([
    {
      id: '1',
      date: '2025-05-15',
      start_time: '14:00',
      end_time: '15:00',
      service_code: '97153',
      therapist_name: 'Jane Smith, BCBA',
      goals_addressed: ['Communication', 'Social skills'],
      narrative: 'Client demonstrated progress in turn-taking activities. Worked on requesting preferred items using full sentences. Responded well to visual supports.',
      is_locked: true
    },
    {
      id: '2',
      date: '2025-05-10',
      start_time: '10:00',
      end_time: '11:00',
      service_code: '97153',
      therapist_name: 'John Doe, RBT',
      goals_addressed: ['Self-help skills', 'Following instructions'],
      narrative: 'Focused on hand-washing routine and following 2-step instructions. Client needed moderate prompting for hand-washing steps but showed improvement from previous session.',
      is_locked: false
    }
  ]);

  // Filter session notes based on search and status
  const filteredNotes = sessionNotes.filter(note => {
    const matchesSearch = 
      note.narrative.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.therapist_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.service_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.goals_addressed.some(goal => goal.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesStatus = 
      statusFilter === 'all' || 
      (statusFilter === 'locked' && note.is_locked) ||
      (statusFilter === 'unlocked' && !note.is_locked);
      
    return matchesSearch && matchesStatus;
  });
  
  const handleSelectAllNotes = () => {
    if (selectedNotes.length === filteredNotes.length) {
      setSelectedNotes([]);
    } else {
      setSelectedNotes(filteredNotes.map(note => note.id));
    }
  };
  
  const handleSelectNote = (noteId: string) => {
    if (selectedNotes.includes(noteId)) {
      setSelectedNotes(selectedNotes.filter(id => id !== noteId));
    } else {
      setSelectedNotes([...selectedNotes, noteId]);
    }
  };
  
  const handleGeneratePDF = () => {
    // This would call a function to generate and download a PDF of the selected notes
    alert(`Generating PDF for notes: ${selectedNotes.join(', ')}`);
  };

  const handleAddSessionNote = (newNote: Omit<SessionNote, 'id'>) => {
    const note: SessionNote = {
      ...newNote,
      id: Date.now().toString(),
    };
    
    setSessionNotes([note, ...sessionNotes]);
    setIsAddNoteModalOpen(false);
  };
  
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Authorization Selector (Left Rail) */}
        <div className="md:col-span-1 bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
            Active Authorizations
          </h3>
          
          {isLoadingAuths ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : authorizations.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No active authorizations found
            </div>
          ) : (
            <div className="space-y-3">
              {authorizations.map(auth => (
                <div
                  key={auth.id}
                  onClick={() => setSelectedAuth(auth.id)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedAuth === auth.id
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                      : 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700'
                  } border`}
                >
                  <div className="font-medium text-gray-900 dark:text-white">
                    Auth #{auth.authorization_number}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {new Date(auth.start_date).toLocaleDateString()} - {new Date(auth.end_date).toLocaleDateString()}
                  </div>
                  <div className="mt-2 space-y-1">
                    {auth.services.map(service => (
                      <div key={service.id} className="text-xs">
                        <span className="font-medium text-gray-700 dark:text-gray-300">
                          {service.service_code}:
                        </span>
                        <span className="ml-1 text-gray-600 dark:text-gray-400">
                          {service.approved_units} of {service.requested_units} {service.unit_type}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Session Notes (Center) */}
        <div className="md:col-span-3 bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                Session Notes
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Review and manage client session documentation
              </p>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setIsAddNoteModalOpen(true)}
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
                disabled={!selectedAuth}
                type="button"
              >
                <Plus className="w-4 h-4 mr-1" />
                New Note
              </button>
              
              <button
                onClick={handleGeneratePDF}
                disabled={selectedNotes.length === 0}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center disabled:opacity-50"
                type="button"
              >
                <Download className="w-4 h-4 mr-1" />
                Generate PDF
              </button>
            </div>
          </div>
          
          <div className="mb-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search session notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>

            <div className="flex flex-wrap gap-3 justify-between items-center bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="select-all"
                  checked={selectedNotes.length === filteredNotes.length && filteredNotes.length > 0}
                  onChange={handleSelectAllNotes}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="select-all" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  Select All ({filteredNotes.length} notes)
                </label>
              </div>
              
              <div className="flex items-center">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 py-1 px-2 text-gray-700 dark:text-gray-300"
                >
                  <option value="all">All Notes</option>
                  <option value="locked">Signed Only</option>
                  <option value="unlocked">Unsigned Only</option>
                </select>
              </div>
            </div>
          </div>
          
          <div className="space-y-4">
            {sessionNotes.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                <Inbox className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No session notes</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  No session notes have been created for this client yet
                </p>
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <AlertTriangle className="mx-auto h-8 w-8 text-amber-500 mb-2" />
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">No matching notes</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Try adjusting your search criteria or filters
                </p>
              </div>
            ) : (
              filteredNotes.map(note => (
                <div 
                  key={note.id} 
                  className={`p-4 rounded-lg border ${
                    selectedNotes.includes(note.id)
                      ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/10'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-lighter'
                  }`}
                >
                  <div className="flex items-start">
                    <input
                      type="checkbox"
                      checked={selectedNotes.includes(note.id)}
                      onChange={() => handleSelectNote(note.id)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mt-1"
                    />
                    
                    <div className="ml-3 flex-1">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center">
                            <Calendar className="w-4 h-4 text-gray-400 mr-1" />
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {format(new Date(note.date), 'MMMM d, yyyy')}
                            </span>
                            <Clock className="w-4 h-4 text-gray-400 ml-3 mr-1" />
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                              {note.start_time} - {note.end_time}
                            </span>
                          </div>
                          
                          <div className="flex items-center mt-1">
                            <User className="w-4 h-4 text-gray-400 mr-1" />
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                              {note.therapist_name}
                            </span>
                            <span className="ml-3 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300 px-2 py-0.5 rounded">
                              {note.service_code}
                            </span>
                            {note.is_locked && (
                              <span className="ml-2 text-xs bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 px-2 py-0.5 rounded flex items-center">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Signed
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {!note.is_locked && (
                          <button 
                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm"
                            type="button"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      
                      <div className="mt-3">
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Goals Addressed:
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {note.goals_addressed.map((goal, index) => (
                            <span 
                              key={index}
                              className="text-xs bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200 px-2 py-0.5 rounded"
                            >
                              {goal}
                            </span>
                          ))}
                        </div>
                      </div>
                      
                      <div className="mt-3">
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Session Notes:
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 whitespace-pre-wrap">
                          {note.narrative}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Add Session Note Modal */}
      <AddSessionNoteModal
        isOpen={isAddNoteModalOpen}
        onClose={() => setIsAddNoteModalOpen(false)}
        onSubmit={handleAddSessionNote}
        clientId={client.id}
        therapists={therapists}
        selectedAuth={selectedAuth || undefined}
      />
    </div>
  );
}