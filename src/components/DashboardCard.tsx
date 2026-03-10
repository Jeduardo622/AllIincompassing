import React from 'react';

interface DashboardCardProps {
  icon: React.ElementType;
  title: string;
  value: string;
  trend: string;
  trendUp: boolean;
}

export function DashboardCard({ 
  icon: Icon, 
  title, 
  value, 
  trend, 
  trendUp 
}: DashboardCardProps) {
  return (
    <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <Icon className="h-6 w-6 text-blue-600" />
        <span className={`text-sm ${trendUp ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {trend}
        </span>
      </div>
      <h3 className="text-gray-600 dark:text-gray-400 text-sm">{title}</h3>
      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
    </div>
  );
}