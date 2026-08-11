import {
  PAYROLL_ADMIN_ELIGIBLE_ROLES,
  type PayrollAdminEligibleRole,
  type PayrollJurisdiction,
} from "./contracts";

type PayrollOrgProfileMatchInput = {
  isActive: boolean;
  organizationId: string | null;
  resolvedOrganizationId: string | null;
  targetOrganizationId: string | null;
};

type PayrollUserRoleWindow = {
  isActive: boolean;
  expiresAt: string | null;
};

type PayrollGrantEligibilityInput = {
  hasEligibleRole: boolean;
  grantIsActive: boolean;
};

const ACTIVE_V1_JURISDICTION: PayrollJurisdiction = "CA";

export const isFailClosedPayrollJurisdiction = (
  jurisdiction: PayrollJurisdiction,
): boolean => jurisdiction !== ACTIVE_V1_JURISDICTION;

export const profileMatchesPayrollOrg = ({
  isActive,
  organizationId,
  resolvedOrganizationId,
  targetOrganizationId,
}: PayrollOrgProfileMatchInput): boolean =>
  isActive &&
  organizationId !== null &&
  organizationId === resolvedOrganizationId &&
  organizationId === targetOrganizationId;

export const hasActiveUserRole = (
  role: PayrollUserRoleWindow,
  now: Date,
): boolean => {
  if (!role.isActive) {
    return false;
  }

  if (!role.expiresAt) {
    return true;
  }

  return new Date(role.expiresAt).getTime() > now.getTime();
};

export const canGrantPayrollAdminCapability = ({
  hasEligibleRole,
  grantIsActive,
}: PayrollGrantEligibilityInput): boolean => hasEligibleRole && grantIsActive;

export const isPayrollAdminEligibleRole = (
  role: string,
): role is PayrollAdminEligibleRole =>
  PAYROLL_ADMIN_ELIGIBLE_ROLES.includes(role as PayrollAdminEligibleRole);
