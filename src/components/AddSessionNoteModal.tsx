import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Calendar, Clock, FileText, CheckCircle } from 'lucide-react';
import type { Goal, Program, Therapist } from '../types';
import { useActiveOrganizationId } from '../lib/organization';
import { showError } from '../lib/toast';
import { supabase } from '../lib/supabase';

interface AddSessionNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (note: SessionNoteFormValues) => void;
  therapists: Therapist[];
  clientId: string;
  selectedAuth?: string;
  isSaving?: boolean;
}

export interface SessionNoteFormValues {
  date: string;
  start_time: string;
  end_time: string;
  service_code: string;
  therapist_id: string;
  therapist_name: string;
  goals_addressed: string[];
  goal_ids: string[];
  session_id?: string | null;
  narrative: string;
  is_locked: boolean;
}

export default function AddSessionNoteModal({
  isOpen,
  onClose,
  onSubmit,
  therapists,
  clientId,
  selectedAuth,
  isSaving = false
}: AddSessionNoteModalProps) {
  const organizationId = useActiveOrganizationId();
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [serviceCode, setServiceCode] = useState('97153');
  const [therapistId, setTherapistId] = useState('');
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedGoalIds, setSelectedGoalIds] = useState<string[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [narrative, setNarrative] = useState('');
  const [isLocked, setIsLocked] = useState(false);

  const { data: programs = [], isLoading: isLoadingPrograms } = useQuery({
    queryKey: ['client-programs', clientId, organizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!clientId || !organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('programs')
        .select('id, name, status, client_id')
        .eq('client_id', clientId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }
      return (data ?? []) as Program[];
    },
    enabled: Boolean(clientId && organizationId),
  });

  const resolvedProgramId = useMemo(() => {
    if (selectedProgramId) return selectedProgramId;
    return programs.find((program) => program.status === 'active')?.id ?? programs[0]?.id ?? '';
  }, [programs, selectedProgramId]);

  useEffect(() => {
    setSelectedGoalIds([]);
  }, [resolvedProgramId]);

  const { data: goals = [], isLoading: isLoadingGoals } = useQuery({
    queryKey: ['program-goals', resolvedProgramId, organizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!resolvedProgramId || !organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('goals')
        .select('id, title, status, program_id')
        .eq('program_id', resolvedProgramId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }
      return (data ?? []) as Goal[];
    },
    enabled: Boolean(resolvedProgramId && organizationId),
  });

  const availableGoals = useMemo(
    () => goals.filter((goal) => goal.status !== 'archived'),
    [goals],
  );

  const { data: sessions = [], isLoading: isLoadingSessions } = useQuery({
    queryKey: ['client-sessions', clientId, organizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!clientId || !organizationId) {
        return [];
      }
      const { data, error } = await supabase
        .from('sessions')
        .select('id, start_time, end_time, therapist:therapist_id(full_name)')
        .eq('client_id', clientId)
        .eq('organization_id', organizationId)
        .order('start_time', { ascending: false })
        .limit(50);

      if (error) {
        throw error;
      }
      return (data ?? []) as Array<{
        id: string;
        start_time: string;
        end_time: string;
        therapist: { full_name: string | null } | null;
      }>;
    },
    enabled: Boolean(clientId && organizationId),
  });

  const hasSessions = sessions.length > 0;

  const toggleGoalSelection = (goalId: string) => {
    setSelectedGoalIds((prev) =>
      prev.includes(goalId) ? prev.filter((id) => id !== goalId) : [...prev, goalId],
    );
  };

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setStartTime('09:00');
    setEndTime('10:00');
    setServiceCode('97153');
    setTherapistId('');
    setSelectedProgramId('');
    setSelectedGoalIds([]);
    setSelectedSessionId('');
    setNarrative('');
    setIsLocked(false);
  };

  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!selectedAuth) {
      showError('Select an authorization before adding a session note');
      return;
    }

    // Validate required fields
    if (!date) {
      showError('Session date is required');
      return;
    }
    
    if (!startTime) {
      showError('Start time is required');
      return;
    }
    
    if (!endTime) {
      showError('End time is required');
      return;
    }
    
    if (!serviceCode) {
      showError('Service code is required');
      return;
    }
    
    if (!therapistId) {
      showError('Therapist is required');
      return;
    }

    if (hasSessions && !selectedSessionId) {
      showError('Select a scheduled session to link this note.');
      return;
    }

    if (!resolvedProgramId) {
      showError('Select a program before choosing goals.');
      return;
    }

    if (availableGoals.length === 0) {
      showError('Add goals to the selected program before logging this note.');
      return;
    }

    if (selectedGoalIds.length === 0) {
      showError('Select at least one goal from the goals bank.');
      return;
    }

    if (!narrative.trim()) {
      showError('Session notes are required');
      return;
    }
    
    const selectedTherapist = therapists.find(t => t.id === therapistId);
    const selectedGoalTitles = availableGoals
      .filter((goal) => selectedGoalIds.includes(goal.id))
      .map((goal) => goal.title);

    onSubmit({
      date,
      start_time: startTime,
      end_time: endTime,
      service_code: serviceCode,
      therapist_id: therapistId,
      therapist_name: selectedTherapist?.full_name || 'Unknown Therapist',
      goals_addressed: selectedGoalTitles,
      goal_ids: selectedGoalIds,
      session_id: selectedSessionId || null,
      narrative,
      is_locked: isLocked
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Add Session Note
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="session-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <Calendar className="w-4 h-4 inline-block mr-1" />
                Session Date
              </label>
              <input
                id="session-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>
            
            <div>
              <label htmlFor="service-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <FileText className="w-4 h-4 inline-block mr-1" />
                Service Code
              </label>
              <select
                id="service-code"
                value={serviceCode}
                onChange={(e) => setServiceCode(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              >
                <option value="">Select service code</option>
                <option value="97151">97151 - Behavior identification assessment</option>
                <option value="97152">97152 - Behavior identification supporting assessment</option>
                <option value="97153">97153 - Adaptive behavior treatment by protocol</option>
                <option value="97154">97154 - Group adaptive behavior treatment by protocol</option>
                <option value="97155">97155 - Adaptive behavior treatment with protocol modification</option>
                <option value="97156">97156 - Family adaptive behavior treatment guidance</option>
                <option value="97157">97157 - Multiple-family group adaptive behavior treatment guidance</option>
                <option value="97158">97158 - Group adaptive behavior treatment with protocol modification</option>
              </select>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="start-time" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <Clock className="w-4 h-4 inline-block mr-1" />
                Start Time
              </label>
              <input
                id="start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>
            
            <div>
              <label htmlFor="end-time" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <Clock className="w-4 h-4 inline-block mr-1" />
                End Time
              </label>
              <input
                id="end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>
          </div>
          
          <div>
            <label htmlFor="therapist-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Therapist
            </label>
            <select
              id="therapist-select"
              value={therapistId}
              onChange={(e) => setTherapistId(e.target.value)}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            >
              <option value="">Select therapist</option>
              {therapists.map(therapist => (
                <option key={therapist.id} value={therapist.id}>
                  {therapist.full_name} - {therapist.title || 'Therapist'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="session-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Link to Session
            </label>
            <select
              id="session-select"
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              disabled={isLoadingSessions || !hasSessions}
            >
              <option value="">
                {isLoadingSessions ? 'Loading sessions...' : hasSessions ? 'Select a session' : 'No sessions available'}
              </option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {new Date(session.start_time).toLocaleDateString()} {new Date(session.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(session.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {session.therapist?.full_name ?? 'Therapist'}
                </option>
              ))}
            </select>
            {!hasSessions && !isLoadingSessions && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">
                No scheduled sessions found for this client.
              </p>
            )}
          </div>
          
          <div>
            <label htmlFor="program-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Program
            </label>
            <select
              id="program-select"
              value={resolvedProgramId}
              onChange={(e) => {
                setSelectedProgramId(e.target.value);
                setSelectedGoalIds([]);
              }}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              disabled={isLoadingPrograms || programs.length === 0}
            >
              <option value="">
                {isLoadingPrograms ? 'Loading programs...' : 'Select a program'}
              </option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </select>
            {programs.length === 0 && !isLoadingPrograms && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">
                No programs found for this client. Create one in Programs & Goals before logging.
              </p>
            )}
          </div>

          <div>
            <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Goals Addressed
            </p>
            {isLoadingGoals ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">Loading goals...</div>
            ) : availableGoals.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                No goals available for the selected program.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {availableGoals.map((goal) => (
                  <label key={goal.id} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={selectedGoalIds.includes(goal.id)}
                      onChange={() => toggleGoalSelection(goal.id)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span>{goal.title}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          
          <div>
            <label htmlFor="session-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Session Notes
            </label>
            <textarea
              id="session-notes"
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              rows={5}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              placeholder="Enter detailed session notes..."
            />
          </div>
          
          <div className="flex items-center">
            <input
              type="checkbox"
              id="is-locked"
              checked={isLocked}
              onChange={(e) => setIsLocked(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is-locked" className="ml-2 block text-sm text-gray-900 dark:text-gray-100 flex items-center">
              <CheckCircle className="w-4 h-4 mr-1 text-green-500" />
              Sign and lock note
            </label>
          </div>
        </div>
        
        <div className="flex justify-end space-x-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            {isSaving ? 'Saving…' : 'Save Note'}
          </button>
        </div>
      </div>
    </div>
  );
}