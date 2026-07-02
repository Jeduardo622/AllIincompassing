export type AppRole =
  | 'client'
  | 'bt'
  | 'therapist'
  | 'midtier'
  | 'admin_schedule'
  | 'admin'
  | 'bcba'
  | 'super_admin';

export type AppCapability =
  | 'accessSuperAdminTools'
  | 'assignClientsToStaff'
  | 'dataTaking'
  | 'lockSessionNotes'
  | 'manageAuthorizations'
  | 'manageClients'
  | 'manageProgramsGoals'
  | 'manageStaff'
  | 'staffDashboard'
  | 'viewAuthorizations'
  | 'viewBilling'
  | 'viewClients'
  | 'viewDocumentation'
  | 'viewFillDocs'
  | 'viewMessages'
  | 'viewMonitoring'
  | 'viewProgramsGoals'
  | 'viewReports'
  | 'viewSchedule'
  | 'viewSessionTrends'
  | 'viewSettings'
  | 'viewStaff'
  | 'viewStaffProfile';

export const APP_ROLES: readonly AppRole[] = [
  'client',
  'bt',
  'therapist',
  'midtier',
  'admin_schedule',
  'admin',
  'bcba',
  'super_admin',
];

export const ROLE_LABELS: Record<AppRole, string> = {
  client: 'Client',
  bt: 'BT',
  therapist: 'Therapist',
  midtier: 'Midtier',
  admin_schedule: 'Admin Schedule',
  admin: 'Admin',
  bcba: 'BCBA',
  super_admin: 'Super Admin',
};

export const ROLE_RANK: Record<AppRole, number> = {
  client: 1,
  bt: 2,
  therapist: 3,
  midtier: 4,
  admin_schedule: 5,
  admin: 6,
  bcba: 7,
  super_admin: 7,
};

const allCapabilities: readonly AppCapability[] = [
  'accessSuperAdminTools',
  'assignClientsToStaff',
  'dataTaking',
  'lockSessionNotes',
  'manageAuthorizations',
  'manageClients',
  'manageProgramsGoals',
  'manageStaff',
  'staffDashboard',
  'viewAuthorizations',
  'viewBilling',
  'viewClients',
  'viewDocumentation',
  'viewFillDocs',
  'viewMessages',
  'viewMonitoring',
  'viewProgramsGoals',
  'viewReports',
  'viewSchedule',
  'viewSessionTrends',
  'viewSettings',
  'viewStaff',
  'viewStaffProfile',
];

export const ROLE_CAPABILITIES: Record<AppRole, readonly AppCapability[]> = {
  client: ['viewDocumentation'],
  bt: [
    'dataTaking',
    'viewClients',
    'viewDocumentation',
    'viewMessages',
    'viewProgramsGoals',
    'viewStaffProfile',
  ],
  therapist: [
    'dataTaking',
    'viewClients',
    'viewDocumentation',
    'viewFillDocs',
    'viewMessages',
    'viewProgramsGoals',
    'viewSchedule',
    'viewStaffProfile',
  ],
  midtier: [
    'dataTaking',
    'manageAuthorizations',
    'manageProgramsGoals',
    'viewAuthorizations',
    'viewClients',
    'viewDocumentation',
    'viewFillDocs',
    'viewMessages',
    'viewProgramsGoals',
    'viewSchedule',
    'viewStaffProfile',
  ],
  admin_schedule: [
    'assignClientsToStaff',
    'lockSessionNotes',
    'manageAuthorizations',
    'manageClients',
    'manageStaff',
    'staffDashboard',
    'viewAuthorizations',
    'viewClients',
    'viewDocumentation',
    'viewMessages',
    'viewSchedule',
    'viewStaff',
    'viewStaffProfile',
  ],
  admin: [
    'assignClientsToStaff',
    'dataTaking',
    'lockSessionNotes',
    'manageAuthorizations',
    'manageClients',
    'manageProgramsGoals',
    'manageStaff',
    'staffDashboard',
    'viewAuthorizations',
    'viewBilling',
    'viewClients',
    'viewDocumentation',
    'viewFillDocs',
    'viewMessages',
    'viewMonitoring',
    'viewProgramsGoals',
    'viewReports',
    'viewSchedule',
    'viewSessionTrends',
    'viewSettings',
    'viewStaff',
    'viewStaffProfile',
  ],
  bcba: allCapabilities,
  super_admin: allCapabilities,
};

export const normalizeRole = (value: unknown): AppRole | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'superadmin') {
    return 'super_admin';
  }

  return APP_ROLES.includes(normalized as AppRole) ? normalized as AppRole : null;
};

export const roleHasCapability = (role: AppRole | null | undefined, capability: AppCapability): boolean => {
  if (!role) {
    return false;
  }
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
};

export const roleHasAnyCapability = (
  role: AppRole | null | undefined,
  capabilities: readonly AppCapability[],
): boolean => capabilities.some((capability) => roleHasCapability(role, capability));

export const rolesForCapability = (capability: AppCapability): AppRole[] =>
  APP_ROLES.filter((role) => roleHasCapability(role, capability));

export const roleMeetsOrExceeds = (role: AppRole, requiredRole: AppRole): boolean =>
  ROLE_RANK[role] >= ROLE_RANK[requiredRole];
