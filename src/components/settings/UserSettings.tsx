import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { User, Mail, Lock, Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/authContext';
import { showSuccess, showError } from '../../lib/toast';

interface UserSettingsForm {
  email: string;
  current_password: string;
  new_password: string;
  confirm_password: string;
  first_name: string;
  last_name: string;
  title: string;
}

export default function UserSettings() {
  const { user } = useAuth();
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const { register, handleSubmit, watch, reset, formState: { errors, isDirty, isSubmitting } } = useForm<UserSettingsForm>({
    defaultValues: {
      email: user?.email || '',
      current_password: '',
      new_password: '',
      confirm_password: '',
      first_name: user?.user_metadata?.first_name || '',
      last_name: user?.user_metadata?.last_name || '',
      title: user?.user_metadata?.title || '',
    },
  });

  const newPassword = watch('new_password');

  const handleUpdateProfile = async (data: UserSettingsForm) => {
    try {
      const updates = {
        email: data.email,
        data: {
          first_name: data.first_name,
          last_name: data.last_name,
          title: data.title,
        },
      };

      // Update user metadata
      const { error: updateError } = await supabase.auth.updateUser(updates);
      if (updateError) throw updateError;

      // Handle password change if requested
      if (isChangingPassword && data.current_password && data.new_password) {
        const { error: passwordError } = await supabase.auth.updateUser({
          password: data.new_password,
        });
        if (passwordError) throw passwordError;
      }

      // Note: authContext automatically manages user data updates

      showSuccess('Profile updated successfully');
      setIsChangingPassword(false);
      reset({
        ...data,
        current_password: '',
        new_password: '',
        confirm_password: '',
      });
    } catch (error) {
      showError(error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">Personal Settings</h2>
      </div>

      <form onSubmit={handleSubmit(handleUpdateProfile)} className="space-y-6">
        <div className="bg-white dark:bg-dark-lighter rounded-lg shadow">
          <div className="p-6 space-y-6">
            {/* Profile Information */}
            <div>
              <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white flex items-center">
                <User className="w-5 h-5 mr-2" />
                Profile Information
              </h3>
              <div className="mt-6 grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="first_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    First Name
                  </label>
                  <input
                    id="first_name"
                    type="text"
                    {...register('first_name')}
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>

                <div>
                  <label htmlFor="last_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Last Name
                  </label>
                  <input
                    id="last_name"
                    type="text"
                    {...register('last_name')}
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>

                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Title
                  </label>
                  <input
                    id="title"
                    type="text"
                    {...register('title')}
                    className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Email
                  </label>
                  <div className="mt-1 flex rounded-md shadow-sm">
                    <div className="relative flex items-stretch flex-grow">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Mail aria-hidden="true" className="h-5 w-5 text-gray-400" />
                      </div>
                      <input
                       id="email"
                       type="text"
                        {...register('email', {
                          required: 'Email is required',
                          pattern: {
                            value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                            message: 'Invalid email address',
                          },
                        })}
                        className="block w-full pl-10 rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                      />
                    </div>
                  </div>
                  {errors.email && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.email.message}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Password Section */}
            <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white flex items-center">
                <Lock className="w-5 h-5 mr-2" />
                Password
              </h3>
              
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setIsChangingPassword(!isChangingPassword)}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-500"
                >
                  {isChangingPassword ? 'Cancel password change' : 'Change password'}
                </button>
              </div>

              {isChangingPassword && (
                <div className="mt-6 space-y-6">
                  <div>
                    <label htmlFor="current_password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Current Password
                    </label>
                    <input
                      id="current_password"
                      type="password"
                      {...register('current_password', {
                        required: 'Current password is required',
                      })}
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                    {errors.current_password && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.current_password.message}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="new_password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      New Password
                    </label>
                    <input
                      id="new_password"
                      type="password"
                      {...register('new_password', {
                        required: 'New password is required',
                        minLength: {
                          value: 8,
                          message: 'Password must be at least 8 characters',
                        },
                      })}
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                    {errors.new_password && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.new_password.message}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="confirm_password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Confirm New Password
                    </label>
                    <input
                      id="confirm_password"
                      type="password"
                      {...register('confirm_password', {
                        validate: value => value === newPassword || 'Passwords do not match',
                      })}
                      className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                    {errors.confirm_password && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.confirm_password.message}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-3 bg-gray-50 dark:bg-dark-lighter border-t border-gray-200 dark:border-gray-700">
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!isDirty || isSubmitting}
                className="flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4 mr-2" />
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}