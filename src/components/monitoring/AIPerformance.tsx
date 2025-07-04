import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Clock, Zap, Server, BarChart3, LineChart } from 'lucide-react';
import MetricCard from './MetricCard';
import TimeSeriesChart from './TimeSeriesChart';
import AlertsList from './AlertsList';

export default function AIPerformance() {
  const queryClient = useQueryClient();

  // Fetch AI performance metrics
  const { data: metrics, isLoading: isLoadingMetrics } = useQuery({
    queryKey: ['ai-performance-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_performance_metrics')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch AI cache metrics
  const { data: cacheMetrics, isLoading: isLoadingCache } = useQuery({
    queryKey: ['ai-cache-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_ai_cache_metrics');

      if (error) throw error;
      return data || { total_entries: 0, active_entries: 0, hit_rate: 0 };
    },
  });

  // Fetch related alerts
  const { data: alerts, isLoading: isLoadingAlerts } = useQuery({
    queryKey: ['ai-performance-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('performance_alerts')
        .select('*')
        .eq('metric_name', 'ai_response_time')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });

  // Mutation to resolve alerts
  const resolveAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { data, error } = await supabase
        .from('performance_alerts')
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq('id', alertId);

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-performance-alerts'] });
    },
  });

  // Prepare chart data
  const responseTimeData = React.useMemo(() => {
    if (!metrics || !metrics.length) return {
      labels: [],
      datasets: [{
        label: 'Response Time (ms)',
        data: [],
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
      }]
    };

    // Process the metrics data for the chart
    const sortedMetrics = [...metrics].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return {
      labels: sortedMetrics.map(m => new Date(m.timestamp).toLocaleTimeString()),
      datasets: [{
        label: 'Response Time (ms)',
        data: sortedMetrics.map(m => m.response_time_ms || 0),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
      }]
    };
  }, [metrics]);

  const tokenUsageData = React.useMemo(() => {
    if (!metrics || !metrics.length) return {
      labels: [],
      datasets: [{
        label: 'Token Usage',
        data: [],
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: 'rgba(16, 185, 129, 0.5)',
      }]
    };

    // Process the metrics data for the chart
    const sortedMetrics = [...metrics].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return {
      labels: sortedMetrics.map(m => new Date(m.timestamp).toLocaleTimeString()),
      datasets: [{
        label: 'Token Usage',
        data: sortedMetrics.map(m => {
          const tokenUsage = m.token_usage as Record<string, number> || {};
          return tokenUsage.total || 0;
        }),
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: 'rgba(16, 185, 129, 0.5)',
      }]
    };
  }, [metrics]);

  // Calculate metrics
  const avgResponseTime = React.useMemo(() => {
    if (!metrics || !metrics.length) return 0;
    const validMetrics = metrics.filter(m => !!m.response_time_ms);
    if (!validMetrics.length) return 0;
    const total = validMetrics.reduce((acc, m) => acc + (m.response_time_ms || 0), 0);
    return total / validMetrics.length;
  }, [metrics]);

  const cacheHitRate = React.useMemo(() => {
    if (!metrics || !metrics.length) return 0;
    const cacheHits = metrics.filter(m => m.cache_hit).length;
    return (cacheHits / metrics.length) * 100;
  }, [metrics]);

  const avgTokenUsage = React.useMemo(() => {
    if (!metrics || !metrics.length) return 0;
    const validMetrics = metrics.filter(m => m.token_usage);
    if (!validMetrics.length) return 0;
    
    const total = validMetrics.reduce((acc, m) => {
      const tokenUsage = m.token_usage as Record<string, number> || {};
      return acc + (tokenUsage.total || 0);
    }, 0);
    
    return total / validMetrics.length;
  }, [metrics]);

  const isLoading = isLoadingMetrics || isLoadingCache || isLoadingAlerts;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Avg Response Time"
          value={`${Math.round(avgResponseTime)} ms`}
          icon={<Clock className="h-5 w-5 text-blue-600" />}
          trend={metrics && metrics.length > 1 ? {
            value: ((metrics[0].response_time_ms || 0) - (metrics[metrics.length - 1].response_time_ms || 0)) / 
                  Math.max((metrics[metrics.length - 1].response_time_ms || 1), 1) * 100,
            isPositive: (metrics[0].response_time_ms || 0) < (metrics[metrics.length - 1].response_time_ms || 0)
          } : undefined}
        />
        <MetricCard
          title="Cache Hit Rate"
          value={`${Math.round(cacheHitRate)}%`}
          icon={<Zap className="h-5 w-5 text-blue-600" />}
          trend={cacheMetrics ? {
            value: 5, // Mock trend for now
            isPositive: true
          } : undefined}
        />
        <MetricCard
          title="Avg Token Usage"
          value={Math.round(avgTokenUsage)}
          icon={<BarChart3 className="h-5 w-5 text-blue-600" />}
          trend={metrics && metrics.length > 1 ? {
            value: ((metrics[0].token_usage?.total || 0) - (metrics[metrics.length - 1].token_usage?.total || 0)) / 
                   Math.max((metrics[metrics.length - 1].token_usage?.total || 1), 1) * 100,
            isPositive: (metrics[0].token_usage?.total || 0) < (metrics[metrics.length - 1].token_usage?.total || 0)
          } : undefined}
        />
        <MetricCard
          title="Active Cache Entries"
          value={cacheMetrics?.active_entries || 0}
          icon={<Server className="h-5 w-5 text-blue-600" />}
        />
      </div>

      {/* Time Series Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <TimeSeriesChart 
            title="Response Time (ms)" 
            data={responseTimeData} 
          />
        </div>
        <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <TimeSeriesChart 
            title="Token Usage" 
            data={tokenUsageData} 
          />
        </div>
      </div>

      {/* Alerts Section */}
      <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
          AI Performance Alerts
        </h3>
        <AlertsList 
          alerts={alerts || []} 
          onResolve={(alertId) => resolveAlertMutation.mutate(alertId)}
        />
      </div>
    </div>
  );
}