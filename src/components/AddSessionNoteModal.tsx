import React, { useState } from 'react';
import { X, Calendar, Clock, FileText, CheckCircle } from 'lucide-react';
import type { SessionNote, Therapist } from '../types';

interface AddSessionNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (note: Omit<SessionNote, 'id'>) => void;
  clientId: string;
  therapists: Therapist[];
  selectedAuth?: string;
}

export default function AddSessionNoteModal({
  isOpen,
  onClose,
  onSubmit,
  clientId,
  therapists,
  selectedAuth
}: AddSessionNoteModalProps) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [serviceCode, setServiceCode] = useState('97153');
  const [therapistId, setTherapistId] = useState('');
  const [goalsAddressed, setGoalsAddressed] = useState<string[]>(['']);
  const [narrative, setNarrative] = useState('');
  const [isLocked, setIsLocked] = useState(false);

  if (!isOpen) return null;

  const handleAddGoal = () => {
    setGoalsAddressed([...goalsAddressed, '']);
  };

  const handleGoalChange = (index: number, value: string) => {
    const updatedGoals = [...goalsAddressed];
    updatedGoals[index] = value;
    setGoalsAddressed(updatedGoals);
  };

  const handleRemoveGoal = (index: number) => {
    const updatedGoals = [...goalsAddressed];
    updatedGoals.splice(index, 1);
    setGoalsAddressed(updatedGoals);
  };

  const handleSubmit = () => {
    // Filter out empty goals
    const filteredGoals = goalsAddressed.filter(goal => goal.trim() !== '');
    
    if (!date || !startTime || !endTime || !serviceCode || !therapistId || !narrative.trim() || filteredGoals.length === 0) {
      alert('Please fill in all required fields');
      return;
    }
    
    const selectedTherapist = therapists.find(t => t.id === therapistId);
    
    onSubmit({
      date,
      start_time: startTime,
      end_time: endTime,
      service_code: serviceCode,
      therapist_id: therapistId,
      therapist_name: selectedTherapist?.full_name || 'Unknown Therapist',
      goals_addressed: filteredGoals,
      narrative,
      is_locked: isLocked,
      client_id: clientId
    });
    
    // Reset form
    setDate(new Date().toISOString().split('T')[0]);
    setStartTime('09:00');
    setEndTime('10:00');
    setServiceCode('97153');
    setTherapistId('');
    setGoalsAddressed(['']);
    setNarrative('');
    setIsLocked(false);
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <Calendar className="w-4 h-4 inline-block mr-1" />
                Session Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <FileText className="w-4 h-4 inline-block mr-1" />
                Service Code
              </label>
              <select
                value={serviceCode}
                onChange={(e) => setServiceCode(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                required
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <Clock className="w-4 h-4 inline-block mr-1" />
                Start Time
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <Clock className="w-4 h-4 inline-block mr-1" />
                End Time
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                required
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Therapist
            </label>
            <select
              value={therapistId}
              onChange={(e) => setTherapistId(e.target.value)}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              required
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Goals Addressed
            </label>
            {goalsAddressed.map((goal, index) => (
              <div key={index} className="flex items-center mb-2">
                <input
                  type="text"
                  value={goal}
                  onChange={(e) => handleGoalChange(index, e.target.value)}
                  className="flex-1 rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  placeholder="Enter goal"
                  required
                />
                {goalsAddressed.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveGoal(index)}
                    className="ml-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={handleAddGoal}
              className="mt-1 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              + Add another goal
            </button>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Session Notes
            </label>
            <textarea
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              rows={5}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              placeholder="Enter detailed session notes..."
              required
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
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Save Note
          </button>
        </div>
      </div>
    </div>
  );
}