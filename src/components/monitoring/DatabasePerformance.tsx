import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Zap, AlertTriangle, Table } from 'lucide-react';
import MetricCard from './MetricCard';
import TimeSeriesChart from "./TimeSeriesChart";
import { AlertsList } from './AlertsList';
import { supabase } from '../../lib/supabase';
import type { DatabaseMetric, SlowQuery, Alert } from '../../types';

export function DatabasePerformance() {
  const queryClient = useQueryClient();

  // Fetch database metrics
  const { data: metrics } = useQuery<DatabaseMetric[]>({
    queryKey: ['database-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('db_performance_metrics')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch slow queries
  const { data: slowQueries } = useQuery<SlowQuery[]>({
    queryKey: ['slow-queries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('db_performance_metrics')
        .select('id, table_name, execution_time_ms, timestamp')
        .eq('slow_query', true)
        .order('execution_time_ms', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      // Transform the data to match SlowQuery interface
      return (data || []).map(item => ({
        ...item,
        query: `Query on ${item.table_name || 'unknown table'}` // Since we don't store actual query text
      }));
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch alerts
  const { data: alerts } = useQuery<Alert[]>({
    queryKey: ['database-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('performance_alerts')
        .select('*')
        .ilike('alert_type', '%database%')
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });

  // Mutation to resolve alerts
  const resolveAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from('performance_alerts')
        .update({ 
          resolved: true, 
          resolved_at: new Date().toISOString() 
        })
        .eq('id', alertId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['database-alerts'] });
    },
  });

  // Calculate key metrics
  const avgQueryTime = React.useMemo(() => {
    if (!metrics || !metrics.length) return 0;
    const total = metrics.reduce((sum, m) => sum + (m.execution_time_ms || 0), 0);
    return total / metrics.length;
  }, [metrics]);

  const cacheHitRate = React.useMemo(() => {
    if (!metrics || !metrics.length) return 0;
    const hits = metrics.filter(m => m.cache_hit).length;
    return (hits / metrics.length) * 100;
  }, [metrics]);

  const slowQueryCount = React.useMemo(() => {
    return slowQueries?.length || 0;
  }, [slowQueries]);

  // Prepare chart data
  const queryTimeData = React.useMemo(() => {
    if (!metrics || !metrics.length) return {
      labels: [],
      datasets: [{
        label: 'Execution Time (ms)',
        data: [],
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
      }]
    };

    // Sort metrics by timestamp
    const sortedMetrics = [...metrics].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return {
      labels: sortedMetrics.map(m => new Date(m.timestamp).toLocaleTimeString()),
      datasets: [{
        label: 'Execution Time (ms)',
        data: sortedMetrics.map(m => m.execution_time_ms || 0),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
      }]
    };
  }, [metrics]);

  const queryTypeData = React.useMemo(() => {
    if (!metrics || !metrics.length) return {
      labels: [],
      datasets: [{
        label: 'Query Count',
        data: [],
        backgroundColor: [
          'rgba(59, 130, 246, 0.5)',
          'rgba(16, 185, 129, 0.5)',
          'rgba(139, 92, 246, 0.5)',
          'rgba(249, 115, 22, 0.5)',
        ],
      }]
    };

    // Count queries by type
    const queryTypes = new Map<string, number>();
    metrics.forEach(m => {
      const type = m.query_type || 'Unknown';
      queryTypes.set(type, (queryTypes.get(type) || 0) + 1);
    });

    return {
      labels: Array.from(queryTypes.keys()),
      datasets: [{
        label: 'Query Count',
        data: Array.from(queryTypes.values()),
        backgroundColor: [
          'rgba(59, 130, 246, 0.5)',
          'rgba(16, 185, 129, 0.5)',
          'rgba(139, 92, 246, 0.5)',
          'rgba(249, 115, 22, 0.5)',
        ],
      }]
    };
  }, [metrics]);

  const cacheHitData = React.useMemo(() => {
    if (!metrics || !metrics.length) return {
      labels: [],
      datasets: [{
        label: 'Cache Hit Rate',
        data: [],
        borderColor: 'rgb(139, 92, 246)',
        backgroundColor: 'rgba(139, 92, 246, 0.5)',
      }]
    };

    // Group metrics by hour and calculate cache hit rate for each hour
    const cacheHitsByHour = new Map<string, { hits: number; total: number }>();
    
    metrics.forEach(m => {
      const hour = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit' });
      if (!cacheHitsByHour.has(hour)) {
        cacheHitsByHour.set(hour, { hits: 0, total: 0 });
      }
      const hourStats = cacheHitsByHour.get(hour)!;
      hourStats.total += 1;
      if (m.cache_hit) {
        hourStats.hits += 1;
      }
    });

    // Convert to arrays for the chart
    const hours = Array.from(cacheHitsByHour.keys()).sort();
    const hitRates = hours.map(hour => {
      const { hits, total } = cacheHitsByHour.get(hour)!;
      return (hits / total) * 100;
    });

    return {
      labels: hours,
      datasets: [{
        label: 'Cache Hit Rate (%)',
        data: hitRates,
        borderColor: 'rgb(139, 92, 246)',
        backgroundColor: 'rgba(139, 92, 246, 0.5)',
      }]
    };
  }, [metrics]);

  // Calculate metrics for slow queries
  const slowQueriesData = React.useMemo(() => {
    if (!slowQueries || !slowQueries.length) return {
      labels: [],
      datasets: [{
        label: 'Execution Time (ms)',
        data: [],
        backgroundColor: 'rgba(239, 68, 68, 0.5)',
      }]
    };

    // Get top 5 slowest queries
    const top5Queries = [...slowQueries].slice(0, 5);

    return {
      labels: top5Queries.map(q => q.table_name || 'Unknown'),
      datasets: [{
        label: 'Execution Time (ms)',
        data: top5Queries.map(q => q.execution_time_ms || 0),
        backgroundColor: 'rgba(239, 68, 68, 0.5)',
      }]
    };
  }, [slowQueries]);

  // Calculate query type distribution
  const tableHitDistribution = React.useMemo(() => {
    if (!metrics || !metrics.length) return {
      labels: [],
      datasets: [{
        label: 'Queries by Table',
        data: [],
        backgroundColor: [
          'rgba(59, 130, 246, 0.5)',
          'rgba(16, 185, 129, 0.5)',
          'rgba(139, 92, 246, 0.5)',
          'rgba(249, 115, 22, 0.5)',
          'rgba(236, 72, 153, 0.5)',
        ],
        borderWidth: 0,
      }]
    };

    // Count queries by table
    const tableHits = new Map<string, number>();
    metrics.forEach(m => {
      const table = m.table_name || 'Unknown';
      tableHits.set(table, (tableHits.get(table) || 0) + 1);
    });

    // Sort by hit count (descending)
    const sortedTables = Array.from(tableHits.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      labels: sortedTables.map(([table]) => table),
      datasets: [{
        label: 'Queries by Table',
        data: sortedTables.map(([_, count]) => count),
        backgroundColor: [
          'rgba(59, 130, 246, 0.5)',
          'rgba(16, 185, 129, 0.5)',
          'rgba(139, 92, 246, 0.5)',
          'rgba(249, 115, 22, 0.5)',
          'rgba(236, 72, 153, 0.5)',
        ],
        borderWidth: 0,
      }]
    };
  }, [metrics]);

  return (
    <div className="space-y-6">
      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Avg Query Time"
          value={`${Math.round(avgQueryTime)} ms`}
          icon={<Clock className="h-5 w-5 text-blue-600" />}
          trend={metrics && metrics.length > 1 ? {
            value: ((metrics[0].execution_time_ms || 0) - (metrics[metrics.length - 1].execution_time_ms || 0)) / 
                   Math.max((metrics[metrics.length - 1].execution_time_ms || 1), 1) * 100,
            isPositive: (metrics[0].execution_time_ms || 0) < (metrics[metrics.length - 1].execution_time_ms || 0)
          } : undefined}
        />
        <MetricCard
          title="Cache Hit Rate"
          value={`${Math.round(cacheHitRate)}%`}
          icon={<Zap className="h-5 w-5 text-green-600" />}
          trend={{
            value: 3.5, // Mock trend for demo
            isPositive: true
          }}
        />
        <MetricCard
          title="Slow Queries"
          value={slowQueryCount}
          icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
          trend={metrics && metrics.length > 1 ? {
            value: -10, // Mock trend for demo
            isPositive: true
          } : undefined}
        />
        <MetricCard
          title="Total Tables Used"
          value={tableHitDistribution.labels.length}
          icon={<Table className="h-5 w-5 text-indigo-600" />}
        />
      </div>

      {/* Time Series Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <TimeSeriesChart 
            title="Query Execution Time (ms)" 
            data={queryTimeData} 
          />
        </div>
        <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <TimeSeriesChart 
            title="Cache Hit Rate (%)" 
            data={cacheHitData} 
          />
        </div>
      </div>

      {/* Additional Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
            Top 5 Slowest Queries by Table
          </h3>
          {slowQueries && slowQueries.length > 0 ? (
            <div className="space-y-2">
              {slowQueries.slice(0, 5).map((query, index) => (
                <div key={index} className="flex items-center">
                  <div className="w-2/5 truncate text-sm text-gray-600 dark:text-gray-400">
                    {query.table_name || 'Unknown'}
                  </div>
                  <div className="w-3/5 pl-2">
                    <div className="relative pt-1">
                      <div className="overflow-hidden h-2 mb-1 text-xs flex rounded bg-gray-200 dark:bg-gray-700">
                        <div
                          className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-red-500"
                          style={{ width: `${Math.min(100, query.execution_time_ms / 10)}%` }}
                        ></div>
                      </div>
                      <div className="text-xs text-right text-gray-500 dark:text-gray-400">
                        {query.execution_time_ms} ms
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-500 dark:text-gray-400">No slow queries recorded</p>
          )}
        </div>
        <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
            Query Type Distribution
          </h3>
          <TimeSeriesChart 
            title="" 
            data={queryTypeData} 
            height={200}
          />
        </div>
      </div>

      {/* Alerts Section */}
      <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
          Database Performance Alerts
        </h3>
        <AlertsList 
          alerts={alerts || []} 
          onResolve={(alertId) => resolveAlertMutation.mutate(alertId)}
        />
      </div>
    </div>
  );
}

export default DatabasePerformance;