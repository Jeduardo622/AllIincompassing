import React, { useState } from 'react';
import { format, parseISO, addDays } from 'date-fns';
import { 
  // MapPin, 
  Clock, AlertCircle, Calendar, ArrowRight, Car, 
  User, X, ChevronLeft, ChevronRight 
} from 'lucide-react';
import type { Therapist, Client, Session } from '../types';
import { generateOptimalSchedule } from '../lib/autoSchedule';
import { getDistance } from 'geolib';
import { logger } from '../lib/logger/logger';

interface AutoScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSchedule: (sessions: Array<{
    therapist_id: string;
    client_id: string;
    start_time: string;
    end_time: string;
    status: 'scheduled';
  }>) => Promise<void>;
  therapists: Therapist[];
  clients: Client[];
  existingSessions: Session[];
}

export default function AutoScheduleModal({
  isOpen,
  onClose,
  onSchedule,
  therapists,
  clients,
  existingSessions,
}: AutoScheduleModalProps) {
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [numWeeks, setNumWeeks] = useState(1);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof generateOptimalSchedule>>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 5;

  const handleGeneratePreview = () => {
    const start = parseISO(startDate);
    const end = addDays(start, numWeeks * 7 - 1);
    const slots = generateOptimalSchedule(
      therapists,
      clients,
      existingSessions,
      start,
      end
    );
    setPreview(slots);
    setCurrentPage(0);
  };

  const handleSchedule = async () => {
    try {
      setLoading(true);
      const sessions = preview.map(slot => ({
        therapist_id: slot.therapist.id,
        client_id: slot.client.id,
        start_time: slot.startTime,
        end_time: slot.endTime,
        status: 'scheduled' as const,
      }));
      await onSchedule(sessions);
      onClose();
    } catch (error) {
      logger.error('Failed to auto schedule sessions', {
        error,
        context: { component: 'AutoScheduleModal', operation: 'handleSchedule' }
      });
    } finally {
      setLoading(false);
    }
  };

  const calculateTravelMetrics = (slot: ReturnType<typeof generateOptimalSchedule>[0]) => {
    if (!slot.therapist.latitude || !slot.therapist.longitude || !slot.client.latitude || !slot.client.longitude) {
      return null;
    }

    const distance = getDistance(
      { latitude: slot.therapist.latitude, longitude: slot.therapist.longitude },
      { latitude: slot.client.latitude, longitude: slot.client.longitude }
    ) / 1000;

    let travelTime = (distance / 30) * 60;
    const hour = new Date(slot.startTime).getHours();
    const isRushHour = (hour >= 8 && hour <= 9) || (hour >= 16 && hour <= 18);
    
    if (isRushHour) {
      travelTime *= 1.5;
    }

    return {
      distance: Math.round(distance * 10) / 10,
      travelTime: Math.round(travelTime),
      isRushHour
    };
  };

  const totalPages = Math.ceil(preview.length / itemsPerPage);
  const paginatedPreview = preview.slice(
    currentPage * itemsPerPage,
    (currentPage + 1) * itemsPerPage
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Auto Schedule Sessions
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Date Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Number of Weeks
              </label>
              <input
                type="number"
                min="1"
                max="12"
                value={numWeeks}
                onChange={(e) => setNumWeeks(parseInt(e.target.value, 10))}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-dark shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
              />
            </div>
          </div>

          <div className="flex justify-center">
            <button
              onClick={handleGeneratePreview}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Generate Preview
            </button>
          </div>

          {/* Preview Section */}
          {preview.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  Proposed Schedule ({preview.length} sessions)
                </h3>
                <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span>
                    Page {currentPage + 1} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage === totalPages - 1}
                    className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {paginatedPreview.map((slot, index) => {
                  const travelMetrics = calculateTravelMetrics(slot);
                  const startHour = new Date(slot.startTime).getHours();
                  const isRushHour = (startHour >= 8 && startHour <= 9) || (startHour >= 16 && startHour <= 18);
                  
                  return (
                    <div
                      key={index}
                      className="bg-white dark:bg-dark-lighter rounded-lg shadow p-4"
                    >
                      {/* Mobile Layout */}
                      <div className="block sm:hidden space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            <Calendar className="w-4 h-4 inline mr-1" />
                            {format(parseISO(slot.startTime), 'EEE, MMM d')}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-300">
                            <Clock className="w-4 h-4 inline mr-1" />
                            {format(parseISO(slot.startTime), 'h:mm a')}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center">
                            <User className="w-4 h-4 mr-2 text-blue-500" />
                            <div>
                              <div className="font-medium">{slot.therapist.full_name}</div>
                              <div className="text-xs text-gray-500">{slot.therapist.service_type.join(', ')}</div>
                            </div>
                          </div>

                          {travelMetrics && (
                            <div className="flex items-center justify-center text-xs text-gray-500">
                              <Car className="w-3 h-3 mr-1" />
                              {travelMetrics.distance}km ({travelMetrics.travelTime}min)
                              {isRushHour && (
                                <AlertCircle className="w-3 h-3 ml-1 text-amber-500" />
                              )}
                            </div>
                          )}

                          <div className="flex items-center">
                            <User className="w-4 h-4 mr-2 text-green-500" />
                            <div>
                              <div className="font-medium">{slot.client.full_name}</div>
                              <div className="text-xs text-gray-500">{slot.client.service_preference.join(', ')}</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Desktop Layout */}
                      <div className="hidden sm:block">
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-white flex items-center">
                              <User className="w-4 h-4 mr-2 text-blue-500" />
                              {slot.therapist.full_name}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {slot.therapist.service_type.join(', ')}
                            </div>
                          </div>

                          <div className="text-center">
                            <div className="flex items-center justify-center text-gray-500 dark:text-gray-400">
                              <ArrowRight className="w-4 h-4" />
                              {travelMetrics && (
                                <div className="ml-2 flex items-center text-xs">
                                  <Car className="w-3 h-3 mr-1" />
                                  {travelMetrics.distance}km ({travelMetrics.travelTime}min)
                                  {isRushHour && (
                                    <AlertCircle className="w-3 h-3 ml-1 text-amber-500" title="Rush hour" />
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-white flex items-center justify-end">
                              <User className="w-4 h-4 mr-2 text-green-500" />
                              {slot.client.full_name}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 text-right">
                              {slot.client.service_preference.join(', ')}
                            </div>
                          </div>
                        </div>

                        <div className="mt-2 flex items-center justify-between text-sm">
                          <div className="flex items-center text-gray-600 dark:text-gray-300">
                            <Calendar className="w-4 h-4 mr-1" />
                            {format(parseISO(slot.startTime), 'EEEE, MMMM d')}
                          </div>
                          <div className="flex items-center text-gray-600 dark:text-gray-300">
                            <Clock className="w-4 h-4 mr-1" />
                            {format(parseISO(slot.startTime), 'h:mm a')} - 
                            {format(parseISO(slot.endTime), 'h:mm a')}
                          </div>
                        </div>
                      </div>

                      {/* Common Footer */}
                      <div className="mt-2 flex items-center">
                        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                          <div 
                            className="bg-blue-600 h-1.5 rounded-full" 
                            style={{ width: `${slot.score * 100}%` }}
                          />
                        </div>
                        <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                          {Math.round(slot.score * 100)}% match
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              Generate a preview to see proposed sessions
            </div>
          )}
        </div>

        {/* Footer */}
        {preview.length > 0 && (
          <div className="border-t dark:border-gray-700 p-4">
            <div className="flex justify-end space-x-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedule}
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Scheduling...' : 'Schedule All Sessions'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}