import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AutoScheduleModal } from "../../../../src/components/AutoScheduleModal";
import { ProgramsGoalsTab } from "../../../../src/components/ClientDetails/ProgramsGoalsTab";

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

export function HarnessApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate replace to="/clients/test-client" />} />
          <Route path="/clients/test-client" element={<ClientDetailsHarnessRoute />} />
          <Route path="/schedule" element={<ScheduleHarnessRoute />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
