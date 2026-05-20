import React from 'react';
import type { MessageThreadType } from '../../lib/messages/types';
import type { StaffMember } from '../../lib/messages/types';

interface StaffRecipientPickerProps {
  threadType: MessageThreadType;
  staff: StaffMember[];
  selectedIds: string[];
  currentUserId: string;
  onChange: (ids: string[]) => void;
  isLoading?: boolean;
}

export function StaffRecipientPicker({
  threadType,
  staff,
  selectedIds,
  currentUserId,
  onChange,
  isLoading = false,
}: StaffRecipientPickerProps) {
  const selectableStaff = staff.filter((member) => member.id !== currentUserId);

  const toggleRecipient = (userId: string) => {
    if (threadType === 'direct') {
      onChange(selectedIds.includes(userId) ? [] : [userId]);
      return;
    }
    if (selectedIds.includes(userId)) {
      onChange(selectedIds.filter((id) => id !== userId));
      return;
    }
    onChange([...selectedIds, userId]);
  };

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading staff…</p>;
  }

  if (selectableStaff.length === 0) {
    return <p className="text-sm text-gray-500">No active staff recipients found in your organization.</p>;
  }

  return (
    <div className="space-y-2" role="list" aria-label="Staff recipients">
      {selectableStaff.map((member) => {
        const inputType = threadType === 'direct' ? 'radio' : 'checkbox';
        const isChecked = selectedIds.includes(member.id);
        return (
          <label
            key={member.id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700"
          >
            <input
              type={inputType}
              name="staff-recipient"
              checked={isChecked}
              onChange={() => toggleRecipient(member.id)}
            />
            <span>
              <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                {member.fullName}
              </span>
              <span className="block text-xs text-gray-500">{member.email}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
