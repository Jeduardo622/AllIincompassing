import React from 'react';
import type { MessageThreadType, StaffRecipient } from '../../lib/messages/types';

type StaffRecipientPickerProps = {
  recipients: StaffRecipient[];
  selectedIds: string[];
  onToggle: (userId: string) => void;
  threadType: MessageThreadType;
  onThreadTypeChange: (type: MessageThreadType) => void;
  canCreateGroup: boolean;
  disabled?: boolean;
};

export function StaffRecipientPicker({
  recipients,
  selectedIds,
  onToggle,
  threadType,
  onThreadTypeChange,
  canCreateGroup,
  disabled = false,
}: StaffRecipientPickerProps) {
  return (
    <div className="space-y-4" data-testid="staff-recipient-picker">
      {canCreateGroup && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">Conversation type</legend>
          <label className="mr-4 inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="thread-type"
              value="direct"
              checked={threadType === 'direct'}
              onChange={() => onThreadTypeChange('direct')}
              disabled={disabled}
            />
            1:1
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="thread-type"
              value="group"
              checked={threadType === 'group'}
              onChange={() => onThreadTypeChange('group')}
              disabled={disabled}
            />
            Group
          </label>
        </fieldset>
      )}

      <div>
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Recipients</p>
        {recipients.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="staff-recipient-empty">
            No eligible staff found in your organization.
          </p>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            {recipients.map((recipient) => {
              const isDirect = threadType === 'direct';
              return (
              <li key={recipient.id}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type={isDirect ? 'radio' : 'checkbox'}
                    name={isDirect ? 'staff-direct-recipient' : undefined}
                    checked={selectedIds.includes(recipient.id)}
                    onChange={() => onToggle(recipient.id)}
                    disabled={disabled}
                    data-testid={`staff-recipient-${recipient.id}`}
                  />
                  <span>
                    {recipient.full_name}
                    <span className="ml-1 text-gray-500 dark:text-gray-400">({recipient.role})</span>
                  </span>
                </label>
              </li>
            );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
