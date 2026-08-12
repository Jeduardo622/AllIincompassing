import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Lock, RotateCcw, ShieldAlert } from "lucide-react";
import { useAuth } from "../lib/authContext";
import { useActiveOrganizationId } from "../lib/organization";
import {
  hasAnyPayrollAdministrationCapability,
  type PayrollAdministrationActionInput,
  type PayrollAdministrationCapabilities,
  type PayrollAdministrationReadResponse,
} from "../features/payroll/administrationApi";
import { usePayrollAdministration } from "../features/payroll/usePayrollAdministration";

const tabs = ["Employment", "Pay Groups", "Periods", "Exceptions", "Approvals"] as const;
type PayrollTab = (typeof tabs)[number];

const buildIdempotencyKey = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;

const resolveBrowserLocalDate = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) {
    return "Not set";
  }
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const formatMoney = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const hasPayrollRouteAccess = (capabilities: PayrollAdministrationCapabilities): boolean =>
  hasAnyPayrollAdministrationCapability(capabilities);

const FailurePanel = ({ title, body }: { title: string; body: string }) => (
  <div className="mx-auto max-w-5xl px-4 py-10">
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-900/60 dark:bg-red-950/40">
      <div className="flex items-center gap-3 text-red-900 dark:text-red-100">
        <AlertCircle className="h-5 w-5" />
        <p className="text-lg font-semibold">{title}</p>
      </div>
      <p className="mt-2 text-sm text-red-700 dark:text-red-200">{body}</p>
    </div>
  </div>
);

const EmptyPanel = ({ title, body }: { title: string; body: string }) => (
  <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-dark-lighter dark:text-gray-300">
    <p className="font-medium text-gray-900 dark:text-white">{title}</p>
    <p className="mt-1">{body}</p>
  </div>
);

const SectionCard = ({ title, body, children }: React.PropsWithChildren<{ title: string; body?: string }>) => (
  <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
      {body ? <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{body}</p> : null}
    </div>
    {children}
  </section>
);

const Field = ({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string;
}) => (
  <label className="block text-sm">
    <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-dark"
    />
  </label>
);

const SelectField = ({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}) => (
  <label className="block text-sm">
    <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-dark"
    >
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  </label>
);

const MutationError = ({ error }: { error: unknown }) => {
  const message = ((error as { message?: string } | null)?.message) ?? "";
  if (!message) {
    return null;
  }
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100">
      {message}
    </div>
  );
};

const ActionButton = ({
  label,
  onClick,
  disabled = false,
  variant = "primary",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) => {
  const classes = variant === "danger"
    ? "bg-red-600 text-white hover:bg-red-700"
    : variant === "secondary"
      ? "bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
      : "bg-blue-600 text-white hover:bg-blue-700";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-gray-800 ${classes}`}
    >
      {label}
    </button>
  );
};

type ReviewSelection = { snapshotId: string; snapshotHash: string } | null;

function EmploymentTab({
  data,
  canConfigureEmployment,
  canViewCompensation,
  onAction,
  actionPending,
  actionError,
}: {
  data: PayrollAdministrationReadResponse;
  canConfigureEmployment: boolean;
  canViewCompensation: boolean;
  onAction: (action: PayrollAdministrationActionInput, prefix: string) => void;
  actionPending: boolean;
  actionError: unknown;
}) {
  const [orgForm, setOrgForm] = useState({
    externalPayrollOrganizationId: "",
    timezone: "America/Los_Angeles",
    effectiveFrom: data.selectedLocalDate,
    workdayStartsAt: "00:00:00",
    workweekStartsOn: "0",
  });
  const [employmentForm, setEmploymentForm] = useState({
    userId: "",
    employeeNumber: "",
    payrollEmployeeId: "",
    classification: "nonexempt",
    homeJurisdiction: "CA",
    timezone: "America/Los_Angeles",
    activeFrom: data.selectedLocalDate,
  });
  const [rateForm, setRateForm] = useState({
    employmentProfileId: "",
    hourlyRateCents: "0",
    effectiveFrom: `${data.selectedLocalDate}T00:00:00Z`,
  });
  const [managerForm, setManagerForm] = useState({
    employmentProfileId: "",
    managerUserId: "",
    effectiveFrom: `${data.selectedLocalDate}T00:00:00Z`,
    deactivateId: "",
    deactivateThrough: `${data.selectedLocalDate}T23:59:59Z`,
  });
  const [capabilityForm, setCapabilityForm] = useState({
    userId: "",
    capability: "payroll.configure_employment",
    effectiveFrom: `${data.selectedLocalDate}T00:00:00Z`,
    revokeThrough: `${data.selectedLocalDate}T23:59:59Z`,
  });

  return (
    <div className="grid gap-6">
      <SectionCard title="Organization settings" body="Effective-dated payroll organization settings sourced from the authoritative administration read model.">
        {data.orgSettings.length === 0 ? (
          <EmptyPanel title="No organization settings" body="Create the first effective-dated payroll organization settings version." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.orgSettings.map((setting) => (
              <div key={setting.id} className="rounded-xl border border-gray-100 p-3 text-sm dark:border-gray-800">
                <p className="font-medium text-gray-900 dark:text-white">{setting.externalPayrollOrganizationId}</p>
                <p className="mt-1 text-gray-600 dark:text-gray-300">{setting.timezone}</p>
                <p className="mt-1 text-gray-600 dark:text-gray-300">Workday starts {setting.workdayStartsAt}, week starts {setting.workweekStartsOn}</p>
                <p className="mt-1 text-gray-500 dark:text-gray-400">{setting.effectiveFrom} through {setting.effectiveThrough ?? "open"}</p>
              </div>
            ))}
          </div>
        )}
        {canConfigureEmployment ? (
          <div className="mt-4 grid gap-3 rounded-xl border border-gray-100 p-4 dark:border-gray-800 md:grid-cols-2">
            <Field label="External payroll org ID" value={orgForm.externalPayrollOrganizationId} onChange={(value) => setOrgForm((current) => ({ ...current, externalPayrollOrganizationId: value }))} />
            <Field label="Timezone" value={orgForm.timezone} onChange={(value) => setOrgForm((current) => ({ ...current, timezone: value }))} />
            <Field label="Effective from" type="date" value={orgForm.effectiveFrom} onChange={(value) => setOrgForm((current) => ({ ...current, effectiveFrom: value }))} />
            <Field label="Workday starts at" value={orgForm.workdayStartsAt} onChange={(value) => setOrgForm((current) => ({ ...current, workdayStartsAt: value }))} />
            <Field label="Workweek starts on" type="number" value={orgForm.workweekStartsOn} onChange={(value) => setOrgForm((current) => ({ ...current, workweekStartsOn: value }))} />
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <ActionButton
                label="Create org settings"
                disabled={actionPending || !orgForm.externalPayrollOrganizationId.trim()}
                onClick={() => onAction({
                  action: "create_org_settings",
                  effectiveFrom: orgForm.effectiveFrom,
                  externalPayrollOrganizationId: orgForm.externalPayrollOrganizationId.trim(),
                  timezone: orgForm.timezone.trim(),
                  workdayStartsAt: orgForm.workdayStartsAt.trim(),
                  workweekStartsOn: Number(orgForm.workweekStartsOn),
                }, "payroll-org-settings")}
              />
              <ActionButton
                label="Supersede org settings"
                variant="secondary"
                disabled={actionPending || !orgForm.externalPayrollOrganizationId.trim()}
                onClick={() => onAction({
                  action: "supersede_org_settings",
                  effectiveFrom: orgForm.effectiveFrom,
                  externalPayrollOrganizationId: orgForm.externalPayrollOrganizationId.trim(),
                  timezone: orgForm.timezone.trim(),
                  workdayStartsAt: orgForm.workdayStartsAt.trim(),
                  workweekStartsOn: Number(orgForm.workweekStartsOn),
                }, "payroll-org-settings")}
              />
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Policies" body="Policy activation is read-only in Task 4. No policy mutation controls render on this page.">
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          Policy list is read-only. No policy mutation controls exist in this UI.
        </div>
        {data.policies.length === 0 ? (
          <EmptyPanel title="No policies" body="The authoritative administration contract did not return policy activations." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.policies.map((policy) => (
              <div key={policy.id} className="rounded-xl border border-gray-100 p-3 text-sm dark:border-gray-800">
                <p className="font-medium text-gray-900 dark:text-white">{policy.policyName}</p>
                <p className="mt-1 text-gray-600 dark:text-gray-300">{policy.jurisdiction} · {policy.activationStatus}</p>
                <p className="mt-1 text-gray-500 dark:text-gray-400">{policy.effectiveFrom} through {policy.effectiveThrough ?? "open"}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Employments" body="Employment profiles and compensation visibility stay gated by the authoritative administration response.">
        {data.employments.length === 0 ? (
          <EmptyPanel title="No employments" body="No payroll employment profiles were returned for this organization." />
        ) : (
          <div className="grid gap-3">
            {data.employments.map((employment) => (
              <div key={employment.id} className="rounded-xl border border-gray-100 p-4 text-sm dark:border-gray-800">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{employment.employeeNumber} · {employment.payrollEmployeeId}</p>
                    <p className="mt-1 text-gray-600 dark:text-gray-300">{employment.classification} · {employment.homeJurisdiction} · {employment.timezone}</p>
                    <p className="mt-1 text-gray-500 dark:text-gray-400">{employment.activeFrom} through {employment.activeThrough ?? "open"}</p>
                    {canViewCompensation && employment.compensation ? (
                      <p className="mt-2 text-gray-700 dark:text-gray-200">Hourly rate: {formatMoney(employment.compensation.hourlyRateCents)}</p>
                    ) : null}
                  </div>
                  {canConfigureEmployment ? (
                    <ActionButton
                      label="Deactivate employment"
                      variant="secondary"
                      disabled={actionPending}
                      onClick={() => onAction({
                        action: "deactivate_employment",
                        employmentProfileId: employment.id,
                        effectiveThrough: data.selectedLocalDate,
                      }, "payroll-employment")}
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        {canConfigureEmployment ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
              <p className="mb-3 text-sm font-medium text-gray-900 dark:text-white">Create employment</p>
              <div className="grid gap-3">
                <Field label="User ID" value={employmentForm.userId} onChange={(value) => setEmploymentForm((current) => ({ ...current, userId: value }))} />
                <Field label="Employee number" value={employmentForm.employeeNumber} onChange={(value) => setEmploymentForm((current) => ({ ...current, employeeNumber: value }))} />
                <Field label="Payroll employee ID" value={employmentForm.payrollEmployeeId} onChange={(value) => setEmploymentForm((current) => ({ ...current, payrollEmployeeId: value }))} />
                <Field label="Classification" value={employmentForm.classification} onChange={(value) => setEmploymentForm((current) => ({ ...current, classification: value }))} />
                <Field label="Jurisdiction" value={employmentForm.homeJurisdiction} onChange={(value) => setEmploymentForm((current) => ({ ...current, homeJurisdiction: value }))} />
                <Field label="Timezone" value={employmentForm.timezone} onChange={(value) => setEmploymentForm((current) => ({ ...current, timezone: value }))} />
                <Field label="Active from" type="date" value={employmentForm.activeFrom} onChange={(value) => setEmploymentForm((current) => ({ ...current, activeFrom: value }))} />
                <ActionButton
                  label="Create employment"
                  disabled={actionPending || !employmentForm.userId.trim() || !employmentForm.employeeNumber.trim() || !employmentForm.payrollEmployeeId.trim()}
                  onClick={() => onAction({
                    action: "create_employment",
                    userId: employmentForm.userId.trim(),
                    employeeNumber: employmentForm.employeeNumber.trim(),
                    payrollEmployeeId: employmentForm.payrollEmployeeId.trim(),
                    classification: employmentForm.classification.trim(),
                    homeJurisdiction: employmentForm.homeJurisdiction.trim(),
                    timezone: employmentForm.timezone.trim(),
                    activeFrom: employmentForm.activeFrom,
                  }, "payroll-employment")}
                />
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
              <p className="mb-3 text-sm font-medium text-gray-900 dark:text-white">Rates, manager assignments, and capabilities</p>
              <div className="grid gap-3">
                <Field label="Employment profile ID" value={rateForm.employmentProfileId} onChange={(value) => setRateForm((current) => ({ ...current, employmentProfileId: value }))} />
                <Field label="Hourly rate cents" type="number" value={rateForm.hourlyRateCents} onChange={(value) => setRateForm((current) => ({ ...current, hourlyRateCents: value }))} />
                <Field label="Rate effective from" value={rateForm.effectiveFrom} onChange={(value) => setRateForm((current) => ({ ...current, effectiveFrom: value }))} />
                <ActionButton
                  label="Add rate version"
                  disabled={actionPending || !rateForm.employmentProfileId.trim()}
                  onClick={() => onAction({
                    action: "add_rate_version",
                    employmentProfileId: rateForm.employmentProfileId.trim(),
                    hourlyRateCents: Number(rateForm.hourlyRateCents),
                    effectiveFrom: rateForm.effectiveFrom.trim(),
                  }, "payroll-rate")}
                />
                <Field label="Manager user ID" value={managerForm.managerUserId} onChange={(value) => setManagerForm((current) => ({ ...current, managerUserId: value }))} />
                <Field label="Manager effective from" value={managerForm.effectiveFrom} onChange={(value) => setManagerForm((current) => ({ ...current, effectiveFrom: value }))} />
                <ActionButton
                  label="Create manager assignment"
                  disabled={actionPending || !managerForm.employmentProfileId.trim() || !managerForm.managerUserId.trim()}
                  onClick={() => onAction({
                    action: "create_manager_assignment",
                    employmentProfileId: managerForm.employmentProfileId.trim(),
                    managerUserId: managerForm.managerUserId.trim(),
                    effectiveFrom: managerForm.effectiveFrom.trim(),
                  }, "payroll-manager")}
                />
                <Field label="Deactivate manager assignment ID" value={managerForm.deactivateId} onChange={(value) => setManagerForm((current) => ({ ...current, deactivateId: value }))} />
                <Field label="Manager deactivate through" value={managerForm.deactivateThrough} onChange={(value) => setManagerForm((current) => ({ ...current, deactivateThrough: value }))} />
                <ActionButton
                  label="Deactivate manager assignment"
                  variant="secondary"
                  disabled={actionPending || !managerForm.deactivateId.trim()}
                  onClick={() => onAction({
                    action: "deactivate_manager_assignment",
                    managerAssignmentId: managerForm.deactivateId.trim(),
                    effectiveThrough: managerForm.deactivateThrough.trim(),
                  }, "payroll-manager")}
                />
                <Field label="Capability user ID" value={capabilityForm.userId} onChange={(value) => setCapabilityForm((current) => ({ ...current, userId: value }))} />
                <SelectField label="Capability" value={capabilityForm.capability} onChange={(value) => setCapabilityForm((current) => ({ ...current, capability: value }))} options={["payroll.configure_employment", "payroll.resolve_exceptions", "payroll.lock_period", "payroll.reopen_period", "payroll.view_compensation"]} />
                <Field label="Capability effective from" value={capabilityForm.effectiveFrom} onChange={(value) => setCapabilityForm((current) => ({ ...current, effectiveFrom: value }))} />
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    label="Grant capability"
                    disabled={actionPending || !capabilityForm.userId.trim()}
                    onClick={() => onAction({
                      action: "grant_capability",
                      userId: capabilityForm.userId.trim(),
                      capability: capabilityForm.capability as PayrollAdministrationActionInput["capability"],
                      effectiveFrom: capabilityForm.effectiveFrom.trim(),
                    }, "payroll-capability")}
                  />
                  <ActionButton
                    label="Revoke capability"
                    variant="secondary"
                    disabled={actionPending || !capabilityForm.userId.trim()}
                    onClick={() => onAction({
                      action: "revoke_capability",
                      userId: capabilityForm.userId.trim(),
                      capability: capabilityForm.capability as PayrollAdministrationActionInput["capability"],
                      effectiveThrough: capabilityForm.revokeThrough.trim(),
                    }, "payroll-capability")}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="mt-4">
          <MutationError error={actionError} />
        </div>
      </SectionCard>
    </div>
  );
}

function PayGroupsTab({
  data,
  canConfigureEmployment,
  onAction,
  actionPending,
  actionError,
}: {
  data: PayrollAdministrationReadResponse;
  canConfigureEmployment: boolean;
  onAction: (action: PayrollAdministrationActionInput, prefix: string) => void;
  actionPending: boolean;
  actionError: unknown;
}) {
  const [payGroupForm, setPayGroupForm] = useState({
    name: "",
    cadence: "biweekly",
    timezone: "America/Los_Angeles",
    effectiveFrom: data.selectedLocalDate,
    deactivateId: "",
    deactivateThrough: data.selectedLocalDate,
  });
  const [assignmentForm, setAssignmentForm] = useState({
    employmentProfileId: "",
    payGroupId: "",
    effectiveFrom: data.selectedLocalDate,
    deactivateId: "",
    deactivateThrough: data.selectedLocalDate,
  });

  return (
    <div className="grid gap-6">
      <SectionCard title="Pay groups" body="Cadence and timezone remain sourced from the payroll administration read model.">
        {data.payGroups.length === 0 ? (
          <EmptyPanel title="No pay groups" body="No pay groups were returned for this administration scope." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.payGroups.map((group) => (
              <div key={group.id} className="rounded-xl border border-gray-100 p-4 text-sm dark:border-gray-800">
                <p className="font-medium text-gray-900 dark:text-white">{group.name}</p>
                <p className="mt-1 text-gray-600 dark:text-gray-300">{group.cadence} · {group.timezone}</p>
                <p className="mt-1 text-gray-500 dark:text-gray-400">{group.effectiveFrom} through {group.effectiveThrough ?? "open"}</p>
              </div>
            ))}
          </div>
        )}
        {canConfigureEmployment ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
              <div className="grid gap-3">
                <Field label="Pay group name" value={payGroupForm.name} onChange={(value) => setPayGroupForm((current) => ({ ...current, name: value }))} />
                <SelectField label="Cadence" value={payGroupForm.cadence} onChange={(value) => setPayGroupForm((current) => ({ ...current, cadence: value }))} options={["weekly", "biweekly", "monthly"]} />
                <Field label="Timezone" value={payGroupForm.timezone} onChange={(value) => setPayGroupForm((current) => ({ ...current, timezone: value }))} />
                <Field label="Effective from" type="date" value={payGroupForm.effectiveFrom} onChange={(value) => setPayGroupForm((current) => ({ ...current, effectiveFrom: value }))} />
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    label="Create pay group"
                    disabled={actionPending || !payGroupForm.name.trim()}
                    onClick={() => onAction({
                      action: "create_pay_group",
                      name: payGroupForm.name.trim(),
                      cadence: payGroupForm.cadence as PayrollAdministrationActionInput["cadence"],
                      timezone: payGroupForm.timezone.trim(),
                      effectiveFrom: payGroupForm.effectiveFrom,
                    }, "payroll-pay-group")}
                  />
                  <ActionButton
                    label="Deactivate pay group"
                    variant="secondary"
                    disabled={actionPending || !payGroupForm.deactivateId.trim()}
                    onClick={() => onAction({
                      action: "deactivate_pay_group",
                      payGroupId: payGroupForm.deactivateId.trim(),
                      effectiveThrough: payGroupForm.deactivateThrough,
                    }, "payroll-pay-group")}
                  />
                </div>
                <Field label="Deactivate pay group ID" value={payGroupForm.deactivateId} onChange={(value) => setPayGroupForm((current) => ({ ...current, deactivateId: value }))} />
                <Field label="Deactivate through" type="date" value={payGroupForm.deactivateThrough} onChange={(value) => setPayGroupForm((current) => ({ ...current, deactivateThrough: value }))} />
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
              <div className="grid gap-3">
                <Field label="Employment profile ID" value={assignmentForm.employmentProfileId} onChange={(value) => setAssignmentForm((current) => ({ ...current, employmentProfileId: value }))} />
                <Field label="Pay group ID" value={assignmentForm.payGroupId} onChange={(value) => setAssignmentForm((current) => ({ ...current, payGroupId: value }))} />
                <Field label="Assignment effective from" type="date" value={assignmentForm.effectiveFrom} onChange={(value) => setAssignmentForm((current) => ({ ...current, effectiveFrom: value }))} />
                <ActionButton
                  label="Create pay group assignment"
                  disabled={actionPending || !assignmentForm.employmentProfileId.trim() || !assignmentForm.payGroupId.trim()}
                  onClick={() => onAction({
                    action: "create_pay_group_assignment",
                    employmentProfileId: assignmentForm.employmentProfileId.trim(),
                    payGroupId: assignmentForm.payGroupId.trim(),
                    effectiveFrom: assignmentForm.effectiveFrom,
                  }, "payroll-pay-group-assignment")}
                />
                <Field label="Deactivate assignment ID" value={assignmentForm.deactivateId} onChange={(value) => setAssignmentForm((current) => ({ ...current, deactivateId: value }))} />
                <Field label="Deactivate through" type="date" value={assignmentForm.deactivateThrough} onChange={(value) => setAssignmentForm((current) => ({ ...current, deactivateThrough: value }))} />
                <ActionButton
                  label="Deactivate pay group assignment"
                  variant="secondary"
                  disabled={actionPending || !assignmentForm.deactivateId.trim()}
                  onClick={() => onAction({
                    action: "deactivate_pay_group_assignment",
                    payGroupAssignmentId: assignmentForm.deactivateId.trim(),
                    effectiveThrough: assignmentForm.deactivateThrough,
                  }, "payroll-pay-group-assignment")}
                />
              </div>
            </div>
          </div>
        ) : null}
        <div className="mt-4">
          <MutationError error={actionError} />
        </div>
      </SectionCard>
    </div>
  );
}

function PeriodsTab({
  data,
  canConfigureEmployment,
  canGeneratePeriods,
  onAction,
  actionPending,
  actionError,
}: {
  data: PayrollAdministrationReadResponse;
  canConfigureEmployment: boolean;
  canGeneratePeriods: boolean;
  onAction: (action: PayrollAdministrationActionInput, prefix: string) => void;
  actionPending: boolean;
  actionError: unknown;
}) {
  const [generationForm, setGenerationForm] = useState({
    payGroupId: data.payGroups[0]?.id ?? "",
    cadence: "biweekly",
    startsOn: data.selectedLocalDate,
    effectiveFrom: data.selectedLocalDate,
    timezone: data.payGroups[0]?.timezone ?? "America/Los_Angeles",
    from: data.selectedLocalDate,
    to: data.selectedLocalDate,
  });

  return (
    <div className="grid gap-6">
      <SectionCard title="Generation versions" body="Generation versions stay immutable and effective-dated.">
        {data.generationVersions.length === 0 ? (
          <EmptyPanel title="No generation versions" body="No generation versions were returned for the current administration scope." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.generationVersions.map((version) => (
              <div key={version.id} className="rounded-xl border border-gray-100 p-4 text-sm dark:border-gray-800">
                <p className="font-medium text-gray-900 dark:text-white">{version.payGroupId}</p>
                <p className="mt-1 text-gray-600 dark:text-gray-300">{version.cadence} from {version.startsOn}</p>
                <p className="mt-1 text-gray-500 dark:text-gray-400">{version.effectiveFrom} through {version.effectiveThrough ?? "open"}</p>
              </div>
            ))}
          </div>
        )}
        {canConfigureEmployment ? (
          <div className="mt-4 rounded-xl border border-gray-100 p-4 dark:border-gray-800">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Pay group ID" value={generationForm.payGroupId} onChange={(value) => setGenerationForm((current) => ({ ...current, payGroupId: value }))} />
              <SelectField label="Cadence" value={generationForm.cadence} onChange={(value) => setGenerationForm((current) => ({ ...current, cadence: value }))} options={["weekly", "biweekly"]} />
              <Field label="Starts on" type="date" value={generationForm.startsOn} onChange={(value) => setGenerationForm((current) => ({ ...current, startsOn: value }))} />
              <Field label="Effective from" type="date" value={generationForm.effectiveFrom} onChange={(value) => setGenerationForm((current) => ({ ...current, effectiveFrom: value }))} />
              <Field label="Timezone" value={generationForm.timezone} onChange={(value) => setGenerationForm((current) => ({ ...current, timezone: value }))} />
            </div>
            <div className="mt-3">
              <ActionButton
                label="Set generation version"
                disabled={actionPending || !generationForm.payGroupId.trim()}
                onClick={() => onAction({
                  action: "set_generation_version",
                  payGroupId: generationForm.payGroupId.trim(),
                  cadence: generationForm.cadence as PayrollAdministrationActionInput["cadence"],
                  effectiveFrom: generationForm.effectiveFrom,
                  startsOn: generationForm.startsOn,
                  timezone: generationForm.timezone.trim(),
                }, "payroll-generation")}
              />
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Pay periods" body="Existing periods remain authoritative. Generation cannot widen access beyond payroll capabilities.">
        {data.payPeriods.length === 0 ? (
          <EmptyPanel title="No pay periods" body="Generate periods after a pay group and generation version exist." />
        ) : (
          <div className="grid gap-3">
            {data.payPeriods.map((period) => (
              <div key={period.id} className="rounded-xl border border-gray-100 p-4 text-sm dark:border-gray-800">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{period.startsOn} through {period.endsOn}</p>
                    <p className="mt-1 text-gray-600 dark:text-gray-300">Pay group {period.payGroupId}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span>Locked: {formatTimestamp(period.lockedAt)}</span>
                    <span>Exported: {formatTimestamp(period.exportedAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {canGeneratePeriods ? (
          <div className="mt-4 rounded-xl border border-gray-100 p-4 dark:border-gray-800">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Pay group ID" value={generationForm.payGroupId} onChange={(value) => setGenerationForm((current) => ({ ...current, payGroupId: value }))} />
              <Field label="Generate from" type="date" value={generationForm.from} onChange={(value) => setGenerationForm((current) => ({ ...current, from: value }))} />
              <Field label="Generate to" type="date" value={generationForm.to} onChange={(value) => setGenerationForm((current) => ({ ...current, to: value }))} />
            </div>
            <div className="mt-3">
              <ActionButton
                label="Generate periods"
                disabled={actionPending || !generationForm.payGroupId.trim()}
                onClick={() => onAction({
                  action: "generate_periods",
                  payGroupId: generationForm.payGroupId.trim(),
                  from: generationForm.from,
                  to: generationForm.to,
                }, "payroll-generate-periods")}
              />
            </div>
          </div>
        ) : null}
        <div className="mt-4">
          <MutationError error={actionError} />
        </div>
      </SectionCard>
    </div>
  );
}

function ExceptionsTab({
  reviewQueue,
  reviewDetails,
  canResolveExceptions,
}: {
  reviewQueue: ReturnType<typeof usePayrollAdministration>["reviewQueueQuery"]["data"];
  reviewDetails: ReturnType<typeof usePayrollAdministration>["reviewDetailsQuery"]["data"];
  canResolveExceptions: boolean;
}) {
  return (
    <div className="grid gap-6">
      <SectionCard title="Blocking exceptions" body="Blocker visibility comes from the immutable payroll approval review surfaces.">
        {!reviewQueue || reviewQueue.queue.length === 0 ? (
          <EmptyPanel title="No pending exception rows" body="The review queue did not return any payroll snapshots for exception review." />
        ) : (
          <div className="grid gap-3">
            {reviewQueue.queue.map((item) => (
              <div key={`${item.employmentProfileId}-${item.payPeriodId}`} className="rounded-xl border border-gray-100 p-4 text-sm dark:border-gray-800">
                <p className="font-medium text-gray-900 dark:text-white">{item.employeeLabel}</p>
                <p className="mt-1 text-gray-600 dark:text-gray-300">State: {item.state}</p>
                <p className="mt-1 text-gray-600 dark:text-gray-300">Blocking issues: {item.blockerCount}</p>
              </div>
            ))}
          </div>
        )}
        {reviewDetails ? (
          <div className="mt-4 rounded-xl border border-gray-100 p-4 dark:border-gray-800">
            <p className="font-medium text-gray-900 dark:text-white">Selected snapshot blockers</p>
            {reviewDetails.blockers.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">No blocker details are available for this snapshot.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {reviewDetails.blockers.map((blocker, index) => (
                  <li key={`${blocker.blockerType}-${blocker.blockerId}-${index}`} className="rounded-xl border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
                    <p className="font-medium text-gray-900 dark:text-white">{blocker.blockerType}</p>
                    <p className="mt-1 text-gray-600 dark:text-gray-300">{blocker.state}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-dark">
          {canResolveExceptions
            ? "Exception review authority is present, but punch editing remains disabled here. Use the existing correction request flow for source-event changes."
            : "This route surfaces blocker visibility only. Punch editing is never available in payroll administration."}
        </div>
      </SectionCard>
    </div>
  );
}

function ApprovalsTab({
  reviewQueue,
  reviewDetails,
  selectedReview,
  onSelectReview,
  canLockPeriod,
  canReopenPeriod,
  canViewCompensation,
  onLock,
  onReopen,
  lockPending,
  reopenPending,
  actionError,
}: {
  reviewQueue: ReturnType<typeof usePayrollAdministration>["reviewQueueQuery"]["data"];
  reviewDetails: ReturnType<typeof usePayrollAdministration>["reviewDetailsQuery"]["data"];
  selectedReview: ReviewSelection;
  onSelectReview: (value: ReviewSelection) => void;
  canLockPeriod: boolean;
  canReopenPeriod: boolean;
  canViewCompensation: boolean;
  onLock: (snapshotId: string, snapshotHash: string) => void;
  onReopen: (snapshotId: string, snapshotHash: string) => void;
  lockPending: boolean;
  reopenPending: boolean;
  actionError: unknown;
}) {
  if (!reviewQueue || reviewQueue.queue.length === 0) {
    return (
      <SectionCard title="Approvals" body="Lock and reopen actions are driven from the immutable approval queue.">
        <EmptyPanel title="No approval rows" body="The authoritative approval queue is empty for the selected payroll date." />
      </SectionCard>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem,1fr]">
      <SectionCard title="Approval queue" body="Select an authoritative snapshot to inspect or change period state.">
        <div className="space-y-3">
          {reviewQueue.queue.map((item) => {
            const selectable = Boolean(item.snapshot.id && item.snapshot.hash);
            const isSelected = item.snapshot.id === selectedReview?.snapshotId && item.snapshot.hash === selectedReview?.snapshotHash;
            return (
              <button
                key={`${item.employmentProfileId}-${item.payPeriodId}`}
                type="button"
                disabled={!selectable}
                onClick={() => selectable && onSelectReview({ snapshotId: item.snapshot.id!, snapshotHash: item.snapshot.hash! })}
                className={`w-full rounded-xl border px-3 py-3 text-left text-sm dark:border-gray-800 ${isSelected ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30" : "border-gray-100 bg-white dark:bg-dark-lighter"}`}
              >
                <p className="font-medium text-gray-900 dark:text-white">{item.employeeLabel}</p>
                <p className="mt-1 text-gray-600 dark:text-gray-300">{item.periodStart} through {item.periodEnd}</p>
                <p className="mt-1 text-gray-600 dark:text-gray-300">State: {item.state}</p>
                <p className="mt-1 text-gray-600 dark:text-gray-300">Blockers: {item.blockerCount}</p>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Approval details" body="This view stays immutable. It does not permit punch editing.">
        {!selectedReview || !reviewDetails ? (
          <EmptyPanel title="No approval details selected" body="Select a queue row to review blocker state, history, and lock controls." />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300">{reviewDetails.periodStart} through {reviewDetails.periodEnd}</p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Unresolved blockers: {reviewDetails.unresolvedBlockerCount}</p>
              </div>
              {canViewCompensation && reviewDetails.compensation ? (
                <div className="rounded-xl border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
                  Gross earnings: {formatMoney(reviewDetails.compensation.grossEarningsCents)}
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-gray-100 p-3 text-sm dark:border-gray-800">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Regular</p>
                <p className="mt-2 font-semibold text-gray-900 dark:text-white">{(reviewDetails.classifiedSeconds.regular / 3600).toFixed(2)}h</p>
              </div>
              <div className="rounded-xl border border-gray-100 p-3 text-sm dark:border-gray-800">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Overtime</p>
                <p className="mt-2 font-semibold text-gray-900 dark:text-white">{(reviewDetails.classifiedSeconds.overtime / 3600).toFixed(2)}h</p>
              </div>
              <div className="rounded-xl border border-gray-100 p-3 text-sm dark:border-gray-800">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Double time</p>
                <p className="mt-2 font-semibold text-gray-900 dark:text-white">{(reviewDetails.classifiedSeconds.doubleTime / 3600).toFixed(2)}h</p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
              <p className="font-medium text-gray-900 dark:text-white">Approval history</p>
              {reviewDetails.approvalHistory.length === 0 ? (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">No approval history entries were returned for this snapshot.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {reviewDetails.approvalHistory.map((entry, index) => (
                    <li key={`${entry.snapshotId}-${index}`} className="rounded-xl border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
                      <p className="font-medium text-gray-900 dark:text-white">{entry.action}</p>
                      <p className="mt-1 text-gray-600 dark:text-gray-300">{formatTimestamp(entry.occurredAt)}</p>
                      {entry.comment ? <p className="mt-1 text-gray-600 dark:text-gray-300">{entry.comment}</p> : null}
                      {entry.reason ? <p className="mt-1 text-gray-600 dark:text-gray-300">{entry.reason}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
              <p className="font-medium text-gray-900 dark:text-white">Blockers</p>
              {reviewDetails.blockers.length === 0 ? (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">No blocker details are available for this snapshot.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {reviewDetails.blockers.map((blocker) => (
                    <li key={`${blocker.blockerType}-${blocker.blockerId}`} className="rounded-xl border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
                      <p className="font-medium text-gray-900 dark:text-white">{blocker.blockerType}</p>
                      <p className="mt-1 text-gray-600 dark:text-gray-300">{blocker.state}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {canLockPeriod ? (
                <ActionButton
                  label="Lock period"
                  disabled={lockPending || reviewDetails.unresolvedBlockerCount > 0}
                  onClick={() => onLock(reviewDetails.snapshotId, reviewDetails.snapshotHash)}
                />
              ) : null}
              {canReopenPeriod ? (
                <ActionButton
                  label="Reopen period"
                  variant="secondary"
                  disabled={reopenPending}
                  onClick={() => onReopen(reviewDetails.snapshotId, reviewDetails.snapshotHash)}
                />
              ) : null}
            </div>
            <MutationError error={actionError} />
          </div>
        )}
      </SectionCard>
    </div>
  );
}

export function Payroll() {
  const { user, loading, profileLoading } = useAuth();
  const organizationId = useActiveOrganizationId();
  const [activeTab, setActiveTab] = useState<PayrollTab>("Employment");
  const [selectedReview, setSelectedReview] = useState<ReviewSelection>(null);

  const scope = useMemo(() => ({
    organizationId: organizationId ?? "NO_ORG",
    userId: user?.id ?? "NO_USER",
    localDate: resolveBrowserLocalDate(),
  }), [organizationId, user?.id]);

  const {
    administrationQuery,
    reviewQueueQuery,
    reviewDetailsQuery,
    administrationActionMutation,
    lockPayrollTimesheetMutation,
    reopenPayrollTimesheetMutation,
  } = usePayrollAdministration(scope, {
    enabled: Boolean(organizationId && user?.id),
    queueEnabled: Boolean(organizationId && user?.id),
    selectedReview,
  });

  useEffect(() => {
    const firstSelectable = reviewQueueQuery.data?.queue.find((item) => item.snapshot.id && item.snapshot.hash);
    if (!firstSelectable?.snapshot.id || !firstSelectable.snapshot.hash) {
      setSelectedReview(null);
      return;
    }
    setSelectedReview((current) => {
      if (current && reviewQueueQuery.data?.queue.some((item) => (
        item.snapshot.id === current.snapshotId && item.snapshot.hash === current.snapshotHash
      ))) {
        return current;
      }
      return {
        snapshotId: firstSelectable.snapshot.id,
        snapshotHash: firstSelectable.snapshot.hash,
      };
    });
  }, [reviewQueueQuery.data?.queue]);

  const runAction = (action: PayrollAdministrationActionInput, prefix: string) => {
    void administrationActionMutation.mutateAsync({
      idempotencyKey: buildIdempotencyKey(prefix),
      action,
    });
  };

  const administration = administrationQuery.data;

  if (loading || profileLoading || administrationQuery.isLoading) {
    return (
      <div className="mx-auto flex max-w-5xl items-center justify-center px-4 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <p className="text-lg font-semibold text-gray-900 dark:text-white">Loading payroll administration</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Waiting for authoritative payroll administration capabilities.</p>
        </div>
      </div>
    );
  }

  if (!organizationId || !user?.id) {
    return <FailurePanel title="Payroll administration is unavailable" body="The payroll administration route stays fail-closed until user and organization scope resolve." />;
  }

  if (administrationQuery.isError || !administration) {
    return <FailurePanel title="Payroll administration is unavailable" body="The authoritative payroll administration response could not be loaded." />;
  }

  if (!hasPayrollRouteAccess(administration.capabilities)) {
    return <FailurePanel title="Payroll administration is unavailable" body="The authoritative payroll administration capabilities did not grant access for this route." />;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Payroll</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Administration UI for {administration.selectedLocalDate}. Compensation stays redacted unless the authoritative response grants visibility.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-dark-lighter">
            Configure employment: {administration.capabilities.canConfigureEmployment ? "yes" : "no"}
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-dark-lighter">
            Resolve exceptions: {administration.capabilities.canResolveExceptions ? "yes" : "no"}
          </div>
          <ActionButton label="Refresh payroll data" variant="secondary" onClick={() => void administrationQuery.refetch()} />
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${activeTab === tab ? "bg-blue-600 text-white" : "bg-white text-gray-700 shadow-sm dark:bg-dark-lighter dark:text-gray-200"}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Employment" ? (
        <EmploymentTab
          data={administration}
          canConfigureEmployment={administration.capabilities.canConfigureEmployment}
          canViewCompensation={administration.capabilities.canViewCompensation}
          onAction={runAction}
          actionPending={administrationActionMutation.isPending}
          actionError={administrationActionMutation.error}
        />
      ) : null}

      {activeTab === "Pay Groups" ? (
        <PayGroupsTab
          data={administration}
          canConfigureEmployment={administration.capabilities.canConfigureEmployment}
          onAction={runAction}
          actionPending={administrationActionMutation.isPending}
          actionError={administrationActionMutation.error}
        />
      ) : null}

      {activeTab === "Periods" ? (
        <PeriodsTab
          data={administration}
          canConfigureEmployment={administration.capabilities.canConfigureEmployment}
          canGeneratePeriods={administration.capabilities.canGeneratePeriods}
          onAction={runAction}
          actionPending={administrationActionMutation.isPending}
          actionError={administrationActionMutation.error}
        />
      ) : null}

      {activeTab === "Exceptions" ? (
        <ExceptionsTab
          reviewQueue={reviewQueueQuery.data}
          reviewDetails={reviewDetailsQuery.data}
          canResolveExceptions={administration.capabilities.canResolveExceptions}
        />
      ) : null}

      {activeTab === "Approvals" ? (
        <ApprovalsTab
          reviewQueue={reviewQueueQuery.data}
          reviewDetails={reviewDetailsQuery.data}
          selectedReview={selectedReview}
          onSelectReview={setSelectedReview}
          canLockPeriod={administration.capabilities.canLockPeriod}
          canReopenPeriod={administration.capabilities.canReopenPeriod}
          canViewCompensation={administration.capabilities.canViewCompensation}
          onLock={(snapshotId, snapshotHash) => void lockPayrollTimesheetMutation.mutateAsync({
            ...scope,
            idempotencyKey: buildIdempotencyKey("payroll-lock"),
            snapshotId,
            snapshotHash,
          })}
          onReopen={(snapshotId, snapshotHash) => void reopenPayrollTimesheetMutation.mutateAsync({
            ...scope,
            idempotencyKey: buildIdempotencyKey("payroll-reopen"),
            snapshotId,
            snapshotHash,
            reason: "Payroll administration review requested reopen.",
          })}
          lockPending={lockPayrollTimesheetMutation.isPending}
          reopenPending={reopenPayrollTimesheetMutation.isPending}
          actionError={lockPayrollTimesheetMutation.error ?? reopenPayrollTimesheetMutation.error}
        />
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <ShieldAlert className="h-4 w-4" />
            Policy changes
          </div>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">Read-only in Task 4. No policy mutation controls render.</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Lock className="h-4 w-4" />
            Punch editing
          </div>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">Never available in payroll approvals. Corrections stay in the existing request flow.</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <RotateCcw className="h-4 w-4" />
            Export actions
          </div>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">No export UI or export action renders until Task 5.</p>
        </div>
      </div>
    </div>
  );
}
