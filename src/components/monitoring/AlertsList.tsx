import React from 'react';
import { AlertCircle, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import type { Alert } from '../../types';

interface AlertsListProps {
  alerts: Alert[];
  onResolve?: (alertId: string) => void;
}

export default function AlertsList({ alerts, onResolve }: AlertsListProps) {
  // Function to get status icon
  const getStatusIcon = (alert: Alert) => {
    if (alert.resolved) {
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    } else if (alert.escalated) {
      return <AlertTriangle className="w-5 h-5 text-red-500" />;
    } else {
      return <Clock className="w-5 h-5 text-amber-500" />;
    }
  };

  // Function to get severity class
  const getSeverityClass = (alert: Alert) => {
    const ratio = alert.current_value / alert.threshold_value;
    
    if (ratio >= 1.5 || alert.escalated) {
      return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    } else if (ratio >= 1.0) {
      return 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
    } else if (alert.resolved) {
      return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
    } else {
      return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
    }
  };

  if (alerts.length === 0) {
    return (
      <div className="bg-green-50 dark:bg-green-900/10 p-4 rounded-lg text-center">
        <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
        <p className="text-green-800 dark:text-green-200">No alerts to display. Everything is running smoothly!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => (
        <div 
          key={alert.id} 
          className={`p-4 rounded-lg border ${getSeverityClass(alert)}`}
        >
          <div className="flex justify-between items-start">
            <div className="flex items-start">
              {getStatusIcon(alert)}
              <div className="ml-3">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                  {alert.metric_name}
                </h4>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {alert.message}
                </p>
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {new Date(alert.created_at).toLocaleString()} 
                  {alert.resolved && alert.resolved_at && 
                    ` • Resolved: ${new Date(alert.resolved_at).toLocaleString()}`
                  }
                </div>
              </div>
            </div>
            {!alert.resolved && onResolve && (
              <button
                onClick={() => onResolve(alert.id)}
                className="ml-3 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300"
              >
                Resolve
              </button>
            )}
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Current: {alert.current_value}</span>
              <span className="text-gray-500 dark:text-gray-400">Threshold: {alert.threshold_value}</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-1">
              <div 
                className={`h-2 rounded-full ${
                  alert.resolved 
                    ? 'bg-green-500' 
                    : (alert.current_value / alert.threshold_value >= 1.5 
                      ? 'bg-red-500'
                      : alert.current_value / alert.threshold_value >= 1.0
                        ? 'bg-amber-500'
                        : 'bg-blue-500')
                }`}
                style={{ width: `${Math.min(100, (alert.current_value / alert.threshold_value) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export { AlertsList }