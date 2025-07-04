import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Cpu, MemoryStick as Memory, HardDrive, Activity, Network, Scale, ServerCrash } from 'lucide-react';
import MetricCard from './MetricCard';
import TimeSeriesChart from './TimeSeriesChart';
import AlertsList from './AlertsList';

export default function SystemPerformance() {
  const queryClient = useQueryClient();

  // Fetch system performance metrics
  const { data: metrics, isLoading: isLoadingMetrics } = useQuery({
    queryKey: ['system-performance-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_performance_metrics')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch related alerts
  const { data: alerts, isLoading: isLoadingAlerts } = useQuery({
    queryKey: ['system-performance-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('performance_alerts')
        .select('*')
        .in('metric_name', ['cpu_usage', 'memory_usage', 'disk_usage', 'network_latency'])
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
      queryClient.invalidateQueries({ queryKey: ['system-performance-alerts'] });
    },
  });

  // Group metrics by type
  const groupedMetrics = React.useMemo(() => {
    if (!metrics || !metrics.length) return {};
    
    return metrics.reduce((acc, metric) => {
      const type = metric.metric_type;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(metric);
      return acc;
    }, {} as Record<string, typeof metrics>);
  }, [metrics]);

  // Prepare chart data
  const cpuUsageData = React.useMemo(() => {
    const cpuMetrics = groupedMetrics['cpu_usage'] || [];
    if (!cpuMetrics.length) return {
      labels: [],
      datasets: [{
        label: 'CPU Usage (%)',
        data: [],
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
      }]
    };

    // Process the metrics data for the chart
    const sortedMetrics = [...cpuMetrics].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return {
      labels: sortedMetrics.map(m => new Date(m.timestamp).toLocaleTimeString()),
      datasets: [{
        label: 'CPU Usage (%)',
        data: sortedMetrics.map(m => m.value || 0),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
      }]
    };
  }, [groupedMetrics]);

  const memoryUsageData = React.useMemo(() => {
    const memoryMetrics = groupedMetrics['memory_usage'] || [];
    if (!memoryMetrics.length) return {
      labels: [],
      datasets: [{
        label: 'Memory Usage (%)',
        data: [],
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: 'rgba(16, 185, 129, 0.5)',
      }]
    };

    // Process the metrics data for the chart
    const sortedMetrics = [...memoryMetrics].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return {
      labels: sortedMetrics.map(m => new Date(m.timestamp).toLocaleTimeString()),
      datasets: [{
        label: 'Memory Usage (%)',
        data: sortedMetrics.map(m => m.value || 0),
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: 'rgba(16, 185, 129, 0.5)',
      }]
    };
  }, [groupedMetrics]);

  const diskUsageData = React.useMemo(() => {
    const diskMetrics = groupedMetrics['disk_usage'] || [];
    if (!diskMetrics.length) return {
      labels: [],
      datasets: [{
        label: 'Disk Usage (%)',
        data: [],
        borderColor: 'rgb(249, 115, 22)',
        backgroundColor: 'rgba(249, 115, 22, 0.5)',
      }]
    };

    // Process the metrics data for the chart
    const sortedMetrics = [...diskMetrics].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return {
      labels: sortedMetrics.map(m => new Date(m.timestamp).toLocaleTimeString()),
      datasets: [{
        label: 'Disk Usage (%)',
        data: sortedMetrics.map(m => m.value || 0),
        borderColor: 'rgb(249, 115, 22)',
        backgroundColor: 'rgba(249, 115, 22, 0.5)',
      }]
    };
  }, [groupedMetrics]);

  const networkLatencyData = React.useMemo(() => {
    const networkMetrics = groupedMetrics['network_latency'] || [];
    if (!networkMetrics.length) return {
      labels: [],
      datasets: [{
        label: 'Network Latency (ms)',
        data: [],
        borderColor: 'rgb(139, 92, 246)',
        backgroundColor: 'rgba(139, 92, 246, 0.5)',
      }]
    };

    // Process the metrics data for the chart
    const sortedMetrics = [...networkMetrics].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return {
      labels: sortedMetrics.map(m => new Date(m.timestamp).toLocaleTimeString()),
      datasets: [{
        label: 'Network Latency (ms)',
        data: sortedMetrics.map(m => m.value || 0),
        borderColor: 'rgb(139, 92, 246)',
        backgroundColor: 'rgba(139, 92, 246, 0.5)',
      }]
    };
  }, [groupedMetrics]);

  // Calculate averages for metrics
  const getAverageMetric = (metricType: string): number => {
    const typeMetrics = groupedMetrics[metricType] || [];
    if (!typeMetrics.length) return 0;
    
    const total = typeMetrics.reduce((acc, m) => acc + (m.value || 0), 0);
    return total / typeMetrics.length;
  };

  const isLoading = isLoadingMetrics || isLoadingAlerts;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Count threshold breaches
  const thresholdBreaches = metrics ? metrics.filter(m => m.threshold_breached).length : 0;

  return (
    <div className="space-y-6">
      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="CPU Usage"
          value={`${Math.round(getAverageMetric('cpu_usage'))}%`}
          icon={<Cpu className="h-5 w-5 text-blue-600" />}
          trend={{
            value: 2.5, // Mock trend for demo
            isPositive: false
          }}
        />
        <MetricCard
          title="Memory Usage"
          value={`${Math.round(getAverageMetric('memory_usage'))}%`}
          icon={<Memory className="h-5 w-5 text-green-600" />}
          trend={{
            value: 1.2, // Mock trend for demo
            isPositive: false
          }}
        />
        <MetricCard
          title="Disk Usage"
          value={`${Math.round(getAverageMetric('disk_usage'))}%`}
          icon={<HardDrive className="h-5 w-5 text-orange-600" />}
          trend={{
            value: 0.5, // Mock trend for demo
            isPositive: false
          }}
        />
        <MetricCard
          title="Network Latency"
          value={`${Math.round(getAverageMetric('network_latency'))} ms`}
          icon={<Network className="h-5 w-5 text-purple-600" />}
          trend={{
            value: 3.0, // Mock trend for demo
            isPositive: true
          }}
        />
      </div>

      {/* Additional Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Threshold Breaches"
          value={thresholdBreaches}
          icon={<ServerCrash className="h-5 w-5 text-red-600" />}
          className="md:col-span-1"
        />
        <MetricCard
          title="System Uptime"
          value="99.98%"
          subtitle="Last 30 days"
          icon={<Activity className="h-5 w-5 text-blue-600" />}
          className="md:col-span-1"
        />
        <MetricCard
          title="System Load"
          value={`${(Math.random() * 3 + 1).toFixed(2)}`}
          icon={<Scale className="h-5 w-5 text-indigo-600" />}
          className="md:col-span-1"
        />
      </div>

      {/* Time Series Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <TimeSeriesChart 
            title="CPU Usage (%)" 
            data={cpuUsageData} 
          />
        </div>
        <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <TimeSeriesChart 
            title="Memory Usage (%)" 
            data={memoryUsageData} 
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <TimeSeriesChart 
            title="Disk Usage (%)" 
            data={diskUsageData} 
          />
        </div>
        <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <TimeSeriesChart 
            title="Network Latency (ms)" 
            data={networkLatencyData} 
          />
        </div>
      </div>

      {/* Alerts Section */}
      <div className="bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
          System Performance Alerts
        </h3>
        <AlertsList 
          alerts={alerts || []} 
          onResolve={(alertId) => resolveAlertMutation.mutate(alertId)}
        />
      </div>
    </div>
  );
}