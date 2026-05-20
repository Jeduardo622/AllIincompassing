import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { PHI_POLICY_BANNER } from '../../lib/messages/constants';

export function StaffMessagingPolicyBanner() {
  return (
    <div
      role="note"
      className="mb-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p>{PHI_POLICY_BANNER}</p>
    </div>
  );
}
