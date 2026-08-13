import {
  HARNESS_CLIENT_ID,
  HARNESS_GOAL_ID,
  HARNESS_PROGRAM_ID,
  HARNESS_TARGET_ID,
  harnessCriteria,
  harnessGoals,
  harnessProgramNotes,
  harnessPrograms,
  harnessTargets,
  harnessTrialEvents,
} from "../harness-data";
import { recordApiCall } from "../runtime";

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });

const methodFromInit = (init?: RequestInit) => (init?.method ?? "GET").toUpperCase();

export const getCurrentAccessToken = async (): Promise<null> => null;

export const callEdgeFunctionHttp = async (path: string, init?: RequestInit): Promise<Response> => {
  const method = methodFromInit(init);
  recordApiCall(method, path);

  if (method !== "GET") {
    return jsonResponse({ error: "responsive_harness_read_only" }, 405);
  }

  if (path === `programs?client_id=${HARNESS_CLIENT_ID}`) {
    return jsonResponse(harnessPrograms);
  }
  if (path === `goals?program_id=${HARNESS_PROGRAM_ID}`) {
    return jsonResponse(harnessGoals);
  }
  if (path === `goal-targets?goal_id=${HARNESS_GOAL_ID}`) {
    return jsonResponse(harnessTargets);
  }
  if (path === `goal-targets?action=criteria&target_id=${HARNESS_TARGET_ID}`) {
    return jsonResponse(harnessCriteria);
  }
  if (path === `goal-targets?action=transition_history&target_id=${HARNESS_TARGET_ID}`) {
    return jsonResponse([]);
  }
  if (path === `trial-events?target_id=${HARNESS_TARGET_ID}`) {
    return jsonResponse(harnessTrialEvents);
  }
  if (path === `program-notes?program_id=${HARNESS_PROGRAM_ID}`) {
    return jsonResponse(harnessProgramNotes);
  }

  return jsonResponse([]);
};

export const callApi = async (path: string, init?: RequestInit): Promise<Response> => {
  const method = methodFromInit(init);
  recordApiCall(method, path);

  if (method === "POST" && path === "/api/payroll-administration") {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    if (!body || body.action !== "get_administration" || typeof body.selectedLocalDate !== "string" || Object.keys(body).length !== 2) {
      return jsonResponse({ error: "responsive_harness_read_only" }, 405);
    }
    return jsonResponse({
      state: "ok",
      selectedLocalDate: body.selectedLocalDate,
      capabilities: {
        canConfigureEmployment: true,
        canResolveExceptions: true,
        canLockPeriod: true,
        canReopenPeriod: true,
        canGeneratePeriods: true,
        canExportPeriod: false,
        canViewCompensation: false,
        canManagePolicyMutations: false,
      },
      orgSettings: [{
        id: "10000000-0000-4000-8000-000000000001",
        externalPayrollOrganizationId: "responsive-payroll",
        timezone: "America/Los_Angeles",
        workdayStartsAt: "05:00:00",
        workweekStartsOn: 0,
        effectiveFrom: "2026-08-01",
        effectiveThrough: null,
      }],
      policies: [{
        id: "10000000-0000-4000-8000-000000000002",
        jurisdiction: "CA",
        policyName: "Synthetic nonexempt policy",
        activationStatus: "active",
        supportsMonthlyNonexempt: false,
        effectiveFrom: "2026-08-01",
        effectiveThrough: null,
        mutationsReadOnlyInV1: true,
      }],
      employments: [{
        id: "10000000-0000-4000-8000-000000000003",
        userId: "10000000-0000-4000-8000-000000000004",
        employeeNumber: "EMP-1001",
        payrollEmployeeId: "PAY-1001",
        classification: "nonexempt",
        homeJurisdiction: "CA",
        timezone: "America/Los_Angeles",
        activeFrom: "2026-08-01",
        activeThrough: null,
      }],
      payGroups: [{
        id: "10000000-0000-4000-8000-000000000005",
        name: "Synthetic biweekly",
        cadence: "biweekly",
        timezone: "America/Los_Angeles",
        effectiveFrom: "2026-08-01",
        effectiveThrough: null,
      }],
      generationVersions: [{
        id: "10000000-0000-4000-8000-000000000006",
        payGroupId: "10000000-0000-4000-8000-000000000005",
        cadence: "biweekly",
        startsOn: "2026-08-01",
        timezone: "America/Los_Angeles",
        effectiveFrom: "2026-08-01",
        effectiveThrough: null,
      }],
      payPeriods: [{
        id: "10000000-0000-4000-8000-000000000007",
        payGroupId: "10000000-0000-4000-8000-000000000005",
        startsOn: "2026-08-01",
        endsOn: "2026-08-14",
        lockedAt: "2026-08-12T18:30:00.000Z",
        exportedAt: "2026-08-12T19:00:00.000Z",
        latestExport: null,
      }],
      bounds: {
        orgSettings: 50,
        policies: 20,
        employments: 50,
        payGroups: 50,
        generationVersions: 50,
        payPeriods: 50,
      },
    });
  }

  if (method === "POST" && path === "/api/payroll-approvals") {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    if (body?.action === "review_queue" && typeof body.selectedLocalDate === "string" && Object.keys(body).length === 2) {
      return jsonResponse({
        state: "ok",
        selectedLocalDate: body.selectedLocalDate,
        capabilities: {
          canReviewAssigned: true,
          canApproveAssigned: true,
          canViewCompensation: false,
          hasOrgPayrollAccess: false,
        },
        queue: [{
          employeeLabel: "Employee 1001",
          employmentProfileId: "10000000-0000-4000-8000-000000000003",
          payPeriodId: "10000000-0000-4000-8000-000000000007",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-14",
          state: "submitted",
          blockerCount: 1,
          submittedAt: "2026-08-12T18:00:00.000Z",
          snapshot: {
            id: "10000000-0000-4000-8000-000000000008",
            hash: "a".repeat(64),
          },
          classifiedSeconds: { regular: 28800, overtime: 3600, doubleTime: 0 },
        }],
      });
    }
    if (
      body?.action === "review_details"
      && body.snapshotId === "10000000-0000-4000-8000-000000000008"
      && body.snapshotHash === "a".repeat(64)
      && Object.keys(body).length === 3
    ) {
      return jsonResponse({
        state: "ok",
        snapshotId: body.snapshotId,
        snapshotHash: body.snapshotHash,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-14",
        punches: [],
        classifiedSeconds: { regular: 28800, overtime: 3600, doubleTime: 0 },
        approvalHistory: [],
        blockers: [{
          blockerType: "timekeeping_exception",
          blockerId: "10000000-0000-4000-8000-000000000009",
          state: "open",
          createdAt: "2026-08-12T19:00:00.000Z",
        }],
        unresolvedBlockerCount: 1,
      });
    }
    return jsonResponse({ error: "responsive_harness_read_only" }, 405);
  }

  if (method !== "GET") {
    return jsonResponse({ error: "responsive_harness_read_only" }, 405);
  }

  if (path.startsWith(`/api/assessment-documents?client_id=${HARNESS_CLIENT_ID}`)) {
    return jsonResponse([]);
  }
  if (path.startsWith("/api/assessment-checklist?")) {
    return jsonResponse({ items: [], structured_sections: [] });
  }
  if (path.startsWith("/api/assessment-drafts?")) {
    return jsonResponse({ programs: [], goals: [] });
  }

  return jsonResponse([]);
};
