import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { PHI_POLICY_BANNER } from '../../lib/messages/constants';

export function PhiNoticeBanner() {
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
      data-testid="messages-phi-banner"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{PHI_POLICY_BANNER}</p>
    </div>
  );
}
