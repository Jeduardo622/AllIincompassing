import type { Session } from '../types';

const SESSION_STATUS_STYLES: Record<
  Session['status'],
  { card: string; secondary: string; time: string }
> = {
  scheduled: {
    card: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-900/50',
    secondary: 'text-blue-600 dark:text-blue-300',
    time: 'text-blue-500 dark:text-blue-400',
  },
  in_progress: {
    card: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-900/50',
    secondary: 'text-emerald-600 dark:text-emerald-300',
    time: 'text-emerald-500 dark:text-emerald-400',
  },
  completed: {
    card: 'bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700',
    secondary: 'text-gray-400 dark:text-gray-500',
    time: 'text-gray-400 dark:text-gray-500',
  },
  cancelled: {
    card: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30',
    secondary: 'text-red-500 dark:text-red-400',
    time: 'text-red-400 dark:text-red-500',
  },
  'no-show': {
    card: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30',
    secondary: 'text-amber-600 dark:text-amber-400',
    time: 'text-amber-500 dark:text-amber-500',
  },
};

export function getSessionStatusClasses(
  status: Session['status'],
): { card: string; secondary: string; time: string } {
  return SESSION_STATUS_STYLES[status] ?? SESSION_STATUS_STYLES.scheduled;
}
