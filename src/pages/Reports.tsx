import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  BarChart, 
  FileText, 
  Download, 
  Calendar, 
  Filter, 
  Users, 
  Clock, 
  PieChart,
  TrendingUp,
  Layers,
  RefreshCw
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { supabase } from '../lib/supabase';
import { showError } from '../lib/toast';
import { useDebounce } from '../lib/performance';
import { CACHE_STRATEGIES, generateCacheKey } from './cacheStrategy';
import { useDropdownData, useSessionMetrics } from '../lib/optimizedQueries';

// Report types
type ReportType = 'sessions' | 'clients' | 'therapists' | 'authorizations' | 'billing';

// Filter options
interface ReportFilters {
  dateRange: 'current_month' | 'last_month' | 'last_3_months' | 'last_6_months' | 'custom';
  startDate: string;
  endDate: string;
  therapistId?: string;
  clientId?: string;
  status?: string;
  serviceType?: string;
}

interface SessionData {
  id: string;
  start_time: string;
  status: string;
  therapist: { id: string; full_name: string } | null;
  client: { id: string; full_name: string } | null;
}

interface ReportData {
  totalSessions?: number;
  completedSessions?: number;
  cancelledSessions?: number;
  noShowSessions?: number;
  completionRate?: number;
  sessionsByTherapist?: Record<string, number>;
  sessionsByClient?: Record<string, number>;
  sessionsByDayOfWeek?: Record<string, number>;
  rawData?: SessionData[];
}

// Memoized report sections
const ReportMetrics = React.memo(({ 
  totalSessions = 0, 
  completedSessions = 0, 
  cancelledSessions = 0, 
  noShowSessions = 0 
}: {
  totalSessions?: number;
  completedSessions?: number;
  cancelledSessions?: number;
  noShowSessions?: number;
}) => (
  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
    <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow">
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Sessions</h3>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalSessions}</p>
    </div>
    
    <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow">
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Completed</h3>
      <p className="text-2xl font-bold text-green-600 dark:text-green-400">{completedSessions}</p>
    </div>
    
    <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow">
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Cancelled</h3>
      <p className="text-2xl font-bold text-red-600 dark:text-red-400">{cancelledSessions}</p>
    </div>
    
    <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow">
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">No Shows</h3>
      <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{noShowSessions}</p>
    </div>
  </div>
));

ReportMetrics.displayName = 'ReportMetrics';

const Reports = React.memo(() => {
  const [reportType, setReportType] = useState<ReportType>('sessions');
  const [filters, setFilters] = useState<ReportFilters>({
    dateRange: 'current_month',
    startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);

  // Debounce filter changes to prevent excessive API calls
  const debouncedFilters = useDebounce(filters, 300);

  // PHASE 3 OPTIMIZATION: Use optimized dropdown data with smart caching
  const { data: dropdownData } = useDropdownData();

  const therapists = dropdownData?.therapists || [];
  const clients = dropdownData?.clients || [];

  // PHASE 3 OPTIMIZATION: Use optimized session metrics RPC function
  const { data: sessionMetricsData, isLoading: isLoadingMetrics } = useSessionMetrics(
    debouncedFilters.startDate,
    debouncedFilters.endDate,
    debouncedFilters.therapistId,
    debouncedFilters.clientId
  );

  // Fallback function for session report generation
  const generateSessionsReport = useCallback(async (): Promise<ReportData> => {
    let query = supabase
      .from('sessions')
      .select(`
        *,
        therapist:therapists(id, full_name),
        client:clients(id, full_name)
      `)
      .gte('start_time', `${debouncedFilters.startDate}T00:00:00`)
      .lte('start_time', `${debouncedFilters.endDate}T23:59:59`);
    
    if (debouncedFilters.therapistId) {
      query = query.eq('therapist_id', debouncedFilters.therapistId);
    }
    
    if (debouncedFilters.clientId) {
      query = query.eq('client_id', debouncedFilters.clientId);
    }
    
    if (debouncedFilters.status) {
      query = query.eq('status', debouncedFilters.status);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    const sessions = data || [];
    
    // Optimized calculations
    const totalSessions = sessions.length;
    const completedSessions = sessions.filter(s => s.status === 'completed').length;
    const cancelledSessions = sessions.filter(s => s.status === 'cancelled').length;
    const noShowSessions = sessions.filter(s => s.status === 'no-show').length;
    
    // Use reduce with proper typing
    const sessionsByTherapist = sessions.reduce((acc, session) => {
      const therapistName = session.therapist?.full_name || 'Unknown';
      acc[therapistName] = (acc[therapistName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const sessionsByClient = sessions.reduce((acc, session) => {
      const clientName = session.client?.full_name || 'Unknown';
      acc[clientName] = (acc[clientName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const sessionsByDayOfWeek = sessions.reduce((acc, session) => {
      const date = new Date(session.start_time);
      const dayOfWeek = format(date, 'EEEE');
      acc[dayOfWeek] = (acc[dayOfWeek] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      totalSessions,
      completedSessions,
      cancelledSessions,
      noShowSessions,
      completionRate: totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0,
      sessionsByTherapist,
      sessionsByClient,
      sessionsByDayOfWeek,
      rawData: sessions
    };
  }, [debouncedFilters]);

  // PHASE 3 OPTIMIZATION: Memoized callbacks to prevent unnecessary re-renders
  const handleGenerateReport = useCallback(async () => {
    setIsGenerating(true);
    setReportData(null);
    
    try {
      let data: ReportData | null = null;
      
      switch (reportType) {
        case 'sessions':
          // Use optimized session metrics if available
          if (sessionMetricsData) {
            data = sessionMetricsData;
          } else {
            data = await generateSessionsReport();
          }
          break;
        default:
          // For demo purposes, using sessions data for all report types
          data = await generateSessionsReport();
          break;
      }
      
      setReportData(data);
    } catch (error) {
      console.error('Error generating report:', error);
      showError('Failed to generate report');
    } finally {
      setIsGenerating(false);
    }
  }, [reportType, sessionMetricsData, generateSessionsReport]);

  // Memoized date range update effect
  const updateDateRange = useCallback(() => {
    let startDate, endDate;
    
    switch (filters.dateRange) {
      case 'current_month':
        startDate = startOfMonth(new Date());
        endDate = endOfMonth(new Date());
        break;
      case 'last_month':
        startDate = startOfMonth(subMonths(new Date(), 1));
        endDate = endOfMonth(subMonths(new Date(), 1));
        break;
      case 'last_3_months':
        startDate = startOfMonth(subMonths(new Date(), 2));
        endDate = endOfMonth(new Date());
        break;
      case 'last_6_months':
        startDate = startOfMonth(subMonths(new Date(), 5));
        endDate = endOfMonth(new Date());
        break;
      case 'custom':
        return; // Keep existing dates
      default:
        startDate = startOfMonth(new Date());
        endDate = endOfMonth(new Date());
    }
    
    setFilters(prev => ({
      ...prev,
      startDate: format(startDate, 'yyyy-MM-dd'),
      endDate: format(endDate, 'yyyy-MM-dd'),
    }));
  }, [filters.dateRange]);

  // Use effect with proper dependencies
  useEffect(() => {
    updateDateRange();
  }, [updateDateRange]);

  // Memoized CSV export function
  const exportToCsv = useCallback(() => {
    if (!reportData?.rawData) return;
    
    const rawData = reportData.rawData;
    if (rawData.length === 0) return;
    
    const headers = Object.keys(rawData[0]).filter(key => typeof rawData[0][key] !== 'object');
    
    let csvContent = headers.join(',') + '\n';
    
    rawData.forEach(item => {
      const row = headers.map(header => {
        const value = item[header];
        if (Array.isArray(value)) {
          return `"${value.join(';')}"`;
        } else if (value instanceof Date) {
          return value.toISOString();
        } else if (typeof value === 'string') {
          return `"${value.replace(/"/g, '""')}"`;
        } else {
          return value;
        }
      }).join(',');
      
      csvContent += row + '\n';
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${reportType}_report_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [reportData, reportType]);

  // Memoized report content
  const reportContent = useMemo(() => {
    if (!reportData) return null;
    
    const { 
      totalSessions = 0, 
      completedSessions = 0, 
      cancelledSessions = 0, 
      noShowSessions = 0,
      completionRate = 0
    } = reportData;
    
    return (
      <div className="space-y-6">
        <ReportMetrics 
          totalSessions={totalSessions} 
          completedSessions={completedSessions} 
          cancelledSessions={cancelledSessions} 
          noShowSessions={noShowSessions} 
        />
        
        <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Completion Rate</h3>
          <div className="flex items-center">
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4">
              <div 
                className={`h-4 rounded-full ${
                  completionRate >= 80 ? 'bg-green-600' : 
                  completionRate >= 60 ? 'bg-yellow-600' : 
                  'bg-red-600'
                }`}
                style={{ width: `${completionRate}%` }}
              ></div>
            </div>
            <span className="ml-4 text-lg font-medium text-gray-900 dark:text-white">
              {completionRate.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
    );
  }, [reportData]);

  return (
    <div className="h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports</h1>
        
        {reportData && (
          <button
            onClick={exportToCsv}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 flex items-center"
          >
            <Download className="w-4 h-4 mr-2" />
            Export to CSV
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow mb-6">
        <div className="p-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Report Settings</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Report Type
              </label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value as ReportType)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              >
                <option value="sessions">Sessions Report</option>
                <option value="clients">Clients Report</option>
                <option value="therapists">Therapists Report</option>
                <option value="authorizations">Authorizations Report</option>
                <option value="billing">Billing Report</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <Calendar className="w-4 h-4 inline mr-1" />
                Date Range
              </label>
              <select
                value={filters.dateRange}
                onChange={(e) => setFilters({...filters, dateRange: e.target.value as any})}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              >
                <option value="current_month">Current Month</option>
                <option value="last_month">Last Month</option>
                <option value="last_3_months">Last 3 Months</option>
                <option value="last_6_months">Last 6 Months</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            
            {filters.dateRange === 'custom' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Start Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="date"
                      value={filters.startDate}
                      onChange={(e) => setFilters({...filters, startDate: e.target.value})}
                      className="w-full pl-10 rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    End Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="date"
                      value={filters.endDate}
                      onChange={(e) => setFilters({...filters, endDate: e.target.value})}
                      className="w-full pl-10 rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                  </div>
                </div>
              </>
            )}
            
            {(reportType === 'sessions' || reportType === 'authorizations') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Therapist
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <select
                    value={filters.therapistId || ''}
                    onChange={(e) => setFilters({...filters, therapistId: e.target.value || undefined})}
                    className="w-full pl-10 rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  >
                    <option value="">All Therapists</option>
                    {therapists.map(therapist => (
                      <option key={therapist.id} value={therapist.id}>
                        {therapist.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            
            {(reportType === 'sessions' || reportType === 'authorizations' || reportType === 'billing') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Client
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <select
                    value={filters.clientId || ''}
                    onChange={(e) => setFilters({...filters, clientId: e.target.value || undefined})}
                    className="w-full pl-10 rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  >
                    <option value="">All Clients</option>
                    {clients.map(client => (
                      <option key={client.id} value={client.id}>
                        {client.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            
            {reportType === 'sessions' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Status
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <select
                    value={filters.status || ''}
                    onChange={(e) => setFilters({...filters, status: e.target.value || undefined})}
                    className="w-full pl-10 rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  >
                    <option value="">All Statuses</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="no-show">No Show</option>
                  </select>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex justify-end">
            <button
              onClick={handleGenerateReport}
              disabled={isGenerating}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 flex items-center"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <BarChart className="w-4 h-4 mr-2" />
                  Generate Report
                </>
              )}
            </button>
          </div>
        </div>
        
        {isGenerating ? (
          <div className="p-8 flex justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : reportData ? (
          <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {reportType === 'sessions' && 'Sessions Report'}
                {reportType === 'clients' && 'Clients Report'}
                {reportType === 'therapists' && 'Therapists Report'}
                {reportType === 'authorizations' && 'Authorizations Report'}
                {reportType === 'billing' && 'Billing Report'}
              </h2>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {format(new Date(filters.startDate), 'MMM d, yyyy')} - {format(new Date(filters.endDate), 'MMM d, yyyy')}
              </div>
            </div>
            
            {reportContent}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <BarChart className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <p>Select report parameters and click "Generate Report" to view data</p>
          </div>
        )}
      </div>
    </div>
  );
});

Reports.displayName = 'Reports';

export default Reports;