import React, { useMemo } from 'react';
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  Title, 
  Tooltip, 
  Legend,
  TimeScale 
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';

// Register the components
ChartJS.register(
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  Title, 
  Tooltip, 
  Legend,
  TimeScale
);

interface TimeSeriesChartProps {
  title: string;
  data: {
    labels: string[];
    datasets: {
      label: string;
      data: number[];
      borderColor: string;
      backgroundColor: string;
    }[];
  };
  height?: number;
}

export default function TimeSeriesChart({ title, data, height = 300 }: TimeSeriesChartProps) {
  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          color: document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#1f2937',
        }
      },
      title: {
        display: true,
        text: title,
        color: document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#1f2937',
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
      },
    },
    scales: {
      x: {
        ticks: {
          color: document.documentElement.classList.contains('dark') ? '#9ca3af' : '#4b5563',
        },
        grid: {
          color: document.documentElement.classList.contains('dark') ? 'rgba(75, 85, 99, 0.2)' : 'rgba(229, 231, 235, 0.5)',
        }
      },
      y: {
        ticks: {
          color: document.documentElement.classList.contains('dark') ? '#9ca3af' : '#4b5563',
        },
        grid: {
          color: document.documentElement.classList.contains('dark') ? 'rgba(75, 85, 99, 0.2)' : 'rgba(229, 231, 235, 0.5)',
        }
      }
    },
  }), [title]);

  return (
    <div style={{ height: `${height}px` }}>
      <Line options={options} data={data} />
    </div>
  );
}