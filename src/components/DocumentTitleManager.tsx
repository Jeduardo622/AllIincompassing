import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../lib/authContext';

const APP_NAME = 'AllIncompassing';

const humanizeSegment = (value: string) =>
  value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const resolvePageTitle = (pathname: string): string => {
  if (pathname === '/') return 'Dashboard';
  if (pathname === '/login') return 'Login';
  if (pathname === '/signup') return 'Sign Up';
  if (pathname === '/auth/recovery') return 'Password Recovery';
  if (pathname === '/accept-invite') return 'Accept Invite';
  if (pathname === '/unauthorized') return 'Unauthorized';
  if (pathname === '/account') return 'My Account';
  if (pathname === '/documentation') return 'Documentation';
  if (pathname === '/fill-docs') return 'Fill Docs';
  if (pathname === '/authorizations') return 'Authorizations';
  if (pathname === '/billing') return 'Billing';
  if (pathname === '/monitoring' || pathname === '/monitoringdashboard') return 'Monitoring';
  if (pathname === '/messages') return 'Messages';
  if (pathname === '/messages/new') return 'New Message';
  if (pathname.startsWith('/messages/')) return 'Message Thread';
  if (pathname === '/super-admin/feature-flags') return 'Super Admin Feature Flags';
  if (pathname === '/super-admin/impersonation') return 'Super Admin Impersonation';
  if (pathname === '/super-admin/prompts') return 'Super Admin Prompts';
  if (pathname.startsWith('/settings/')) {
    return `Settings - ${humanizeSegment(pathname.slice('/settings/'.length))}`;
  }
  if (pathname === '/settings') return 'Settings';
  if (pathname === '/clients/new') return 'New Client';
  if (pathname.startsWith('/clients/')) return 'Client Details';
  if (pathname === '/clients') return 'Clients';
  if (pathname === '/therapists/new') return 'New Behavioral Therapist';
  if (pathname.startsWith('/therapists/')) return 'Therapist Details';
  if (pathname === '/therapists') return 'Therapists';
  if (pathname === '/family') return 'Family Dashboard';
  if (pathname === '/schedule') return 'Schedule';
  if (pathname === '/time') return 'Time';
  if (pathname === '/time/review') return 'Time Review';
  if (pathname === '/payroll') return 'Payroll';
  if (pathname === '/reports') return 'Reports';
  return 'Not Found';
};

export function DocumentTitleManager() {
  const location = useLocation();
  const { loading, profileLoading, user } = useAuth();

  useEffect(() => {
    document.title = APP_NAME;
    if (loading || (user && profileLoading)) {
      return;
    }

    const titleTimer = window.setTimeout(() => {
      document.title = `${resolvePageTitle(location.pathname)} | ${APP_NAME}`;
    }, 0);

    return () => window.clearTimeout(titleTimer);
  }, [loading, location.pathname, profileLoading, user]);

  return null;
}
