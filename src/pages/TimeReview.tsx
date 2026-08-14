import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useAuth } from "../lib/authContext";
import { useActiveOrganizationId } from "../lib/organization";
import { usePayrollApprovals } from "../features/payroll/usePayrollApprovals";

const formatTimestamp = (value: string, timeZone?: string | null): string =>
  new Date(value).toLocaleString(undefined, {
    timeZone: timeZone ?? undefined,
    dateStyle: "medium",
    timeStyle: "short",
  });

const formatHours = (seconds: number): string => `${(seconds / 3600).toFixed(2)}h`;

const buildIdempotencyKey = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;

const FailurePanel = ({ title, body }: { title: string; body: string }) => (
  <div className="mx-auto max-w-4xl px-4 py-10">
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-900/60 dark:bg-red-950/40">
      <div className="flex items-center gap-3 text-red-900 dark:text-red-100">
        <AlertCircle className="h-5 w-5" />
        <p className="text-lg font-semibold">{title}</p>
      </div>
      <p className="mt-2 text-sm text-red-700 dark:text-red-200">{body}</p>
    </div>
  </div>
);

export function TimeReview() {
  const { user, loading, profileLoading } = useAuth();
  const organizationId = useActiveOrganizationId();
  const [selectedLocalDate] = useState(() => new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()));
  const [selectedSnapshot, setSelectedSnapshot] = useState<{ snapshotId: string; snapshotHash: string } | null>(null);
  const [returnComment, setReturnComment] = useState("");

  const scope = useMemo(() => ({
    organizationId: organizationId ?? "NO_ORG",
    userId: user?.id ?? "NO_USER",
    localDate: selectedLocalDate,
  }), [organizationId, selectedLocalDate, user?.id]);

  const {
    payrollReviewQueueQuery,
    payrollReviewDetailsQuery,
    approvePayrollTimesheetMutation,
    returnPayrollTimesheetMutation,
  } = usePayrollApprovals(scope, {
    selfEnabled: false,
    queueEnabled: Boolean(organizationId && user?.id),
    details: selectedSnapshot,
  });

  useEffect(() => {
    const validRows = payrollReviewQueueQuery.data?.queue.filter(
      (item) => item.snapshot.id && item.snapshot.hash,
    ) ?? [];
    const head = validRows[0] ?? null;
    if (!head?.snapshot.id || !head.snapshot.hash) {
      setSelectedSnapshot(null);
      return;
    }
    setSelectedSnapshot((current) => {
      if (current && validRows.some((item) => (
        item.snapshot.id === current.snapshotId
        && item.snapshot.hash === current.snapshotHash
      ))) {
        return current;
      }
      return {
        snapshotId: head.snapshot.id,
        snapshotHash: head.snapshot.hash,
      };
    });
  }, [payrollReviewQueueQuery.data?.queue]);

  useEffect(() => {
    setReturnComment("");
  }, [selectedSnapshot?.snapshotId, selectedSnapshot?.snapshotHash]);

  if (loading || profileLoading || payrollReviewQueueQuery.isLoading) {
    return (
      <div className="mx-auto flex max-w-5xl items-center justify-center px-4 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <p className="text-lg font-semibold text-gray-900 dark:text-white">Loading time review</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Waiting for authoritative payroll review scope.</p>
        </div>
      </div>
    );
  }

  if (!organizationId || !user?.id) {
    return <FailurePanel title="Time review is unavailable" body="The payroll review route stays fail-closed until user and organization scope resolve." />;
  }

  if (payrollReviewQueueQuery.isError || !payrollReviewQueueQuery.data) {
    return <FailurePanel title="Time review is unavailable" body="The authoritative payroll review queue could not be loaded." />;
  }

  const queue = payrollReviewQueueQuery.data;
  const canReview = queue.capabilities.canReviewAssigned || queue.capabilities.canApproveAssigned;
  if (queue.state !== "ok" || !canReview) {
    return <FailurePanel title="Time review is unavailable" body="The authoritative payroll review queue did not grant review access for this route." />;
  }

  if (queue.queue.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <p className="text-lg font-semibold text-gray-900 dark:text-white">No assigned payroll reviews</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">The authoritative queue is empty for {queue.selectedLocalDate}.</p>
        </div>
      </div>
    );
  }

  const selectedDetails = payrollReviewDetailsQuery.data;
  const selectedQueueItem = queue.queue.find((item) => (
    item.snapshot.id === selectedSnapshot?.snapshotId
    && item.snapshot.hash === selectedSnapshot?.snapshotHash
  ));
  const canApprove = queue.capabilities.canApproveAssigned && selectedQueueItem?.state === "submitted";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Time Review</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Authoritative review queue for {queue.selectedLocalDate}.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem,1fr]">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Assigned queue</h2>
          <ul className="mt-4 space-y-3">
            {queue.queue.map((item) => {
              const selectable = Boolean(item.snapshot.id && item.snapshot.hash);
              const isSelected = item.snapshot.id === selectedSnapshot?.snapshotId && item.snapshot.hash === selectedSnapshot?.snapshotHash;
              return (
                <li key={`${item.employmentProfileId}-${item.payPeriodId}`} className="rounded-xl border border-gray-100 dark:border-gray-800">
                  <button
                    type="button"
                    disabled={!selectable}
                    onClick={() => selectable && setSelectedSnapshot({ snapshotId: item.snapshot.id!, snapshotHash: item.snapshot.hash! })}
                    className={`w-full rounded-xl px-3 py-3 text-left ${isSelected ? "bg-blue-50 dark:bg-blue-950/30" : ""}`}
                  >
                    <p className="font-medium text-gray-900 dark:text-white">{item.employeeLabel}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{item.periodStart} through {item.periodEnd}</p>
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">Status: {item.state}</p>
                    <p className="text-sm text-gray-700 dark:text-gray-200">Blockers: {item.blockerCount}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-dark-lighter">
          {!selectedSnapshot ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">Select an authoritative queue item to review its immutable snapshot.</p>
          ) : payrollReviewDetailsQuery.isError || !selectedDetails ? (
            <p className="text-sm text-red-700 dark:text-red-200">The immutable review snapshot could not be loaded.</p>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Immutable snapshot details</h2>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{selectedDetails.periodStart} through {selectedDetails.periodEnd}</p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Unresolved blockers: {selectedDetails.unresolvedBlockerCount}</p>
                </div>
                {queue.capabilities.canViewCompensation && selectedDetails.compensation ? (
                  <div className="rounded-xl border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
                    Gross: ${(selectedDetails.compensation.grossEarningsCents / 100).toFixed(2)}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800">
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Regular</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatHours(selectedDetails.classifiedSeconds.regular)}</p>
                </div>
                <div className="rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800">
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Overtime</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatHours(selectedDetails.classifiedSeconds.overtime)}</p>
                </div>
                <div className="rounded-xl border border-gray-100 px-3 py-2 dark:border-gray-800">
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Double time</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatHours(selectedDetails.classifiedSeconds.doubleTime)}</p>
                </div>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Punches</h3>
                  <ul className="mt-3 space-y-2">
                    {selectedDetails.punches.map((punch) => (
                      <li key={punch.id} className="rounded-xl border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-gray-900 dark:text-white">{punch.eventType}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{formatTimestamp(punch.occurredAt, punch.timezone)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Approval history</h3>
                  <ul className="mt-3 space-y-2">
                    {selectedDetails.approvalHistory.map((entry, index) => (
                      <li key={`${entry.snapshotId}-${index}`} className="rounded-xl border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
                        <p className="font-medium text-gray-900 dark:text-white">{entry.action}</p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatTimestamp(entry.occurredAt)}</p>
                        {entry.comment ? <p className="mt-1 text-gray-700 dark:text-gray-200">{entry.comment}</p> : null}
                        {entry.reason ? <p className="mt-1 text-gray-700 dark:text-gray-200">{entry.reason}</p> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <section className="mt-6">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Blockers</h3>
                {selectedDetails.blockers.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">No blocker details are available for this reviewer.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {selectedDetails.blockers.map((blocker, index) => (
                      <li key={`${blocker.blockerType}-${index}`} className="rounded-xl border border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
                        <p className="font-medium text-gray-900 dark:text-white">{blocker.blockerType}</p>
                        <p className="mt-1 text-gray-700 dark:text-gray-200">{blocker.state}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {canApprove ? (
                <section className="mt-6 rounded-2xl border border-gray-100 p-4 dark:border-gray-800">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Approval actions</h3>
                  <textarea
                    value={returnComment}
                    onChange={(event) => setReturnComment(event.target.value)}
                    placeholder="Return comment"
                    className="mt-3 min-h-24 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-dark-lighter"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void approvePayrollTimesheetMutation.mutateAsync({
                        ...scope,
                        idempotencyKey: buildIdempotencyKey("payroll-approve"),
                        snapshotId: selectedDetails.snapshotId,
                        snapshotHash: selectedDetails.snapshotHash,
                      })}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={!returnComment.trim()}
                      onClick={() => void returnPayrollTimesheetMutation.mutateAsync({
                        ...scope,
                        idempotencyKey: buildIdempotencyKey("payroll-return"),
                        snapshotId: selectedDetails.snapshotId,
                        snapshotHash: selectedDetails.snapshotHash,
                        comment: returnComment.trim(),
                      })}
                      className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      Return
                    </button>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
