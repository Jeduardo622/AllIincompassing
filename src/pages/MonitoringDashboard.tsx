import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Database, 
  Cpu, 
  Bot,
  Wifi,
  WifiOff,
  Settings,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  Trash2,
  BarChart3
} from 'lucide-react';
import AIPerformance from '../components/monitoring/AIPerformance';
import DatabasePerformance from '../components/monitoring/DatabasePerformance';
import SystemPerformance from '../components/monitoring/SystemPerformance';
import { 
  useRealtimePerformanceMonitoring, 
  usePerformanceAnalytics 
} from '../lib/performance';
import { useCacheCleanup } from '../lib/cacheCleanup';
import { useQueryPerformanceTracking } from '../lib/queryPerformanceTracker';

type TabType = 'ai' | 'database' | 'system' | 'overview' | 'cache' | 'queries';

export default function MonitoringDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(30000);
  const [showSettings, setShowSettings] = useState(false);
  
  // Real-time monitoring hooks
  const {
    isConnected,
    connectionStatus,
    metrics,
    alerts,
    clearMetrics,
    clearAlerts
  } = useRealtimePerformanceMonitoring();
  
  const { analytics, analyzePerformance } = usePerformanceAnalytics();
  
  // Cache cleanup and query performance tracking
  const { 
    manualCleanup, 
    getCleanupStats
  } = useCacheCleanup();
  
  const { 
    getAnalysis, 
    getStats: getQueryStats,
    isActive: queryTrackingActive 
  } = useQueryPerformanceTracking();
  
  // Analyze performance when metrics change
  useEffect(() => {
    if (metrics.length > 0) {
      analyzePerformance(metrics);
    }
  }, [metrics, analyzePerformance]);
  
  // Auto-refresh functionality
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      // Trigger refresh of all components
      window.location.reload();
    }, refreshInterval);
    
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval]);

  const tabs = [
    { id: 'overview' as TabType, name: 'Overview', icon: Activity },
    { id: 'ai' as TabType, name: 'AI Performance', icon: Bot },
    { id: 'database' as TabType, name: 'Database Performance', icon: Database },
    { id: 'system' as TabType, name: 'System Performance', icon: Cpu },
    { id: 'cache' as TabType, name: 'Cache Management', icon: Trash2 },
    { id: 'queries' as TabType, name: 'Query Performance', icon: BarChart3 },
  ];

  const ConnectionStatus = () => (
    <div className="flex items-center space-x-2">
      {isConnected ? (
        <div className="flex items-center space-x-1 text-green-600">
          <Wifi className="w-4 h-4" />
          <span className="text-sm">Connected</span>
        </div>
      ) : (
        <div className="flex items-center space-x-1 text-red-600">
          <WifiOff className="w-4 h-4" />
          <span className="text-sm">Disconnected</span>
        </div>
      )}
    </div>
  );

  const HealthScore = () => (
    <div className="flex items-center space-x-2">
      <div className="flex items-center space-x-1">
        {analytics.healthScore >= 80 ? (
          <CheckCircle className="w-4 h-4 text-green-600" />
        ) : analytics.healthScore >= 60 ? (
          <AlertTriangle className="w-4 h-4 text-yellow-600" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-red-600" />
        )}
        <span className="text-sm font-medium">Health Score: {analytics.healthScore}%</span>
      </div>
    </div>
  );

  const OverviewTab = () => (
    <div className="space-y-6">
      {/* System Health Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">System Health</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {analytics.healthScore}%
              </p>
            </div>
            {analytics.healthScore >= 80 ? (
              <CheckCircle className="w-8 h-8 text-green-600" />
            ) : (
              <AlertTriangle className="w-8 h-8 text-yellow-600" />
            )}
          </div>
        </div>
        
        <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Active Alerts</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {alerts.filter(a => !a.resolved).length}
              </p>
            </div>
            <AlertTriangle className="w-8 h-8 text-red-600" />
          </div>
        </div>
        
        <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">AI Response Time</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {Math.round(analytics.trends.aiResponseTime.current)}ms
              </p>
            </div>
            <div className="flex items-center">
              {analytics.trends.aiResponseTime.change > 0 ? (
                <TrendingUp className="w-5 h-5 text-red-500" />
              ) : (
                <TrendingDown className="w-5 h-5 text-green-500" />
              )}
              <span className={`text-sm ml-1 ${analytics.trends.aiResponseTime.change > 0 ? 'text-red-500' : 'text-green-500'}`}>
                {Math.abs(analytics.trends.aiResponseTime.change).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
        
        <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Cache Hit Rate</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {Math.round(analytics.trends.cacheHitRate.current)}%
              </p>
            </div>
            <div className="flex items-center">
              {analytics.trends.cacheHitRate.change > 0 ? (
                <TrendingUp className="w-5 h-5 text-green-500" />
              ) : (
                <TrendingDown className="w-5 h-5 text-red-500" />
              )}
              <span className={`text-sm ml-1 ${analytics.trends.cacheHitRate.change > 0 ? 'text-green-500' : 'text-red-500'}`}>
                {Math.abs(analytics.trends.cacheHitRate.change).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Bottlenecks */}
      {analytics.bottlenecks.length > 0 && (
        <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Performance Bottlenecks</h3>
          <div className="space-y-3">
            {analytics.bottlenecks.map((bottleneck, index) => (
              <div key={index} className="flex items-start space-x-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <AlertTriangle className={`w-5 h-5 mt-0.5 ${
                  bottleneck.impact === 'high' ? 'text-red-500' : 
                  bottleneck.impact === 'medium' ? 'text-yellow-500' : 
                  'text-blue-500'
                }`} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {bottleneck.component} - {bottleneck.metric}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {bottleneck.recommendation}
                  </p>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    bottleneck.impact === 'high' ? 'bg-red-100 text-red-800' : 
                    bottleneck.impact === 'medium' ? 'bg-yellow-100 text-yellow-800' : 
                    'bg-blue-100 text-blue-800'
                  }`}>
                    {bottleneck.impact} impact
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Alerts */}
      {alerts.length > 0 && (
        <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Recent Alerts</h3>
          <div className="space-y-3">
            {alerts.slice(0, 5).map((alert, index) => (
              <div key={index} className="flex items-start space-x-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <AlertTriangle className={`w-5 h-5 mt-0.5 ${
                  alert.severity === 'critical' ? 'text-red-500' : 
                  alert.severity === 'high' ? 'text-orange-500' : 
                  alert.severity === 'medium' ? 'text-yellow-500' : 
                  'text-blue-500'
                }`} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {alert.alert_type}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {alert.message}
                  </p>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      alert.severity === 'critical' ? 'bg-red-100 text-red-800' : 
                      alert.severity === 'high' ? 'bg-orange-100 text-orange-800' : 
                      alert.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' : 
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {alert.severity}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(alert.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const CacheManagementTab = () => {
    const [cleanupStats, setCleanupStats] = useState<any>(null);
    const [isRunningCleanup, setIsRunningCleanup] = useState(false);

    const loadCleanupStats = async () => {
      const stats = getCleanupStats();
      setCleanupStats(stats);
    };

    useEffect(() => {
      loadCleanupStats();
      const interval = setInterval(loadCleanupStats, 10000); // Update every 10 seconds
      return () => clearInterval(interval);
    }, []);

    const handleManualCleanup = async (type?: string) => {
      setIsRunningCleanup(true);
      try {
        await manualCleanup(type);
        await loadCleanupStats();
      } finally {
        setIsRunningCleanup(false);
      }
    };

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Cache Status</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {cleanupStats?.isRunning ? 'Running' : 'Idle'}
                </p>
              </div>
              <Trash2 className="w-8 h-8 text-blue-600" />
            </div>
          </div>

          <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Cleanups</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {cleanupStats?.totalCleanups || 0}
                </p>
              </div>
              <Activity className="w-8 h-8 text-green-600" />
            </div>
          </div>

          <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Bytes Freed</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {cleanupStats?.bytesFreed ? `${(cleanupStats.bytesFreed / 1024 / 1024).toFixed(1)}MB` : '0MB'}
                </p>
              </div>
              <Database className="w-8 h-8 text-purple-600" />
            </div>
          </div>

          <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Memory Usage</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {cleanupStats?.memoryUsage ? `${cleanupStats.memoryUsage.usedJSHeapSize}MB` : 'N/A'}
                </p>
              </div>
              <Cpu className="w-8 h-8 text-orange-600" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Manual Cleanup Controls</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button
              onClick={() => handleManualCleanup('localStorage')}
              disabled={isRunningCleanup}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Clean LocalStorage
            </button>
            <button
              onClick={() => handleManualCleanup('reactQuery')}
              disabled={isRunningCleanup}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              Clean React Query
            </button>
            <button
              onClick={() => handleManualCleanup('aiCache')}
              disabled={isRunningCleanup}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              Clean AI Cache
            </button>
            <button
              onClick={() => handleManualCleanup()}
              disabled={isRunningCleanup}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              Clean All
            </button>
          </div>
        </div>

        {cleanupStats && (
          <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Cleanup Statistics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Active Intervals: {cleanupStats.activeIntervals}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Errors: {cleanupStats.errors}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Last Cleanup: {cleanupStats.lastCleanup ? new Date(cleanupStats.lastCleanup).toLocaleString() : 'Never'}
                </p>
              </div>
              {cleanupStats.memoryUsage && (
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Total Heap Size: {(cleanupStats.memoryUsage.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Used Heap Size: {(cleanupStats.memoryUsage.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Heap Limit: {(cleanupStats.memoryUsage.jsHeapSizeLimit / 1024 / 1024).toFixed(1)}MB
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const QueryPerformanceTab = () => {
    const [queryAnalysis, setQueryAnalysis] = useState<any>(null);
    const [queryStats, setQueryStats] = useState<any>(null);

    const loadQueryData = async () => {
      try {
        const [analysis, stats] = await Promise.all([
          getAnalysis('24h'),
          Promise.resolve(getQueryStats())
        ]);
        setQueryAnalysis(analysis);
        setQueryStats(stats);
      } catch (error) {
        console.error('Failed to load query performance data:', error);
      }
    };

    useEffect(() => {
      loadQueryData();
      const interval = setInterval(loadQueryData, 30000); // Update every 30 seconds
      return () => clearInterval(interval);
    }, []);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Tracking Status</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {queryTrackingActive ? 'Active' : 'Inactive'}
                </p>
              </div>
              <BarChart3 className="w-8 h-8 text-blue-600" />
            </div>
          </div>

          <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Avg Response Time</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {queryAnalysis?.performance?.avgResponseTime?.toFixed(0) || 0}ms
                </p>
              </div>
              <Clock className="w-8 h-8 text-green-600" />
            </div>
          </div>

          <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Slow Queries</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {queryAnalysis?.performance?.slowQueryCount || 0}
                </p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
          </div>

          <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Cache Hit Rate</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {queryAnalysis?.performance?.cacheHitRate?.toFixed(1) || 0}%
                </p>
              </div>
              <Database className="w-8 h-8 text-purple-600" />
            </div>
          </div>
        </div>

        {queryAnalysis?.patterns && queryAnalysis.patterns.length > 0 && (
          <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Slow Query Patterns</h3>
            <div className="space-y-3">
              {queryAnalysis.patterns.slice(0, 5).map((pattern: any, index: number) => (
                <div key={index} className="flex items-start space-x-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <AlertTriangle className={`w-5 h-5 mt-0.5 ${
                    pattern.impact === 'critical' ? 'text-red-500' : 
                    pattern.impact === 'high' ? 'text-orange-500' : 
                    pattern.impact === 'medium' ? 'text-yellow-500' : 
                    'text-blue-500'
                  }`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {pattern.pattern}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {pattern.recommendation}
                    </p>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Count: {pattern.count} | Avg: {pattern.avgDuration.toFixed(0)}ms
                      </span>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        pattern.impact === 'critical' ? 'bg-red-100 text-red-800' : 
                        pattern.impact === 'high' ? 'bg-orange-100 text-orange-800' : 
                        pattern.impact === 'medium' ? 'bg-yellow-100 text-yellow-800' : 
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {pattern.impact} impact
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {queryAnalysis?.recommendations && queryAnalysis.recommendations.length > 0 && (
          <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Performance Recommendations</h3>
            <div className="space-y-3">
              {queryAnalysis.recommendations.map((rec: any, index: number) => (
                <div key={index} className="flex items-start space-x-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <CheckCircle className={`w-5 h-5 mt-0.5 ${
                    rec.priority === 'critical' ? 'text-red-500' : 
                    rec.priority === 'high' ? 'text-orange-500' : 
                    rec.priority === 'medium' ? 'text-yellow-500' : 
                    'text-green-500'
                  }`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {rec.description}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Expected improvement: {rec.estimatedImprovement}
                    </p>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      rec.priority === 'critical' ? 'bg-red-100 text-red-800' : 
                      rec.priority === 'high' ? 'bg-orange-100 text-orange-800' : 
                      rec.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' : 
                      'bg-green-100 text-green-800'
                    }`}>
                      {rec.priority} priority
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {queryStats && (
          <div className="bg-white dark:bg-dark-lighter p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Current Session Statistics</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Buffer Size: {queryStats.bufferSize}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Pattern Count: {queryStats.patternCount}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Session ID: {queryStats.sessionId?.slice(0, 8)}...</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Tracking: {queryStats.isEnabled ? 'Enabled' : 'Disabled'}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
          <Activity className="w-6 h-6 mr-2 text-blue-600" />
          Real-Time Performance Monitoring
        </h1>
        <div className="flex items-center space-x-4">
          <ConnectionStatus />
          <HealthScore />
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              onClick={() => window.location.reload()}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-white dark:bg-dark-lighter rounded-lg shadow mb-6 p-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Auto Refresh
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <select
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  disabled={!autoRefresh}
                  className="border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="30000">30 seconds</option>
                  <option value="60000">1 minute</option>
                  <option value="300000">5 minutes</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Actions
              </label>
              <div className="flex space-x-2">
                <button
                  onClick={clearMetrics}
                  className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded"
                >
                  Clear Metrics
                </button>
                <button
                  onClick={clearAlerts}
                  className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded"
                >
                  Clear Alerts
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* System Status */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow mb-6 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Real-time monitoring {isConnected ? 'active' : 'inactive'}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Last updated: {new Date().toLocaleTimeString()}
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {metrics.length} metrics tracked
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {alerts.filter(a => !a.resolved).length} active alerts
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow mb-6">
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex -mb-px">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    group inline-flex items-center px-6 py-4 border-b-2 font-medium text-sm
                    ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                    }
                  `}
                >
                  <Icon className={`
                    -ml-1 mr-2 h-5 w-5
                    ${
                      activeTab === tab.id
                        ? 'text-blue-500 dark:text-blue-400'
                        : 'text-gray-400 group-hover:text-gray-500 dark:text-gray-500 dark:group-hover:text-gray-400'
                    }
                  `} />
                  {tab.name}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'ai' && <AIPerformance />}
          {activeTab === 'database' && <DatabasePerformance />}
          {activeTab === 'system' && <SystemPerformance />}
          {activeTab === 'cache' && <CacheManagementTab />}
          {activeTab === 'queries' && <QueryPerformanceTab />}
        </div>
      </div>

      {/* System Information Footer */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-4">
        <div className="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
          <div>Enhanced Real-Time Monitoring Dashboard v2.0</div>
          <div>Connection: {connectionStatus}</div>
          <div>Data Retention: 30 days</div>
        </div>
      </div>
    </div>
  );
}