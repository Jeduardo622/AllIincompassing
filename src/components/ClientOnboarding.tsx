import React, { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Upload,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { showSuccess, showError } from '../lib/toast';
import AvailabilityEditor from './AvailabilityEditor';
import { OnboardingSteps } from './OnboardingSteps';
import type { Client } from '../types';
import { prepareFormData } from '../lib/validation';
import { logger } from '../lib/logger/logger';
import { clientSchema, type ClientFormData } from '../lib/validationSchemas';
import {
  checkClientEmailExists,
  createClient as createClientRecord,
} from '../lib/clients/mutations';

interface ClientOnboardingProps {
  onComplete?: () => void;
}

const DEFAULT_AVAILABILITY = {
  monday: { start: "06:00", end: "21:00" },
  tuesday: { start: "06:00", end: "21:00" },
  wednesday: { start: "06:00", end: "21:00" },
  thursday: { start: "06:00", end: "21:00" },
  friday: { start: "06:00", end: "21:00" },
  saturday: { start: "06:00", end: "21:00" },
};

export default function ClientOnboarding({ onComplete }: ClientOnboardingProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, File>>({});
  const [emailValidationError, setEmailValidationError] = useState<string>('');
  const [isValidatingEmail, setIsValidatingEmail] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  
  // Parse query parameters
  const queryParams = new URLSearchParams(location.search);
  
  const {
    register,
    handleSubmit,
    control,
    trigger,
    formState: { errors, isValid }
  } = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema),
    mode: 'onChange',
    defaultValues: {
      email: queryParams.get('email') || '',
      first_name: queryParams.get('first_name') || '',
      last_name: queryParams.get('last_name') || '',
      date_of_birth: queryParams.get('date_of_birth') || '',
      service_preference: queryParams.get('service_preference')?.split(',').filter(Boolean) || [],
      insurance_info: { provider: queryParams.get('insurance_provider') || '' },
      referral_source: queryParams.get('referral_source') || '',
      one_to_one_units: 0,
      supervision_units: 0,
      parent_consult_units: 0,
      availability_hours: DEFAULT_AVAILABILITY,
    }
  });

  const STEP_FIELDS: Record<number, Array<keyof ClientFormData>> = {
    1: ['first_name', 'last_name', 'date_of_birth', 'email', 'gender', 'phone', 'client_id', 'cin_number'],
    2: [
      'parent1_first_name',
      'parent1_last_name',
      'parent1_phone',
      'parent1_email',
      'parent1_relationship',
      'parent2_first_name',
      'parent2_last_name',
      'parent2_phone',
      'parent2_email',
      'parent2_relationship',
    ],
    3: ['address_line1', 'address_line2', 'city', 'state', 'zip_code'],
    4: ['service_preference', 'one_to_one_units', 'supervision_units', 'parent_consult_units', 'insurance_info'],
  };

  // Check if email already exists in database
  const checkEmailExists = async (email: string): Promise<boolean> => {
    if (!email.trim()) return false;

    try {
      return await checkClientEmailExists(supabase, email);
    } catch (error) {
      logger.error('Failed to check onboarding email uniqueness', {
        error,
        context: { component: 'ClientOnboarding', operation: 'checkEmailExists' },
        metadata: { hasEmail: Boolean(email) }
      });
      return false;
    }
  };

  const validateEmail = async (email: string) => {
    if (!email || !email.trim()) {
      setEmailValidationError('');
      return;
    }

    setIsValidatingEmail(true);
    setEmailValidationError('');

    try {
      const exists = await checkEmailExists(email);
      if (exists) {
        setEmailValidationError('A client with this email address already exists');
      } else {
        setEmailValidationError('');
      }
    } catch (error) {
      logger.error('Client onboarding email validation failed', {
        error,
        context: { component: 'ClientOnboarding', operation: 'validateEmail' }
      });
      setEmailValidationError('Unable to validate email. Please try again.');
    } finally {
      setIsValidatingEmail(false);
    }
  };

  const createClientMutation = useMutation({
    mutationFn: async (data: Partial<Client>) => {
      // Format data for submission
      const formattedData = prepareFormData(data);
      
      // Prepare client data with proper formatting
      const formattedClient = {
        ...formattedData,
        service_preference: formattedData.service_preference || [],
        insurance_info: formattedData.insurance_info || {},
        full_name: `${formattedData.first_name} ${formattedData.middle_name || ''} ${formattedData.last_name}`.trim()
      };

      logger.debug('Submitting client onboarding payload', {
        metadata: { fields: Object.keys(formattedClient) }
      });

      // Insert client data
      const client = await createClientRecord(supabase, formattedClient);

      logger.info('Client onboarding Supabase insert completed', {
        metadata: { hasId: Boolean(client?.id) }
      });

      // Handle file uploads if any
      for (const [key, file] of Object.entries(uploadedFiles)) {
        const filePath = `clients/${client.id}/${key}/${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('client-documents')
          .upload(filePath, file);

        if (uploadError) {
          logger.error('Client document upload failed', {
            error: uploadError,
            metadata: { fileKey: key },
            context: { component: 'ClientOnboarding', operation: 'uploadDocument' }
          });
          // Continue with other uploads even if one fails
        }
      }

      return client;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      showSuccess('Client created successfully');
      if (onComplete) {
        onComplete();
      } else {
        navigate('/clients');
      }
    },
    onError: (error) => {
      logger.error('Client creation mutation error', {
        error,
        context: { component: 'ClientOnboarding', operation: 'createClientMutation' },
        track: false
      });
      showError(error);
      setIsSubmitting(false);
    }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, fieldName: string) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedFiles(prev => ({
        ...prev,
        [fieldName]: e.target.files![0]
      }));
    }
  };

  const handleFormSubmit = async (data: ClientFormData) => {
    if (currentStep < 5) {
      logger.debug('Client onboarding submission intercepted before final step', {
        metadata: { attemptedStep: currentStep }
      });
      setCurrentStep(prev => Math.min(prev + 1, 5));
      return;
    }

    logger.debug('Client onboarding form submitted', {
      metadata: {
        servicePreferenceCount: Array.isArray(data.service_preference) ? data.service_preference.length : 0,
        documentCount: Object.keys(uploadedFiles).length
      }
    });
    
    // Only check email validation error if an email was provided
    if (emailValidationError) {
      showError('Please resolve the email validation error before submitting');
      return;
    }
    
    // Double-check email uniqueness before submission
    if (data.email && data.email.trim()) {
      const emailExists = await checkEmailExists(data.email);
      if (emailExists) {
        setEmailValidationError('A client with this email address already exists');
        showError('A client with this email address already exists');
        return;
      }
    }
    
    // Ensure service_preference is an array
    if (!Array.isArray(data.service_preference)) {
      data.service_preference = [];
    }
    
    setIsSubmitting(true);
    try {
      logger.debug('Starting client creation mutation');
      await createClientMutation.mutateAsync(data);
    } catch (error) {
      logger.error('Client onboarding submission failed', {
        error,
        context: { component: 'ClientOnboarding', operation: 'handleFormSubmit' }
      });
      setIsSubmitting(false);
    }
  };

  const nextStep = async () => {
    const fields = STEP_FIELDS[currentStep] ?? [];
    if (fields.length > 0) {
      const isStepValid = await trigger(fields, { shouldFocus: true });
      if (!isStepValid) {
        return false;
      }
    }

    if (emailValidationError) {
      return false;
    }

    setCurrentStep(prev => Math.min(prev + 1, 5));
    return true;
  };

  const prevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const processStepSubmission = async () => {
    if (currentStep < 5) {
      logger.debug('Client onboarding submission intercepted before final step', {
        metadata: { attemptedStep: currentStep }
      });
      await nextStep();
      return;
    }

    await handleSubmit(handleFormSubmit)();
  };

  const handleWizardSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await processStepSubmission();
  };

  const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || currentStep >= 5) {
      return;
    }

    logger.debug('Client onboarding enter key intercepted before final step', {
      metadata: { attemptedStep: currentStep }
    });
    event.preventDefault();
    void processStepSubmission();
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Basic Information</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="onboarding-first-name"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  First Name
                </label>
                <input
                  id="onboarding-first-name"
                  type="text"
                  {...register('first_name')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.first_name && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.first_name.message}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="onboarding-middle-name"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Middle Name
                </label>
                <input
                  id="onboarding-middle-name"
                  type="text"
                  {...register('middle_name')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label
                  htmlFor="onboarding-last-name"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Last Name
                </label>
                <input
                  id="onboarding-last-name"
                  type="text"
                  {...register('last_name')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.last_name && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.last_name.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="onboarding-date-of-birth"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Date of Birth
                </label>
                <input
                  id="onboarding-date-of-birth"
                  type="date"
                  {...register('date_of_birth')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.date_of_birth && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.date_of_birth.message}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="onboarding-gender"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Gender
                </label>
                <select
                  id="onboarding-gender"
                  {...register('gender')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="onboarding-email"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Email
                </label>
                <input
                  id="onboarding-email"
                  type="email"
                  {...register('email')}
                  onBlur={(e) => validateEmail(e.target.value)}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {isValidatingEmail && (
                  <p className="mt-1 text-sm text-blue-600 dark:text-blue-400 flex items-center">
                    <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                    Checking email availability...
                  </p>
                )}
                {emailValidationError && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{emailValidationError}</p>
                )}
                {errors.email && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.email.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="onboarding-phone"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Phone
                </label>
                <input
                  id="onboarding-phone"
                  type="tel"
                  {...register('phone')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label
                  htmlFor="onboarding-client-id"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Client ID
                </label>
                <input
                  id="onboarding-client-id"
                  type="text"
                  {...register('client_id')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Optional: Enter existing client ID if available
                </p>
              </div>

              <div>
                <label
                  htmlFor="onboarding-cin-number"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  CIN Number
                </label>
                <input
                  id="onboarding-cin-number"
                  type="text"
                  {...register('cin_number')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Client Identification Number for Medicaid
                </p>
              </div>
            </div>
          </div>
        );
      
      case 2:
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Parent/Guardian Information</h2>
            
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg mb-6">
              <h3 className="text-md font-medium text-blue-800 dark:text-blue-200 mb-2">Primary Parent/Guardian</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="onboarding-parent1-first-name"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    First Name
                  </label>
                  <input
                    id="onboarding-parent1-first-name"
                    type="text"
                    {...register('parent1_first_name')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.parent1_first_name && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.parent1_first_name.message}</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="onboarding-parent1-last-name"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Last Name
                  </label>
                  <input
                    id="onboarding-parent1-last-name"
                    type="text"
                    {...register('parent1_last_name')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.parent1_last_name && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.parent1_last_name.message}</p>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label
                    htmlFor="onboarding-parent1-phone"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Phone
                  </label>
                  <input
                    id="onboarding-parent1-phone"
                    type="tel"
                    {...register('parent1_phone')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.parent1_phone && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.parent1_phone.message}</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="onboarding-parent1-email"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Email
                  </label>
                  <input
                    id="onboarding-parent1-email"
                    type="email"
                    {...register('parent1_email')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
              
              <div className="mt-4">
                <label
                  htmlFor="onboarding-parent1-relationship"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Relationship to Client
                </label>
                <select
                  id="onboarding-parent1-relationship"
                  {...register('parent1_relationship')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select relationship</option>
                  <option value="Mother">Mother</option>
                  <option value="Father">Father</option>
                  <option value="Grandparent">Grandparent</option>
                  <option value="Legal Guardian">Legal Guardian</option>
                  <option value="Other">Other</option>
                </select>
                {errors.parent1_relationship && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.parent1_relationship.message}</p>
                )}
              </div>
            </div>
            
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
              <h3 className="text-md font-medium text-gray-700 dark:text-gray-300 mb-2">Secondary Parent/Guardian (Optional)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="onboarding-parent2-first-name"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    First Name
                  </label>
                  <input
                    id="onboarding-parent2-first-name"
                    type="text"
                    {...register('parent2_first_name')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label
                    htmlFor="onboarding-parent2-last-name"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Last Name
                  </label>
                  <input
                    id="onboarding-parent2-last-name"
                    type="text"
                    {...register('parent2_last_name')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label
                    htmlFor="onboarding-parent2-phone"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Phone
                  </label>
                  <input
                    id="onboarding-parent2-phone"
                    type="tel"
                    {...register('parent2_phone')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label
                    htmlFor="onboarding-parent2-email"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Email
                  </label>
                  <input
                    id="onboarding-parent2-email"
                    type="email"
                    {...register('parent2_email')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
              
              <div className="mt-4">
                <label
                  htmlFor="onboarding-parent2-relationship"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Relationship to Client
                </label>
                <select
                  id="onboarding-parent2-relationship"
                  {...register('parent2_relationship')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select relationship</option>
                  <option value="Mother">Mother</option>
                  <option value="Father">Father</option>
                  <option value="Grandparent">Grandparent</option>
                  <option value="Legal Guardian">Legal Guardian</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          </div>
        );
      
      case 3:
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Address & Contact Information</h2>
            
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label
                  htmlFor="onboarding-address-line1"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Street Address
                </label>
                <input
                  id="onboarding-address-line1"
                  type="text"
                  {...register('address_line1')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.address_line1 && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.address_line1.message}</p>
                )}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="onboarding-city"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    City
                  </label>
                  <input
                    id="onboarding-city"
                    type="text"
                    {...register('city')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.city && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.city.message}</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="onboarding-state"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    State
                  </label>
                  <input
                    id="onboarding-state"
                    type="text"
                    {...register('state')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.state && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.state.message}</p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="onboarding-zip-code"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    ZIP Code
                  </label>
                  <input
                    id="onboarding-zip-code"
                    type="text"
                    {...register('zip_code')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.zip_code && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.zip_code.message}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      
      case 4:
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Service Information</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Service Types
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="in_clinic"
                      value="In clinic"
                      {...register('service_preference')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="in_clinic" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                      In Clinic
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="in_home"
                      value="In home"
                      {...register('service_preference')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="in_home" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                      In Home
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="telehealth"
                      value="Telehealth"
                      {...register('service_preference')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="telehealth" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                      Telehealth
                    </label>
                  </div>
                </div>
              </div>
              
              <div>
                <label
                  htmlFor="onboarding-insurance-provider"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Insurance Provider
                </label>
                <input
                  id="onboarding-insurance-provider"
                  type="text"
                  {...register('insurance_info.provider')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="onboarding-one-to-one-units"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  1:1 Units
                </label>
                <input
                  id="onboarding-one-to-one-units"
                  type="number"
                  min="0"
                  {...register('one_to_one_units', { valueAsNumber: true })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
              
              <div>
                <label
                  htmlFor="onboarding-supervision-units"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Supervision Units
                </label>
                <input
                  id="onboarding-supervision-units"
                  type="number"
                  min="0"
                  {...register('supervision_units', { valueAsNumber: true })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
              
              <div>
                <label
                  htmlFor="onboarding-parent-consult-units"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Parent Consult Units
                </label>
                <input
                  id="onboarding-parent-consult-units"
                  type="number"
                  min="0"
                  {...register('parent_consult_units', { valueAsNumber: true })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
            </div>
            
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Availability Schedule
              </label>
              <Controller
                name="availability_hours"
                control={control}
                render={({ field }) => (
                  <AvailabilityEditor
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
          </div>
        );
      
      case 5:
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Documents & Consent</h2>
            
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg mb-6">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5 mr-2" />
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    Document Upload
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Please upload the following documents to complete the client onboarding process. 
                    All documents will be securely stored and only accessible to authorized personnel.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Insurance Card (Front)
                </label>
                <div className="flex items-center">
                  <input
                    type="file"
                    id="insurance_card_front"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange(e, 'insurance_card_front')}
                    className="hidden"
                  />
                  <label
                    htmlFor="insurance_card_front"
                    className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 inline-block mr-2" />
                    Choose File
                  </label>
                  <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">
                    {uploadedFiles.insurance_card_front?.name || 'No file chosen'}
                  </span>
                </div>
              </div>
              
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Insurance Card (Back)
                </label>
                <div className="flex items-center">
                  <input
                    type="file"
                    id="insurance_card_back"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange(e, 'insurance_card_back')}
                    className="hidden"
                  />
                  <label
                    htmlFor="insurance_card_back"
                    className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 inline-block mr-2" />
                    Choose File
                  </label>
                  <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">
                    {uploadedFiles.insurance_card_back?.name || 'No file chosen'}
                  </span>
                </div>
              </div>
              
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Referral Form (if available)
                </label>
                <div className="flex items-center">
                  <input
                    type="file"
                    id="referral_form"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange(e, 'referral_form')}
                    className="hidden"
                  />
                  <label
                    htmlFor="referral_form"
                    className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 inline-block mr-2" />
                    Choose File
                  </label>
                  <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">
                    {uploadedFiles.referral_form?.name || 'No file chosen'}
                  </span>
                </div>
              </div>
              
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Consent Form
                </label>
                <div className="flex items-center">
                  <input
                    type="file"
                    id="consent_form"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange(e, 'consent_form')}
                    className="hidden"
                  />
                  <label
                    htmlFor="consent_form"
                    className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 inline-block mr-2" />
                    Choose File
                  </label>
                  <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">
                    {uploadedFiles.consent_form?.name || 'No file chosen'}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="mt-6 flex items-start">
              <div className="flex items-center h-5">
                <input
                  id="consent"
                  type="checkbox"
                  defaultChecked={true}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
              </div>
              <div className="ml-3 text-sm">
                <label htmlFor="consent" className="font-medium text-gray-700 dark:text-gray-300">
                  I consent to the collection and processing of this information
                </label>
                <p className="text-gray-500 dark:text-gray-400">
                  By checking this box, you agree that the information provided is accurate and that you consent to our 
                  <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline"> privacy policy</a> and 
                  <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline"> terms of service</a>.
                </p>
              </div>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white dark:bg-dark-lighter shadow rounded-lg p-6 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Client Onboarding</h1>
        
        <OnboardingSteps
          labels={[
            'Basic Info',
            'Parent/Guardian',
            'Address',
            'Services',
            'Documents',
          ]}
          currentStep={currentStep}
        />
        
        <form onSubmit={handleWizardSubmit} onKeyDownCapture={handleFormKeyDown}>
          {renderStepContent()}
          
          <div className="mt-8 flex justify-between">
            <button
              type="button"
              onClick={prevStep}
              disabled={currentStep === 1}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 flex items-center"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Previous
            </button>
            
            {currentStep < 5 ? (
              <button
                type="button"
                onClick={nextStep}
                disabled={emailValidationError !== '' || isValidatingEmail}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                Next
                <ArrowRight className="w-4 h-4 ml-2" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting || emailValidationError !== '' || isValidatingEmail || !isValid}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Complete Onboarding
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}