import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BarChart, TrendingUp, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';

export default function ReportsSummary() {
  // Get current month date range
  const startDate = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const endDate = format(endOfMonth(new Date()), 'yyyy-MM-dd');
  
  // Get last month date range for comparison
  const lastMonthStart = format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd');
  const lastMonthEnd = format(endOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd');

  // Fetch current month sessions
  const { data: currentSessions = [] } = useQuery({
    queryKey: ['sessions', 'current-month'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .gte('start_time', `${startDate}T00:00:00`)
        .lte('start_time', `${endDate}T23:59:59`);
      
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch last month sessions for comparison
  const { data: lastSessions = [] } = useQuery({
    queryKey: ['sessions', 'last-month'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .gte('start_time', `${lastMonthStart}T00:00:00`)
        .lte('start_time', `${lastMonthEnd}T23:59:59`);
      
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch clients
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*');
      
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch therapists
  const { data: therapists = [] } = useQuery({
    queryKey: ['therapists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('therapists')
        .select('*');
      
      if (error) throw error;
      return data || [];
    },
  });

  // Calculate metrics
  const totalSessions = currentSessions.length;
  const lastMonthSessions = lastSessions.length;
  const sessionChange = lastMonthSessions > 0 
    ? ((totalSessions - lastMonthSessions) / lastMonthSessions) * 100 
    : 100;
  
  const completedSessions = currentSessions.filter(s => s.status === 'completed').length;
  const lastMonthCompleted = lastSessions.filter(s => s.status === 'completed').length;
  const completionChange = lastMonthCompleted > 0 
    ? ((completedSessions - lastMonthCompleted) / lastMonthCompleted) * 100 
    : 100;
  
  const activeClients = new Set(currentSessions.map(s => s.client_id)).size;
  const lastMonthActiveClients = new Set(lastSessions.map(s => s.client_id)).size;
  const clientChange = lastMonthActiveClients > 0 
    ? ((activeClients - lastMonthActiveClients) / lastMonthActiveClients) * 100 
    : 100;
  
  const activeTherapists = new Set(currentSessions.map(s => s.therapist_id)).size;
  const lastMonthActiveTherapists = new Set(lastSessions.map(s => s.therapist_id)).size;
  const therapistChange = lastMonthActiveTherapists > 0 
    ? ((activeTherapists - lastMonthActiveTherapists) / lastMonthActiveTherapists) * 100 
    : 100;

  return (
    <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
          <BarChart className="w-5 h-5 mr-2 text-blue-600" />
          Monthly Report Summary
        </h2>
        <Link 
          to="/reports" 
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center"
        >
          View Full Reports
          <ArrowRight className="w-4 h-4 ml-1" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-medium text-blue-700 dark:text-blue-300">Total Sessions</h3>
            <span className={`text-xs font-medium ${
              sessionChange >= 0 
                ? 'text-green-600 dark:text-green-400' 
                : 'text-red-600 dark:text-red-400'
            }`}>
              <TrendingUp className="w-3 h-3 inline mr-1" />
              {sessionChange.toFixed(1)}%
            </span>
          </div>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{totalSessions}</p>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            vs {lastMonthSessions} last month
          </p>
        </div>

        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-medium text-green-700 dark:text-green-300">Completed Sessions</h3>
            <span className={`text-xs font-medium ${
              completionChange >= 0 
                ? 'text-green-600 dark:text-green-400' 
                : 'text-red-600 dark:text-red-400'
            }`}>
              <TrendingUp className="w-3 h-3 inline mr-1" />
              {completionChange.toFixed(1)}%
            </span>
          </div>
          <p className="text-2xl font-bold text-green-700 dark:text-green-300">{completedSessions}</p>
          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
            vs {lastMonthCompleted} last month
          </p>
        </div>

        <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-medium text-purple-700 dark:text-purple-300">Active Clients</h3>
            <span className={`text-xs font-medium ${
              clientChange >= 0 
                ? 'text-green-600 dark:text-green-400' 
                : 'text-red-600 dark:text-red-400'
            }`}>
              <TrendingUp className="w-3 h-3 inline mr-1" />
              {clientChange.toFixed(1)}%
            </span>
          </div>
          <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">{activeClients}</p>
          <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
            of {clients.length} total clients
          </p>
        </div>

        <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-medium text-amber-700 dark:text-amber-300">Active Therapists</h3>
            <span className={`text-xs font-medium ${
              therapistChange >= 0 
                ? 'text-green-600 dark:text-green-400' 
                : 'text-red-600 dark:text-red-400'
            }`}>
              <TrendingUp className="w-3 h-3 inline mr-1" />
              {therapistChange.toFixed(1)}%
            </span>
          </div>
          <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{activeTherapists}</p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            of {therapists.length} total therapists
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Session Status Distribution</h3>
          <div className="flex h-4 rounded-full overflow-hidden">
            <div 
              className="bg-green-500" 
              style={{ width: `${(completedSessions / totalSessions) * 100}%` }}
              title={`Completed: ${completedSessions}`}
            ></div>
            <div 
              className="bg-yellow-500" 
              style={{ width: `${(currentSessions.filter(s => s.status === 'scheduled').length / totalSessions) * 100}%` }}
              title={`Scheduled: ${currentSessions.filter(s => s.status === 'scheduled').length}`}
            ></div>
            <div 
              className="bg-red-500" 
              style={{ width: `${(currentSessions.filter(s => s.status === 'cancelled').length / totalSessions) * 100}%` }}
              title={`Cancelled: ${currentSessions.filter(s => s.status === 'cancelled').length}`}
            ></div>
            <div 
              className="bg-gray-500" 
              style={{ width: `${(currentSessions.filter(s => s.status === 'no-show').length / totalSessions) * 100}%` }}
              title={`No-show: ${currentSessions.filter(s => s.status === 'no-show').length}`}
            ></div>
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-1"></span>
              Completed
            </span>
            <span className="flex items-center">
              <span className="w-2 h-2 bg-yellow-500 rounded-full mr-1"></span>
              Scheduled
            </span>
            <span className="flex items-center">
              <span className="w-2 h-2 bg-red-500 rounded-full mr-1"></span>
              Cancelled
            </span>
            <span className="flex items-center">
              <span className="w-2 h-2 bg-gray-500 rounded-full mr-1"></span>
              No-show
            </span>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Sessions by Day of Week</h3>
          <div className="space-y-2">
            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => {
              const count = currentSessions.filter(s => {
                const sessionDate = new Date(s.start_time);
                return format(sessionDate, 'EEEE') === day;
              }).length;
              
              return (
                <div key={day} className="flex items-center">
                  <span className="text-xs text-gray-500 dark:text-gray-400 w-20">{day}</span>
                  <div className="flex-1 mx-2">
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full" 
                        style={{ width: `${(count / Math.max(...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(d => 
                          currentSessions.filter(s => format(new Date(s.start_time), 'EEEE') === d).length
                        ))) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}