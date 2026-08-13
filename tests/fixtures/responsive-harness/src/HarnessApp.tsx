import { useEffect, type ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AutoScheduleModal } from "../../../../src/components/AutoScheduleModal";
import { ProgramsGoalsTab } from "../../../../src/components/ClientDetails/ProgramsGoalsTab";
import { DashboardView } from "../../../../src/pages/Dashboard";
import { Payroll } from "../../../../src/pages/Payroll";
import { TimeReview } from "../../../../src/pages/TimeReview";
import type { BtCorrectionTask } from "../../../../src/lib/supervision-session-notes";

import {
  harnessClient,
  harnessExistingSessions,
  harnessScheduleClients,
  harnessTherapists,
} from "./harness-data";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

const ShellFrame = ({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) => (
  <div className="min-h-screen bg-slate-100 text-slate-900">
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="rounded-2xl bg-slate-900 px-6 py-5 text-white shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">Responsive Harness</p>
        <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-200">{subtitle}</p>
      </header>
      {children}
    </div>
  </div>
);

const ClientDetailsHarnessRoute = () => (
  <ShellFrame
    title="Client Details"
    subtitle="Synthetic client shell rendering the production ProgramsGoalsTab with in-memory auth, org, and transport shims."
  >
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="rounded-2xl bg-white p-5 shadow">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Client Snapshot</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-slate-500">Name</dt>
            <dd className="font-medium text-slate-900">{harnessClient.full_name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Route</dt>
            <dd className="font-mono text-slate-900">/clients/test-client</dd>
          </div>
          <div>
            <dt className="text-slate-500">Auth mode</dt>
            <dd className="font-medium text-slate-900">In-memory midtier clinician</dd>
          </div>
        </dl>
      </aside>
      <section className="rounded-2xl bg-white p-5 shadow">
        <ProgramsGoalsTab client={harnessClient} />
      </section>
    </div>
  </ShellFrame>
);

const ScheduleHarnessRoute = () => (
  <ShellFrame
    title="Schedule"
    subtitle="Synthetic scheduling shell rendering the production AutoScheduleModal without cookies, storage, or remote transport."
  >
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Schedule lane</h2>
          <p className="mt-2 text-sm text-slate-600">Synthetic background card to mirror the production schedule surface.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Pathname-only route</h2>
          <p className="mt-2 font-mono text-sm text-slate-700">/schedule</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Storage mode</h2>
          <p className="mt-2 text-sm text-slate-600">No cookies, localStorage, or sessionStorage.</p>
        </div>
      </div>
      <AutoScheduleModal
        isOpen
        onClose={() => {}}
        onSchedule={async () => {}}
        therapists={harnessTherapists}
        clients={harnessScheduleClients}
        existingSessions={harnessExistingSessions}
      />
    </div>
  </ShellFrame>
);

const dashboardCorrectionResponses = {
  purpose_of_session: ["RBT/BT worked on goals as stated in the treatment plan"],
  client_status: "Synthetic client participated in the session.",
  skill_strategies: ["Natural environment teaching"],
  behavior_strategies: ["Differential Reinforcement"],
  supervisor_support: ["Discussed programs/progress/data collection"],
  progress_toward_goals: "Synthetic progress summary.",
  client_response_to_treatment: "Synthetic treatment response.",
  data_point_scope: "linked",
  link_unlinked_data: false,
  bt_signature: { method: "typed", value: "Synthetic BT" },
};

const dashboardCorrectionVersion = {
  versionNumber: 1,
  noteId: "responsive-note",
  source: "original" as const,
  correctionRound: null,
  responses: dashboardCorrectionResponses,
  templateSnapshot: { sections: [] },
  signatureMethod: "typed" as const,
  signatureValue: "Synthetic BT",
  signedAt: "2026-08-11T16:00:00.000Z",
};

const dashboardCorrectionTask: BtCorrectionTask = {
  id: "responsive-correction-request",
  organizationId: "responsive-harness-org",
  sessionId: "responsive-session",
  clientId: harnessClient.id,
  btTherapistId: "responsive-bt",
  assignedAdminUserId: "responsive-reviewer",
  status: "correction_required",
  statusLabel: "Correction Required",
  createdAt: "2026-08-11T16:00:00.000Z",
  clientName: harnessClient.full_name,
  btTherapistName: "Synthetic BT",
  btTherapistTitle: "BT",
  correction: {
    id: "responsive-correction",
    round: 1,
    reason: "Synthetic terminology review.",
    requestedAt: "2026-08-11T17:00:00.000Z",
    reviewerUserId: "responsive-reviewer",
  },
  originalVersion: dashboardCorrectionVersion,
  latestVersion: dashboardCorrectionVersion,
  versions: [],
};

const DashboardHarnessRoute = () => {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>("button[aria-label^='Amend BT Note for']")?.click();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <ShellFrame
      title="Dashboard"
      subtitle="Synthetic correction queue rendering the production DashboardView with persisted values and display-only terminology mapping."
    >
      <DashboardView
        isLoading={false}
        error={null}
        refetch={() => {}}
        isLiveRole={false}
        intervalMs={120_000}
        showReportsSummary={false}
        btCorrectionTasks={[dashboardCorrectionTask]}
        correctionOnly
        onResubmitBtCorrection={async () => {}}
      />
    </ShellFrame>
  );
};

const PayrollHarnessRoute = () => <Payroll />;

const TimeReviewHarnessRoute = () => <TimeReview />;

export function HarnessApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate replace to="/clients/test-client" />} />
          <Route path="/clients/test-client" element={<ClientDetailsHarnessRoute />} />
          <Route path="/schedule" element={<ScheduleHarnessRoute />} />
          <Route path="/dashboard" element={<DashboardHarnessRoute />} />
          <Route path="/payroll" element={<PayrollHarnessRoute />} />
          <Route path="/time/review" element={<TimeReviewHarnessRoute />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
