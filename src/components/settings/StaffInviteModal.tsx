import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../common/Modal';
import { ROLE_LABELS, type AppRole } from '../../lib/roles';

export interface StaffInviteFormData {
  email: string;
  organization_id: string | null;
  role: AppRole;
  reason: string;
}

interface StaffInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: StaffInviteFormData) => Promise<void>;
  organizationOptions?: Array<{ id: string; name?: string | null }>;
  isSuperAdmin?: boolean;
  roleOptions: readonly AppRole[];
  initialData: StaffInviteFormData;
  title?: string;
  submitLabel?: string;
  organizationLabel?: string;
  roleLocked?: boolean;
}

export function StaffInviteModal({
  isOpen,
  onClose,
  onSubmit,
  organizationOptions = [],
  isSuperAdmin = false,
  roleOptions,
  initialData,
  title = 'Invite Staff',
  submitLabel = 'Send Invite',
  organizationLabel = 'Organization',
  roleLocked = false,
}: StaffInviteModalProps) {
  const emailRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState<StaffInviteFormData>(initialData);

  useEffect(() => {
    if (isOpen) {
      setFormData(initialData);
    }
  }, [initialData, isOpen]);

  const handleInputChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = event.target;
    setFormData((previous) => ({
      ...previous,
      [name]: name === 'organization_id' && value.length === 0 ? null : value,
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit({
      ...formData,
      email: formData.email.trim(),
      reason: formData.reason.trim(),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titleId="staff-invite-modal-title"
      initialFocusRef={emailRef}
      panelClassName="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-md p-6"
    >
      <h2 id="staff-invite-modal-title" className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
        {title}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="staff-invite-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Email*
          </label>
          <input
            ref={emailRef}
            type="email"
            name="email"
            required
            value={formData.email}
            onChange={handleInputChange}
            id="staff-invite-email"
            className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
          />
        </div>

        <div>
          <label htmlFor="staff-invite-role" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Role*
          </label>
          <select
            id="staff-invite-role"
            name="role"
            required
            value={formData.role}
            onChange={handleInputChange}
            disabled={roleLocked}
            className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 dark:bg-dark dark:text-gray-200 dark:disabled:bg-gray-800"
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="staff-invite-organization" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {organizationLabel}
          </label>
          {isSuperAdmin ? (
            <>
              <select
                id="staff-invite-organization"
                name="organization_id"
                value={formData.organization_id ?? ''}
                onChange={handleInputChange}
                required
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              >
                <option value="">Select organization</option>
                {organizationOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name ?? option.id}
                  </option>
                ))}
              </select>
              {!formData.organization_id && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  Choose an organization before inviting staff.
                </p>
              )}
            </>
          ) : (
            <>
              <input
                type="text"
                name="organization_id"
                value={formData.organization_id ?? ''}
                readOnly
                id="staff-invite-organization"
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
              {!formData.organization_id && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  Organization context is required before inviting staff.
                </p>
              )}
            </>
          )}
        </div>

        <div>
          <label htmlFor="staff-invite-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Reason for staff access*
          </label>
          <textarea
            id="staff-invite-reason"
            name="reason"
            required
            minLength={10}
            rows={3}
            value={formData.reason}
            onChange={handleInputChange}
            placeholder="Explain why this user requires staff access"
            className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Provide a short justification that will be stored in the audit log.
          </p>
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!formData.organization_id}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
