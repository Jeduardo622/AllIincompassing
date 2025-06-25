import React, { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
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
  resume?: File;
  license?: File;
  background_check?: File;
}

const DEFAULT_AVAILABILITY = {
  monday: { start: "06:00", end: "21:00" },
  tuesday: { start: "06:00", end: "21:00" },
  wednesday: { start: "06:00", end: "21:00" },
  thursday: { start: "06:00", end: "21:00" },
  friday: { start: "06:00", end: "21:00" },
  saturday: { start: "06:00", end: "21:00" },
};

export default function TherapistOnboarding({ onComplete }: TherapistOnboardingProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, File>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  
  // Parse query parameters
  const queryParams = new URLSearchParams(location.search);
  
  const { register, handleSubmit, control, formState: { errors } } = useForm<OnboardingFormData>({
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
    }
  });

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
          console.error(`Error uploading ${key}:`, uploadError);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, fieldName: string) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedFiles(prev => ({
        ...prev,
        [fieldName]: e.target.files![0]
      }));
    }
  };

  const handleFormSubmit = async (data: OnboardingFormData) => {
    // Validate required fields
    if (!data.first_name?.trim()) {
      showError('First name is required');
      return;
    }
    
    if (!data.last_name?.trim()) {
      showError('Last name is required');
      return;
    }
    
    if (!data.email?.trim()) {
      showError('Email is required');
      return;
    }
    
    // Ensure service_type is an array
    if (!data.service_type || !Array.isArray(data.service_type)) {
      data.service_type = [];
    }
    
    // Ensure specialties is an array
    if (!data.specialties || !Array.isArray(data.specialties)) {
      data.specialties = [];
    }
    
    setIsSubmitting(true);
    try {
      await createTherapistMutation.mutateAsync(data);
    } catch (error) {
      console.error('Error submitting form:', error);
      setIsSubmitting(false);
    }
  };

  const nextStep = () => {
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  First Name
                </label>
                <input
                  type="text"
                  {...register('first_name')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.first_name && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.first_name.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Middle Name
                </label>
                <input
                  type="text"
                  {...register('middle_name')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Last Name
                </label>
                <input
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  {...register('email')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
                {errors.email && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  {...register('phone')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Title
                </label>
                <select
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Employee Type
                </label>
                <select
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Staff ID
                </label>
                <input
                  type="text"
                  {...register('staff_id')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Status
                </label>
                <select
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    NPI Number
                  </label>
                  <input
                    type="text"
                    {...register('npi_number')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Medicaid ID
                  </label>
                  <input
                    type="text"
                    {...register('medicaid_id')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    RBT Number
                  </label>
                  <input
                    type="text"
                    {...register('rbt_number')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    BCBA Number
                  </label>
                  <input
                    type="text"
                    {...register('bcba_number')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Practitioner ID
                  </label>
                  <input
                    type="text"
                    {...register('practitioner_id')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Taxonomy Code
                  </label>
                  <input
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Facility
                  </label>
                  <input
                    type="text"
                    {...register('facility')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Supervisor
                  </label>
                  <input
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Street Address
                </label>
                <input
                  type="text"
                  {...register('street')}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    {...register('city')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    State
                  </label>
                  <input
                    type="text"
                    {...register('state')}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ZIP Code
                  </label>
                  <input
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Service Types
                </label>
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Specialties
                </label>
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Minimum Weekly Hours
                </label>
                <input
                  type="number"
                  min="0"
                  {...register('weekly_hours_min', { valueAsNumber: true })}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Maximum Weekly Hours
                </label>
                <input
                  type="number"
                  min="0"
                  {...register('weekly_hours_max', { valueAsNumber: true })}
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Resume/CV
                </label>
                <div className="flex items-center">
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  License/Certification
                </label>
                <div className="flex items-center">
                  <input
                    type="file"
                    id="license"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => handleFileChange(e, 'license')}
                    className="hidden"
                  />
                  <label
                    htmlFor="license"
                    className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 inline-block mr-2" />
                    Choose File
                  </label>
                  <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">
                    {uploadedFiles.license?.name || 'No file chosen'}
                  </span>
                </div>
              </div>
              
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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