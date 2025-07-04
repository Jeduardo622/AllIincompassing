import React, { useState } from 'react';
import { 
  Activity, 
  Database, 
  Cpu, 
  Bot
} from 'lucide-react';
import AIPerformance from '../components/monitoring/AIPerformance';
import DatabasePerformance from '../components/monitoring/DatabasePerformance';
import SystemPerformance from '../components/monitoring/SystemPerformance';

type TabType = 'ai' | 'database' | 'system';

export default function MonitoringDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('ai');

  const tabs = [
    { id: 'ai' as TabType, name: 'AI Performance', icon: Bot },
    { id: 'database' as TabType, name: 'Database Performance', icon: Database },
    { id: 'system' as TabType, name: 'System Performance', icon: Cpu },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
          <Activity className="w-6 h-6 mr-2 text-blue-600" />
          Performance Monitoring
        </h1>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
            <span className="text-sm text-gray-500 dark:text-gray-400 pl-2">Refresh:</span>
            <select
              className="bg-transparent border-none text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-0"
            >
              <option value="30000">30s</option>
              <option value="60000">1m</option>
              <option value="300000">5m</option>
              <option value="off">Off</option>
            </select>
          </div>
        </div>
      </div>

      {/* Dashboard overview cards */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow mb-6 p-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This dashboard provides real-time monitoring of system performance metrics.
          Track AI response times, database query performance, and system health in one place.
        </p>
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
          {activeTab === 'ai' && <AIPerformance />}
          {activeTab === 'database' && <DatabasePerformance />}
          {activeTab === 'system' && <SystemPerformance />}
        </div>
      </div>

      {/* System Information Footer */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-4">
        <div className="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
          <div>Last Updated: {new Date().toLocaleString()}</div>
          <div>Phase 5 Monitoring Dashboard v1.0</div>
          <div>Data Retention: 30 days</div>
        </div>
      </div>
    </div>
  );
}