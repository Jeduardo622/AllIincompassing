import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { OrganizationSettings } from '../components/settings/OrganizationSettings';
import { Building, Users, FileText, Briefcase, Settings as SettingsIcon, Shield, User, Flag, UserCog } from 'lucide-react';
import { CompanySettings } from '../components/settings/CompanySettings';
import { LocationSettings } from '../components/settings/LocationSettings';
import { ServiceLineSettings } from '../components/settings/ServiceLineSettings';
import { ReferringProviderSettings } from '../components/settings/ReferringProviderSettings';
import { FileCabinetSettings } from '../components/settings/FileCabinetSettings';
import { AdminSettings } from '../components/settings/AdminSettings';
import { UserSettings } from '../components/settings/UserSettings';
import { SuperAdminFeatureFlags } from './SuperAdminFeatureFlags';
import { SuperAdminImpersonation } from './SuperAdminImpersonation';
import { useAuth } from '../lib/authContext';

type Tab =
  | 'user'
  | 'company'
  | 'locations'
  | 'service-lines'
  | 'referring-providers'
  | 'file-cabinet'
  | 'admins'
  | 'organizations'
  | 'feature-flags'
  | 'impersonation';

const SUPER_ADMIN_ONLY_TABS: readonly Tab[] = ['feature-flags', 'impersonation'];

export function Settings() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const showSuperAdminTabs = isSuperAdmin();
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const initialTab = useMemo<Tab>(() => {
    const path = location.pathname.toLowerCase();
    const match = path.match(/\/settings\/(.+)$/);
    if (match && match[1]) {
      const candidate = match[1] as Tab;
      const allowed: Tab[] = [
        'user',
        'company',
        'locations',
        'service-lines',
        'referring-providers',
        'file-cabinet',
        'admins',
        'organizations',
        'feature-flags',
        'impersonation',
      ];
      if (allowed.includes(candidate)) {
        if (SUPER_ADMIN_ONLY_TABS.includes(candidate) && !showSuperAdminTabs) {
          return 'user';
        }
        return candidate;
      }
    }
    return 'user';
  }, [location.pathname, showSuperAdminTabs]);

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const path = location.pathname.toLowerCase();
    const match = path.match(/\/settings\/(.+)$/);
    const candidate = match?.[1] as Tab | undefined;
    if (candidate && SUPER_ADMIN_ONLY_TABS.includes(candidate) && !showSuperAdminTabs) {
      navigate('/settings', { replace: true });
    }
  }, [location.pathname, navigate, showSuperAdminTabs]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    queryClient.invalidateQueries({ refetchType: 'active' });
  }, [activeTab, queryClient]);

  useEffect(() => {
    const activeTabElement = tabRefs.current[activeTab];
    const tabScroller = activeTabElement?.closest<HTMLElement>('[data-settings-tab-scroll]');
    if (!activeTabElement || !tabScroller) {
      return;
    }

    tabScroller.scrollLeft = Math.max(
      0,
      activeTabElement.offsetLeft + (activeTabElement.offsetWidth / 2) - (tabScroller.clientWidth / 2),
    );
  }, [activeTab]);

  const tabs = [
    { id: 'user' as Tab, name: 'Personal Settings', icon: User },
    { id: 'company' as Tab, name: 'Company Settings', icon: Building },
    { id: 'locations' as Tab, name: 'Locations', icon: SettingsIcon },
    { id: 'service-lines' as Tab, name: 'Service Lines', icon: Briefcase },
    { id: 'referring-providers' as Tab, name: 'Referring Providers', icon: Users },
    { id: 'file-cabinet' as Tab, name: 'File Cabinet Settings', icon: FileText },
    { id: 'admins' as Tab, name: 'Admin Users', icon: Shield },
    { id: 'organizations' as Tab, name: 'Organizations', icon: Building },
    ...(showSuperAdminTabs
      ? [
          { id: 'feature-flags' as Tab, name: 'Feature Flags', icon: Flag },
          { id: 'impersonation' as Tab, name: 'Impersonation', icon: UserCog },
        ]
      : []),
  ];

  return (
    <div className="h-full min-w-0 max-w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      </div>

      <div className="min-w-0 max-w-full overflow-hidden rounded-lg bg-white shadow dark:bg-dark-lighter">
        <div data-settings-tab-scroll className="max-w-full overflow-x-auto border-b border-gray-200 dark:border-gray-700">
          <nav className="flex min-w-max -mb-px">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  ref={(element) => {
                    tabRefs.current[tab.id] = element;
                  }}
                  onClick={() => {
                    setActiveTab(tab.id);
                    navigate(tab.id === 'user' ? '/settings' : `/settings/${tab.id}`);
                  }}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  className={`
                    group inline-flex min-h-11 items-center px-6 py-4 border-b-2 font-medium text-sm
                    ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                    }
                  `}
                >
                  <Icon aria-hidden="true" className={`
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
        <p className="border-b border-gray-100 px-6 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400 sm:hidden">
          Scroll to view more settings sections on smaller screens.
        </p>

        <div className="p-6">
          {activeTab === 'user' && <UserSettings />}
          {activeTab === 'company' && <CompanySettings />}
          {activeTab === 'locations' && <LocationSettings />}
          {activeTab === 'service-lines' && <ServiceLineSettings />}
          {activeTab === 'referring-providers' && <ReferringProviderSettings />}
          {activeTab === 'file-cabinet' && <FileCabinetSettings />}
          {activeTab === 'admins' && <AdminSettings />}
          {activeTab === 'organizations' && <OrganizationSettings />}
          {activeTab === 'feature-flags' && <SuperAdminFeatureFlags />}
          {activeTab === 'impersonation' && <SuperAdminImpersonation />}
        </div>
      </div>
    </div>
  );
}
