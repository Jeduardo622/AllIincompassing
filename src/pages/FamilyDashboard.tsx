import React, { useMemo } from 'react';
import { format } from 'date-fns';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Mail,
  Phone,
  ShieldCheck,
  UserCircle2,
} from 'lucide-react';
import { useAuth } from '../lib/authContext';
import { useConfirmGuardianContact, useGuardianClients, useGuardianContactMetadata } from '../lib/clients/hooks';
import { logger } from '../lib/logger/logger';
import type { GuardianContactMetadataEntry } from '../lib/clients/fetchers';
import { showError, showSuccess } from '../lib/toast';

const formatDate = (value: string | null) => {
  if (!value) {
    return 'N/A';
  }

  try {
    return format(new Date(value), 'MMMM d, yyyy');
  } catch (error) {
    logger.error('Failed to format date', { error, metadata: { value } });
    return value;
  }
};

const formatDateTime = (value: string) => {
  try {
    return format(new Date(value), 'MMMM d, yyyy h:mm a');
  } catch (error) {
    logger.error('Failed to format datetime', { error, metadata: { value } });
    return value;
  }
};

const deriveConfirmationCopy = (metadata: GuardianContactMetadataEntry | undefined) => {
  if (!metadata) {
    return null;
  }

  const { last_confirmed_at: lastConfirmedAt } = metadata.metadata;
  if (typeof lastConfirmedAt !== 'string' || lastConfirmedAt.length === 0) {
    return null;
  }

  return `Last confirmed ${formatDateTime(lastConfirmedAt)}`;
};

const formatTimeRange = (start: string, end: string) => {
  try {
    return `${format(new Date(start), 'h:mm a')} – ${format(new Date(end), 'h:mm a')}`;
  } catch (error) {
    logger.error('Failed to format time range', { error, metadata: { start, end } });
    return `${start} – ${end}`;
  }
};

export default function FamilyDashboard() {
  const { profile, user } = useAuth();
  const guardianClientsQuery = useGuardianClients();
  const contactMetadataQuery = useGuardianContactMetadata();
  const confirmContactMutation = useConfirmGuardianContact();

  const confirmationLookup = useMemo(() => {
    if (!contactMetadataQuery.data) {
      return new Map<string, GuardianContactMetadataEntry>();
    }

    return new Map(contactMetadataQuery.data.map((entry) => [entry.clientId, entry] as const));
  }, [contactMetadataQuery.data]);

  const handleConfirmContact = async (clientId: string) => {
    try {
      await confirmContactMutation.mutateAsync(clientId);
      showSuccess('Thanks! Your contact information has been confirmed.');
    } catch (error) {
      showError(error);
    }
  };

  if (guardianClientsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    );
  }

  if (guardianClientsQuery.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-6 w-6" />
          <div>
            <h2 className="text-lg font-semibold">We were unable to load your family dashboard.</h2>
            <p className="mt-1 text-sm text-red-600">
              {guardianClientsQuery.error?.message ?? 'Please refresh the page or try again later.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const dependents = guardianClientsQuery.data ?? [];

  return (
    <div className="space-y-8">
      <div className="rounded-lg bg-white p-6 shadow-sm dark:bg-dark-lighter">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Welcome back{profile?.first_name ? `, ${profile.first_name}` : ''}!
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Here&apos;s a snapshot of the upcoming sessions and updates for your kiddo{dependents.length !== 1 ? 's' : ''}.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-md bg-blue-50 px-4 py-2 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-sm font-medium">
              You&apos;re signed in as {user?.email ?? 'guardian'}
            </span>
          </div>
        </div>
      </div>

      {dependents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-700 dark:bg-dark-lighter">
          <UserCircle2 className="mx-auto h-12 w-12 text-gray-400" />
          <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">No linked dependents yet</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Once your care team links your account to a kiddo, their information will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {dependents.map((dependent) => {
            const metadata = confirmationLookup.get(dependent.clientId);
            const confirmationCopy = deriveConfirmationCopy(metadata);
            return (
              <section
                key={dependent.clientId}
                className="rounded-xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-dark-lighter"
              >
                <div className="flex flex-col gap-4 border-b border-gray-100 p-6 md:flex-row md:items-center md:justify-between dark:border-gray-800">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{dependent.fullName}</h2>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      {dependent.relationship ? `${dependent.relationship} • ` : ''}
                      {dependent.isPrimaryGuardian ? 'Primary guardian' : 'Guardian'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 text-sm text-gray-600 dark:text-gray-300 md:items-end">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-blue-500" />
                      <span>Date of birth: {formatDate(dependent.dateOfBirth)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-blue-500" />
                      <span>{dependent.email ?? 'No email on file'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-blue-500" />
                      <span>{dependent.phone ?? 'No phone on file'}</span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 p-6 md:grid-cols-2">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">Upcoming sessions</h3>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {dependent.upcomingSessions.length} scheduled
                      </span>
                    </div>
                    {dependent.upcomingSessions.length === 0 ? (
                      <p className="rounded-md border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        No upcoming sessions on the calendar yet.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {dependent.upcomingSessions.map((session) => (
                          <li
                            key={session.id}
                            className="rounded-lg border border-gray-200 p-4 text-sm dark:border-gray-700"
                          >
                            <div className="flex items-center justify-between text-gray-900 dark:text-white">
                              <span>{formatDateTime(session.startTime)}</span>
                              <span className="text-xs font-medium uppercase text-blue-600 dark:text-blue-300">
                                {session.status}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-gray-600 dark:text-gray-300">
                              <Clock className="h-4 w-4" />
                              <span>{formatTimeRange(session.startTime, session.endTime)}</span>
                            </div>
                            {session.therapist?.fullName && (
                              <div className="mt-1 text-gray-600 dark:text-gray-300">
                                With {session.therapist.fullName}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">Notes from your care team</h3>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {dependent.notes.length} visible
                      </span>
                    </div>
                    {dependent.notes.length === 0 ? (
                      <p className="rounded-md border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        Notes that are shared with families will appear here.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {dependent.notes.map((note) => (
                          <li key={note.id} className="rounded-lg border border-gray-200 p-4 text-sm dark:border-gray-700">
                            <div className="flex items-center justify-between text-gray-900 dark:text-white">
                              <span>{note.createdByName ?? 'Care team member'}</span>
                              {note.createdAt && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {formatDateTime(note.createdAt)}
                                </span>
                              )}
                            </div>
                            <p className="mt-2 text-gray-700 dark:text-gray-300">{note.content ?? 'No description provided.'}</p>
                            {note.status && (
                              <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium uppercase text-blue-600 dark:text-blue-300">
                                <CheckCircle2 className="h-4 w-4" />
                                {note.status}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-200">
                      <p className="font-medium">Guardian contact information</p>
                      <p className="mt-1 text-blue-700 dark:text-blue-100">
                        Let us know that your phone and email are still the best way to reach you.
                      </p>
                      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <button
                          type="button"
                          onClick={() => handleConfirmContact(dependent.clientId)}
                          disabled={confirmContactMutation.isPending && confirmContactMutation.variables === dependent.clientId}
                          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {confirmContactMutation.isPending && confirmContactMutation.variables === dependent.clientId ? (
                            <span className="flex items-center gap-2">
                              <span className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                              Saving…
                            </span>
                          ) : (
                            'Confirm my contact details'
                          )}
                        </button>
                        {confirmationCopy && (
                          <span className="text-xs uppercase tracking-wide text-blue-600 dark:text-blue-300">
                            {confirmationCopy}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
