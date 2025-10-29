import React, { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
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
import { logger } from '../lib/logger/logger';
import AvailabilityEditor from './AvailabilityEditor';
import { OnboardingSteps } from './OnboardingSteps';
import type { Therapist } from '../types';
import { prepareFormData } from '../lib/validation';

interface TherapistOnboardingProps {
  onComplete?: () => void;
}

interface OnboardingFormData {
  // Basic Information
  email: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  title?: string;
  phone?: string;

  // Professional Information
  npi_number?: string;
  medicaid_id?: string;
  practitioner_id?: string;
  taxonomy_code?: string;
  rbt_number?: string;
  bcba_number?: string;
  license_number: string;

  // Employment Information
  facility?: string;
  employee_type?: string;
  staff_id?: string;
  supervisor?: string;
  status?: string;
  
  // Service Information
  service_type: string[];
  specialties: string[];
  weekly_hours_min?: number;
  weekly_hours_max?: number;
  
  // Address Information
  street?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  
  // Availability
  availability_hours: {
    [key: string]: {
      start: string | null;
      end: string | null;
    };
  };

  // Additional fields
  preferred_areas: string[];

  // Documents
  certifications?: File[];
  resume?: File | null;
  license: File | null;
  background_check?: File | null;
}

const DEFAULT_AVAILABILITY = {
  monday: { start: "06:00", end: "21:00" },
  tuesday: { start: "06:00", end: "21:00" },
  wednesday: { start: "06:00", end: "21:00" },
  thursday: { start: "06:00", end: "21:00" },
  friday: { start: "06:00", end: "21:00" },
  saturday: { start: "06:00", end: "21:00" },
};

const therapistOnboardingSchema = z
  .object({
    first_name: z.string().trim().min(1, 'First name is required'),
    last_name: z.string().trim().min(1, 'Last name is required'),
    email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
    license_number: z.string().trim().min(1, 'License number is required'),
    license: z.instanceof(File).or(z.null()),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    if (!(data.license instanceof File)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['license'],
        message: 'Professional license document is required',
      });
    }
  });

export function TherapistOnboarding({ onComplete }: TherapistOnboardingProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, File>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  
  // Parse query parameters
  const queryParams = new URLSearchParams(location.search);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    setFocus,
    trigger,
    getFieldState,
  } = useForm<OnboardingFormData>({
    resolver: zodResolver(therapistOnboardingSchema),
    defaultValues: {
      email: queryParams.get('email') || '',
      first_name: queryParams.get('first_name') || '',
      last_name: queryParams.get('last_name') || '',
      title: queryParams.get('title') || '',
      service_type: queryParams.get('service_type')?.split(',').filter(Boolean) || [],
      specialties: queryParams.get('specialties')?.split(',').filter(Boolean) || [],
      weekly_hours_min: 0,
      weekly_hours_max: 40,
      availability_hours: DEFAULT_AVAILABILITY,
      preferred_areas: [],
      license_number: '',
      license: null,
      resume: null,
      background_check: null,
    }
  });

  useEffect(() => {
    const fieldOrder: (keyof OnboardingFormData)[] = [
      'first_name',
      'last_name',
      'email',
      'license_number',
      'license',
    ];
    const firstError = fieldOrder.find((field) => errors[field]);

    if (firstError) {
      setFocus(firstError);
    }
  }, [errors, setFocus]);

  const stepValidationFields: Record<number, (keyof OnboardingFormData)[]> = {
    1: ['first_name', 'last_name', 'email'],
    2: ['license_number'],
  };

  const createTherapistMutation = useMutation({
    mutationFn: async (data: Partial<Therapist>) => {
      // Format data for submission
      const formattedData = prepareFormData(data);
      
      // Prepare therapist data with proper formatting
      const formattedTherapist = {
        ...formattedData,
        service_type: formattedData.service_type,
        specialties: formattedData.specialties,
        preferred_areas: formattedData.preferred_areas,
        full_name: `${formattedData.first_name} ${formattedData.middle_name || ''} ${formattedData.last_name}`.trim()
      };

      // Insert therapist data
      const { data: therapist, error } = await supabase
        .from('therapists')
        .insert([formattedTherapist])
        .select()
        .single();

      if (error) throw error;

      // Handle file uploads if any
      for (const [key, file] of Object.entries(uploadedFiles)) {
        const filePath = `therapists/${therapist.id}/${key}/${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('therapist-documents')
          .upload(filePath, file);

        if (uploadError) {
          logger.error('Therapist onboarding document upload failed', {
            error: uploadError,
            context: { component: 'TherapistOnboarding', operation: 'uploadDocument' },
            metadata: {
              documentKey: key,
              hasFile: Boolean(file)
            }
          });
          // Continue with other uploads even if one fails
        }
      }

      return therapist;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['therapists'] });
      showSuccess('Therapist created successfully');
      if (onComplete) {
        onComplete();
      } else {
        navigate('/therapists');
      }
    },
    onError: (error) => {
      showError(error);
      setIsSubmitting(false);
    }
  });

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    fieldName: 'resume' | 'license' | 'background_check' | 'certifications',
    onChange?: (value: File | null) => void,
  ) => {
    const file = e.target.files?.[0] ?? null;

    setUploadedFiles(prev => {
      const next = { ...prev };

      if (file) {
        next[fieldName] = file;
      } else {
        delete next[fieldName];
      }

      return next;
    });

    if (onChange) {
      onChange(file);
    }
  };

  const handleFormSubmit = async (data: OnboardingFormData) => {
    const sanitizedData: OnboardingFormData = {
      ...data,
      service_type: Array.isArray(data.service_type) ? data.service_type : [],
      specialties: Array.isArray(data.specialties) ? data.specialties : [],
      preferred_areas: Array.isArray(data.preferred_areas) ? data.preferred_areas : [],
    };

    const therapistPayload = { ...sanitizedData } as Partial<Therapist> & {
      license_number: string;
    };

    delete (therapistPayload as Record<string, unknown>).license;
    delete (therapistPayload as Record<string, unknown>).resume;
    delete (therapistPayload as Record<string, unknown>).background_check;
    delete (therapistPayload as Record<string, unknown>).certifications;

    setIsSubmitting(true);
    try {
      await createTherapistMutation.mutateAsync(therapistPayload);
    } catch (error) {
      logger.error('Therapist onboarding submission failed', {
        error,
        context: { component: 'TherapistOnboarding', operation: 'handleFormSubmit' },
        metadata: {
          hasUploads: Object.keys(uploadedFiles).length > 0,
          selectedStep: currentStep
        }
      });
      setIsSubmitting(false);
    }
  };

  const nextStep = async () => {
    const fieldsToValidate = stepValidationFields[currentStep];

    if (fieldsToValidate) {
      const isValid = await trigger(fieldsToValidate);
      if (!isValid) {
        const firstInvalidField = fieldsToValidate.find(field => getFieldState(field).invalid);
        if (firstInvalidField) {
          setFocus(firstInvalidField);
        }
        return;
      }
    }

    setCurrentStep(prev => Math.min(prev + 1, 5));
  };

  const prevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Basic Information</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="onboarding-first-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  First Name
                </label>
                <input
                  id="onboarding-first-name"
                  type="text"
                  aria-invalid={errors.first_name ? 'true' : 'false'}
                  aria-describedby={errors.first_name ? 'onboarding-first-name-error' : undefined}
                  {...register('first_name')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.first_name && (
                  <p
                    id="onboarding-first-name-error"
                    className="mt-1 text-sm text-red-600 dark:text-red-400"
                  >
                    {errors.first_name.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="onboarding-middle-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                <label htmlFor="onboarding-last-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Last Name
                </label>
                <input
                  id="onboarding-last-name"
                  type="text"
                  aria-invalid={errors.last_name ? 'true' : 'false'}
                  aria-describedby={errors.last_name ? 'onboarding-last-name-error' : undefined}
                  {...register('last_name')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.last_name && (
                  <p
                    id="onboarding-last-name-error"
                    className="mt-1 text-sm text-red-600 dark:text-red-400"
                  >
                    {errors.last_name.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="onboarding-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email
                </label>
                <input
                  id="onboarding-email"
                  type="email"
                  aria-invalid={errors.email ? 'true' : 'false'}
                  aria-describedby={errors.email ? 'onboarding-email-error' : undefined}
                  {...register('email')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.email && (
                  <p
                    id="onboarding-email-error"
                    className="mt-1 text-sm text-red-600 dark:text-red-400"
                  >
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="onboarding-phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                <label htmlFor="onboarding-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Title
                </label>
                <select
                  id="onboarding-title"
                  {...register('title')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select title</option>
                  <option value="BCBA">BCBA</option>
                  <option value="BCaBA">BCaBA</option>
                  <option value="RBT">RBT</option>
                  <option value="BT">BT</option>
                  <option value="Clinical Director">Clinical Director</option>
                  <option value="Speech Therapist">Speech Therapist</option>
                  <option value="Occupational Therapist">Occupational Therapist</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="onboarding-employee-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Employee Type
                </label>
                <select
                  id="onboarding-employee-type"
                  {...register('employee_type')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="">Select type</option>
                  <option value="Full Time">Full Time</option>
                  <option value="Part Time">Part Time</option>
                  <option value="Contractor">Contractor</option>
                </select>
              </div>

              <div>
                <label htmlFor="onboarding-staff-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Staff ID
                </label>
                <input
                  id="onboarding-staff-id"
                  type="text"
                  {...register('staff_id')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label htmlFor="onboarding-status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Status
                </label>
                <select
                  id="onboarding-status"
                  {...register('status')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="on_leave">On Leave</option>
                </select>
              </div>
            </div>
          </div>
        );
      
      case 2:
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Professional Information</h2>
            
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg mb-6">
              <h3 className="text-md font-medium text-blue-800 dark:text-blue-200 mb-2">Credentials & Identifiers</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="onboarding-npi-number" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    NPI Number
                  </label>
                  <input
                    id="onboarding-npi-number"
                    type="text"
                    {...register('npi_number')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label htmlFor="onboarding-medicaid-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Medicaid ID
                  </label>
                  <input
                    id="onboarding-medicaid-id"
                    type="text"
                    {...register('medicaid_id')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label htmlFor="onboarding-rbt-number" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    RBT Number
                  </label>
                  <input
                    id="onboarding-rbt-number"
                    type="text"
                    {...register('rbt_number')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label htmlFor="onboarding-bcba-number" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    BCBA Number
                  </label>
                  <input
                    id="onboarding-bcba-number"
                    type="text"
                    {...register('bcba_number')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label htmlFor="onboarding-license-number" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    License Number
                  </label>
                  <input
                    id="onboarding-license-number"
                    type="text"
                    aria-invalid={errors.license_number ? 'true' : 'false'}
                    aria-describedby={errors.license_number ? 'onboarding-license-number-error' : undefined}
                    {...register('license_number')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                  {errors.license_number && (
                    <p
                      id="onboarding-license-number-error"
                      className="mt-1 text-sm text-red-600 dark:text-red-400"
                    >
                      {errors.license_number.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label htmlFor="onboarding-practitioner-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Practitioner ID
                  </label>
                  <input
                    id="onboarding-practitioner-id"
                    type="text"
                    {...register('practitioner_id')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label htmlFor="onboarding-taxonomy-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Taxonomy Code
                  </label>
                  <input
                    id="onboarding-taxonomy-code"
                    type="text"
                    {...register('taxonomy_code')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
            </div>
            
            <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
              <h3 className="text-md font-medium text-purple-800 dark:text-purple-200 mb-2">Facility & Supervision</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="onboarding-facility" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Facility
                  </label>
                  <input
                    id="onboarding-facility"
                    type="text"
                    {...register('facility')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label htmlFor="onboarding-supervisor" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Supervisor
                  </label>
                  <input
                    id="onboarding-supervisor"
                    type="text"
                    {...register('supervisor')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
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
                <label htmlFor="onboarding-street" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Street Address
                </label>
                <input
                  id="onboarding-street"
                  type="text"
                  {...register('street')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="onboarding-city" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    City
                  </label>
                  <input
                    id="onboarding-city"
                    type="text"
                    {...register('city')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label htmlFor="onboarding-state" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    State
                  </label>
                  <input
                    id="onboarding-state"
                    type="text"
                    {...register('state')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label htmlFor="onboarding-zip" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ZIP Code
                  </label>
                  <input
                    id="onboarding-zip"
                    type="text"
                    {...register('zip_code')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
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
                <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Service Types
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="in_clinic"
                      value="In clinic"
                      {...register('service_type')}
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
                      {...register('service_type')}
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
                      {...register('service_type')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="telehealth" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                      Telehealth
                    </label>
                  </div>
                </div>
              </div>
              
              <div>
                <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Specialties
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="aba_therapy"
                      value="ABA Therapy"
                      {...register('specialties')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="aba_therapy" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                      ABA Therapy
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="speech_therapy"
                      value="Speech Therapy"
                      {...register('specialties')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="speech_therapy" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                      Speech Therapy
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="occupational_therapy"
                      value="Occupational Therapy"
                      {...register('specialties')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="occupational_therapy" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                      Occupational Therapy
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="physical_therapy"
                      value="Physical Therapy"
                      {...register('specialties')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="physical_therapy" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                      Physical Therapy
                    </label>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="onboarding-hours-min" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Minimum Weekly Hours
                </label>
                <input
                  id="onboarding-hours-min"
                  type="number"
                  min="0"
                  {...register('weekly_hours_min', { valueAsNumber: true })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
              
              <div>
                <label htmlFor="onboarding-hours-max" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Maximum Weekly Hours
                </label>
                <input
                  id="onboarding-hours-max"
                  type="number"
                  min="0"
                  {...register('weekly_hours_max', { valueAsNumber: true })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
            </div>
            
            <div className="mt-4">
              <p className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Availability Schedule
              </p>
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
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Documents & Certifications</h2>
            
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg mb-6">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5 mr-2" />
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    Document Upload
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Please upload the following documents to complete the therapist onboarding process. 
                    All documents will be securely stored and only accessible to authorized personnel.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
                <label htmlFor="resume" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Resume/CV
                </label>
                <div className="flex flex-col md:flex-row md:items-center">
                  <input
                    type="file"
                    id="resume"
                    accept=".pdf,.doc,.docx"
                    onChange={(e) => handleFileChange(e, 'resume')}
                    className="hidden"
                  />
                  <label
                    htmlFor="resume"
                    className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 inline-block mr-2" />
                    Choose File
                  </label>
                  <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">
                    {uploadedFiles.resume?.name || 'No file chosen'}
                  </span>
                </div>
              </div>
              
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
                <label htmlFor="license" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  License/Certification
                </label>
                <div className="flex items-center">
                  <Controller
                    control={control}
                    name="license"
                    render={({ field }) => (
                      <input
                        id="license"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="sr-only"
                        aria-label="License document upload"
                        aria-invalid={errors.license ? 'true' : 'false'}
                        aria-describedby={errors.license ? 'license-error' : undefined}
                        onChange={(event) => {
                          handleFileChange(event, 'license', (file) => field.onChange(file));
                        }}
                        onBlur={field.onBlur}
                        ref={field.ref}
                      />
                    )}
                  />
                  <label
                    htmlFor="license"
                    className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 inline-block mr-2" />
                    Choose File
                  </label>
                  <span className="md:ml-3 text-sm text-gray-500 dark:text-gray-400 mt-2 md:mt-0">
                    {uploadedFiles.license?.name || 'No file chosen'}
                  </span>
                  {errors.license && (
                    <p
                      id="license-error"
                      className="mt-2 md:mt-0 md:ml-3 text-sm text-red-600 dark:text-red-400"
                    >
                      {errors.license.message}
                    </p>
                  )}
                </div>
              </div>
              
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
                <label htmlFor="background_check" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Background Check
                </label>
                <div className="flex items-center">
                  <input
                    type="file"
                    id="background_check"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => handleFileChange(e, 'background_check')}
                    className="hidden"
                  />
                  <label
                    htmlFor="background_check"
                    className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 inline-block mr-2" />
                    Choose File
                  </label>
                  <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">
                    {uploadedFiles.background_check?.name || 'No file chosen'}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="mt-6 flex items-start">
              <div className="flex items-center h-5">
                <input
                  id="consent"
                  type="checkbox"
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  required
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Therapist Onboarding</h1>
        
        <OnboardingSteps
          labels={['Basic Info', 'Professional', 'Address', 'Services', 'Documents']}
          currentStep={currentStep}
        />
        
        <form onSubmit={handleSubmit(handleFormSubmit)}>
          {renderStepContent()}
          
          <div className="mt-8 flex justify-between">
            <button
              type="button"
              onClick={prevStep}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              aria-label="Previous"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Previous
            </button>
            
            {currentStep < 5 ? (
              <button
                type="button"
                onClick={nextStep}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
              >
                Next
                <ArrowRight className="w-4 h-4 ml-2" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 flex items-center"
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