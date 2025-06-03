import React, { useState } from 'react';
import { CheckCircle, AlertTriangle, RefreshCw, X } from 'lucide-react';
import type { Note } from '../types';

interface AddGeneralNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (note: Omit<Note, 'id' | 'created_at' | 'author'>) => void;
  currentUser?: string;
}

export default function AddGeneralNoteModal({
  isOpen,
  onClose,
  onSubmit,
  currentUser = 'Current User'
}: AddGeneralNoteModalProps) {
  const [noteContent, setNoteContent] = useState('');
  const [isVisibleToParent, setIsVisibleToParent] = useState(false);
  const [noteStatus, setNoteStatus] = useState<'resolved' | 'open' | 'follow-up'>('open');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!noteContent.trim()) return;
    
    onSubmit({
      content: noteContent,
      is_visible_to_parent: isVisibleToParent,
      status: noteStatus
    });
    
    // Reset form
    setNoteContent('');
    setIsVisibleToParent(false);
    setNoteStatus('open');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Add Note
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
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
              id="visible-to-parent"
              checked={isVisibleToParent}
              onChange={(e) => setIsVisibleToParent(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="visible-to-parent" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
              Visible to parent
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
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!noteContent.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Note
          </button>
        </div>
      </div>
    </div>
  );
}