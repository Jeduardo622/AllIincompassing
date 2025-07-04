import React from 'react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
}

export default function MetricCard({ title, value, subtitle, icon, trend, className = '' }: MetricCardProps) {
  return (
    <div className={`bg-white dark:bg-dark-lighter p-4 rounded-lg shadow border border-gray-200 dark:border-gray-700 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded-lg">
          {icon}
        </div>
        {trend && (
          <div className={`text-xs font-medium flex items-center ${
            trend.isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}>
            {trend.value > 0 && '+'}{trend.value.toFixed(1)}%
          </div>
        )}
      </div>
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</h3>
      <div className="flex items-baseline">
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
        {subtitle && <p className="ml-2 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
      </div>
    </div>
  );
}