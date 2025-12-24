import React, { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  ClipboardCheck, Calendar, AlertCircle, 
  FileText, Plus, ArrowRight,
  CheckCircle
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { showError, showSuccess } from '../../lib/toast';
import { useActiveOrganizationId } from '../../lib/organization';
import { useAuth } from '../../lib/auth';

interface PreAuthTabProps {
  client: { id: string };
}

interface Authorization {
  id: string;
  authorization_number: string;
  start_date: string;
  end_date: string;
  status: string;
  services: {
    id: string;
    service_code: string;
    service_description: string;
    requested_units: number;
    approved_units: number;
    unit_type: string;
  }[];
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ACCEPTED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png'
] as const;

export default function PreAuthTab({ client }: PreAuthTabProps) {
  const { user } = useAuth();
  const organizationId = useActiveOrganizationId();
  const queryClient = useQueryClient();
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardData, setWizardData] = useState({
    insurance: '',
    services: [] as string[],
    units: {} as Record<string, number>,
    documents: [] as File[],
  });
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const serviceCatalog: Record<string, string> = {
    '97151': 'Behavior identification assessment',
    '97153': 'Adaptive behavior treatment by protocol',
    '97155': 'Adaptive behavior treatment with protocol modification',
    '97156': 'Family adaptive behavior treatment guidance',
    '97157': 'Multiple-family group adaptive behavior treatment guidance',
    '97158': 'Group adaptive behavior treatment with protocol modification',
  };
  
  // Fetch authorizations
  const { data: authorizations = [], isLoading } = useQuery({
    queryKey: ['authorizations', client.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('authorizations')
        .select(`
          *,
          services:authorization_services(*)
        `)
        .eq('client_id', client.id);
        
      if (error) throw error;
      return data as Authorization[];
    },
  });
  
  const getStatusClass = (status: string) => {
    switch (status.toLowerCase()) {
      case 'approved':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      case 'denied':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      case 'pending':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300';
      case 'requested':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
      case 'expiring':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
    }
  };
  
  const isExpiring = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diffDays = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 30 && diffDays > 0;
  };
  
  const getUnitsUsedPercentage = (auth: Authorization) => {
    const totalApproved = auth.services.reduce((sum, service) => sum + (service.approved_units || 0), 0);
    const totalUsed = auth.services.reduce((sum, service) => {
      // This is a mock calculation - in a real app, you'd track actual usage
      return sum + Math.floor((service.approved_units || 0) * 0.7);
    }, 0);
    
    return totalApproved > 0 ? (totalUsed / totalApproved) * 100 : 0;
  };
  
  const handleNextStep = () => {
    setCurrentStep(prev => Math.min(prev + 1, 5));
  };
  
  const handlePrevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };
  
  const handleWizardSubmit = async () => {
    if (!organizationId || !user?.id) {
      showError('You must be signed in with an organization selected to submit.');
      return;
    }

    if (!wizardData.insurance || wizardData.services.length === 0) {
      showError('Select an insurance and at least one service.');
      return;
    }

    if (wizardData.services.some((code) => !wizardData.units[code] || wizardData.units[code] <= 0)) {
      showError('Enter units for all selected services.');
      return;
    }

    setIsSubmitting(true);

    try {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(startDate.getDate() + 180);

      const { data: authorization, error: insertAuthError } = await supabase
        .from('authorizations')
        .insert({
          authorization_number: `AUTH-${Date.now()}`,
          client_id: client.id,
          provider_id: user.id,
          insurance_provider_id: null,
          diagnosis_code: 'TBD',
          diagnosis_description: wizardData.insurance || null,
          start_date: startDate.toISOString().slice(0, 10),
          end_date: endDate.toISOString().slice(0, 10),
          status: 'approved',
          organization_id: organizationId,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (insertAuthError || !authorization) {
        throw insertAuthError || new Error('Unable to create authorization');
      }

      const servicesPayload = wizardData.services.map((serviceCode) => ({
        authorization_id: authorization.id,
        service_code: serviceCode,
        service_description: serviceCatalog[serviceCode] ?? '',
        from_date: startDate.toISOString().slice(0, 10),
        to_date: endDate.toISOString().slice(0, 10),
        requested_units: wizardData.units[serviceCode],
        approved_units: wizardData.units[serviceCode],
        unit_type: 'unit',
        decision_status: 'approved',
        organization_id: organizationId,
        created_by: user.id,
      }));

      const { error: servicesError } = await supabase
        .from('authorization_services')
        .insert(servicesPayload);

      if (servicesError) {
        throw servicesError;
      }

      // Upload documents and attach metadata
      const uploadedDocuments: Array<{ name: string; path: string; size: number; type: string }> = [];
      for (const file of wizardData.documents) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
        const storagePath = `clients/${client.id}/authorizations/${authorization.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('client-documents')
          .upload(storagePath, file, { upsert: false });

        if (uploadError) {
          throw uploadError;
        }

        uploadedDocuments.push({
          name: file.name,
          path: storagePath,
          size: file.size,
          type: file.type,
        });
      }

      if (uploadedDocuments.length > 0) {
        const { error: docUpdateError } = await supabase
          .from('authorizations')
          .update({ documents: uploadedDocuments })
          .eq('id', authorization.id);

        if (docUpdateError) {
          throw docUpdateError;
        }
      }

      showSuccess('Pre-authorization submitted and approved.');
      await queryClient.invalidateQueries({ queryKey: ['authorizations', client.id] });
      setIsWizardOpen(false);
      setCurrentStep(1);
      setWizardData({
        insurance: '',
        services: [],
        units: {},
        documents: [],
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to submit pre-authorization.');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleRenewAuthorization = (auth: Authorization) => {
    setWizardData({
      insurance: 'CalOptima Health', // This would be the actual insurance from the auth
      services: auth.services.map(s => s.service_code),
      units: auth.services.reduce((acc, s) => {
        acc[s.service_code] = s.requested_units;
        return acc;
      }, {} as Record<string, number>),
      documents: [],
    });
    setIsWizardOpen(true);
  };

  const handleFilesAdded = (fileList: FileList | null) => {
    if (!fileList?.length) {
      return;
    }

    const acceptedFiles: File[] = [];
    Array.from(fileList).forEach((file) => {
      const isAcceptedType = ACCEPTED_FILE_TYPES.includes(file.type as typeof ACCEPTED_FILE_TYPES[number]);
      if (!isAcceptedType) {
        showError(`Unsupported file type: ${file.name}`);
        return;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        showError(`"${file.name}" exceeds the 10MB size limit.`);
        return;
      }

      acceptedFiles.push(file);
    });

    if (!acceptedFiles.length) {
      return;
    }

    setWizardData((prev) => ({
      ...prev,
      documents: [...prev.documents, ...acceptedFiles],
    }));
  };

  const handleDocumentRemove = (index: number) => {
    setWizardData((prev) => ({
      ...prev,
      documents: prev.documents.filter((_, i) => i !== index),
    }));
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    handleFilesAdded(event.dataTransfer.files);
  };
  
  return (
    <div className="space-y-8">
      {/* Auth Tracker Table */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Authorization Tracker
          </h3>
          <button
            onClick={() => setIsWizardOpen(true)}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
          >
            <Plus className="w-4 h-4 mr-1" />
            New Authorization
          </button>
        </div>
        
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : authorizations.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            No authorizations found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Authorization
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Services
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Units
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Dates
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-dark-lighter divide-y divide-gray-200 dark:divide-gray-700">
                {authorizations.map(auth => {
                  const unitsUsedPercent = getUnitsUsedPercentage(auth);
                  const isAuthExpiring = isExpiring(auth.end_date);
                  const displayStatus = isAuthExpiring ? 'expiring' : auth.status;
                  
                  return (
                    <tr key={auth.id} className={`
                      ${isAuthExpiring ? 'bg-orange-50 dark:bg-orange-900/5' : ''}
                      ${unitsUsedPercent >= 80 ? 'bg-red-50 dark:bg-red-900/5' : ''}
                    `}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <ClipboardCheck className="h-5 w-5 text-gray-400 mr-3" />
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-white">
                              #{auth.authorization_number}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              CalOptima Health
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col space-y-1">
                          {auth.services.map(service => (
                            <div key={service.id} className="text-xs">
                              <span className="font-medium text-gray-900 dark:text-white">
                                {service.service_code}
                              </span>
                              <span className="ml-1 text-gray-500 dark:text-gray-400">
                                {service.service_description}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col space-y-2">
                          {auth.services.map(service => (
                            <div key={service.id} className="text-xs">
                              <div className="flex justify-between mb-1">
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {/* This would show actual used units in a real app */}
                                  {Math.floor((service.approved_units || 0) * 0.7)} / {service.approved_units || 0}
                                </span>
                                <span className="text-gray-500 dark:text-gray-400">
                                  {service.unit_type}
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                                <div 
                                  className={`h-1.5 rounded-full ${
                                    (service.approved_units || 0) * 0.7 >= service.approved_units * 0.8
                                      ? 'bg-red-600'
                                      : 'bg-blue-600'
                                  }`}
                                  style={{ width: `${Math.min(((service.approved_units || 0) * 0.7 / service.approved_units) * 100, 100)}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <Calendar className="w-4 h-4 text-gray-400 mr-1" />
                          <div className="text-sm text-gray-900 dark:text-white">
                            {new Date(auth.start_date).toLocaleDateString()} - {new Date(auth.end_date).toLocaleDateString()}
                          </div>
                        </div>
                        {isAuthExpiring && (
                          <div className="flex items-center mt-1 text-xs text-orange-600 dark:text-orange-400">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Expires in {Math.ceil((new Date(auth.end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} days
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusClass(displayStatus)}`}>
                          {displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleRenewAuthorization(auth)}
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            Renew
                          </button>
                          <button
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      {/* KPI Sidebar */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
          Authorization Metrics
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
            <div className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
              Median Approval Time
            </div>
            <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">
              7 days
            </div>
            <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              Industry average: 14 days
            </div>
          </div>
          
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
            <div className="text-sm font-medium text-green-800 dark:text-green-200 mb-1">
              Approval Rate
            </div>
            <div className="text-2xl font-bold text-green-900 dark:text-green-100">
              92%
            </div>
            <div className="text-xs text-green-700 dark:text-green-300 mt-1">
              Industry average: 85%
            </div>
          </div>
          
          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
            <div className="text-sm font-medium text-purple-800 dark:text-purple-200 mb-1">
              Average Units Approved
            </div>
            <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">
              95%
            </div>
            <div className="text-xs text-purple-700 dark:text-purple-300 mt-1">
              Of requested units
            </div>
          </div>
        </div>
      </div>
      
      {/* Auth Intake Wizard */}
      {isWizardOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
              Authorization Request Wizard
            </h2>
            
            {/* Wizard Progress */}
            <div className="mb-8">
              <div className="flex items-center justify-between">
                {[1, 2, 3, 4, 5].map(step => (
                  <div 
                    key={step}
                    className={`flex items-center justify-center w-8 h-8 rounded-full ${
                      step < currentStep
                        ? 'bg-blue-600 text-white'
                        : step === currentStep
                          ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border-2 border-blue-600'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                  >
                    {step < currentStep ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      <span>{step}</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
                <span>Insurance</span>
                <span>Services</span>
                <span>Units</span>
                <span>Documents</span>
                <span>Submit</span>
              </div>
            </div>
            
            {/* Step Content */}
            <div className="mb-8">
              {currentStep === 1 && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                    Insurance & Plan
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="preauth-insurance" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Insurance Provider
                      </label>
                      <select
                        id="preauth-insurance"
                        value={wizardData.insurance}
                        onChange={(e) => setWizardData({...wizardData, insurance: e.target.value})}
                        className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                      >
                        <option value="">Select insurance</option>
                        <option value="CalOptima Health">CalOptima Health</option>
                        <option value="Anthem Blue Cross">Anthem Blue Cross</option>
                        <option value="Kaiser Permanente">Kaiser Permanente</option>
                      </select>
                    </div>
                    
                    <div>
                      <label htmlFor="preauth-plan-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Plan Type
                      </label>
                      <select
                        id="preauth-plan-type"
                        className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                      >
                        <option value="">Select plan type</option>
                        <option value="Medicaid">Medicaid</option>
                        <option value="Commercial">Commercial</option>
                        <option value="Medicare">Medicare</option>
                      </select>
                    </div>
                    
                    <div>
                      <label htmlFor="preauth-member-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Member ID
                      </label>
                      <input
                        id="preauth-member-id"
                        type="text"
                        className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                        defaultValue={client.client_id || ''}
                      />
                    </div>
                  </div>
                </div>
              )}
              
              {currentStep === 2 && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                    Requested Services
                  </h3>
                  <div className="space-y-3">
                    {[
                      { code: '97151', description: 'Behavior identification assessment' },
                      { code: '97153', description: 'Adaptive behavior treatment by protocol' },
                      { code: '97155', description: 'Adaptive behavior treatment with protocol modification' },
                      { code: '97156', description: 'Family adaptive behavior treatment guidance' },
                      { code: '97157', description: 'Multiple-family group adaptive behavior treatment guidance' },
                      { code: '97158', description: 'Group adaptive behavior treatment with protocol modification' }
                    ].map(service => (
                      <div key={service.code} className="flex items-center">
                        <input
                          type="checkbox"
                          id={`service-${service.code}`}
                          checked={wizardData.services.includes(service.code)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setWizardData({
                                ...wizardData,
                                services: [...wizardData.services, service.code]
                              });
                            } else {
                              setWizardData({
                                ...wizardData,
                                services: wizardData.services.filter(s => s !== service.code)
                              });
                            }
                          }}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor={`service-${service.code}`} className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                          <span className="font-medium">{service.code}</span> - {service.description}
                        </label>
                      </div>
                    ))}
                  </div>
                  
                  {wizardData.services.includes('97153') && (
                    <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <div className="flex items-start">
                        <FileText className="w-5 h-5 text-blue-500 mt-0.5 mr-2" />
                        <div>
                          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                            Required Documentation for 97153
                          </p>
                          <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                            Treatment plan must be uploaded with this request
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {currentStep === 3 && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                    Units / Hours Requested
                  </h3>
                  <div className="space-y-4">
                    {wizardData.services.map(serviceCode => (
                      <div key={serviceCode} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                        <div className="flex justify-between items-center mb-2">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {serviceCode}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            1 unit = 15 minutes
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label htmlFor={`preauth-units-${serviceCode}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Units Requested
                            </label>
                            <input
                              id={`preauth-units-${serviceCode}`}
                              type="number"
                              min="1"
                              value={wizardData.units[serviceCode] || ''}
                              onChange={(e) => setWizardData({
                                ...wizardData,
                                units: {
                                  ...wizardData.units,
                                  [serviceCode]: parseInt(e.target.value) || 0
                                }
                              })}
                              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                            />
                          </div>
                          
                          <div>
                            <label htmlFor={`preauth-hours-${serviceCode}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Hours Equivalent
                            </label>
                            <input
                              id={`preauth-hours-${serviceCode}`}
                              type="text"
                              value={((wizardData.units[serviceCode] || 0) / 4).toFixed(2)}
                              readOnly
                              className="w-full rounded-md border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:text-gray-200"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {currentStep === 4 && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                    Upload Supporting Documents
                  </h3>
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                      isDragActive
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/10'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                    role="button"
                    tabIndex={0}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragActive(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setIsDragActive(false);
                    }}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                  >
                    <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                      Drag and drop files here, or click to select files
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                      Supported formats: PDF, DOCX, JPG, PNG (max 10MB)
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/20 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Select Files
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(event) => {
                        handleFilesAdded(event.target.files);
                        if (event.target.value) {
                          event.target.value = '';
                        }
                      }}
                    />
                  </div>
                  
                  {wizardData.documents.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Uploaded Files
                      </h4>
                      <ul className="space-y-2">
                        {wizardData.documents.map((file, index) => (
                          <li
                            key={`${file.name}-${index}`}
                            className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                          >
                            <div>
                              <p className="font-medium">{file.name}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {(file.size / (1024 * 1024)).toFixed(2)} MB
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDocumentRemove(index)}
                              className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-xs font-medium"
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Required Documents
                    </h4>
                    <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
                      <li>Treatment plan</li>
                      <li>Diagnostic evaluation</li>
                      <li>Progress report (if renewal)</li>
                    </ul>
                  </div>
                </div>
              )}
              
              {currentStep === 5 && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                    Review & Submit
                  </h3>
                  
                  <div className="space-y-4">
                    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Insurance & Plan
                      </h4>
                      <p className="text-sm text-gray-900 dark:text-white">
                        {wizardData.insurance || 'Not selected'}
                      </p>
                    </div>
                    
                    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Requested Services
                      </h4>
                      <div className="space-y-1">
                        {wizardData.services.map(service => (
                          <div key={service} className="flex justify-between text-sm">
                            <span className="text-gray-900 dark:text-white">{service}</span>
                            <span className="text-gray-600 dark:text-gray-400">
                              {wizardData.units[service] || 0} units ({((wizardData.units[service] || 0) / 4).toFixed(2)} hours)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Supporting Documents
                      </h4>
                      <p className="text-sm text-gray-900 dark:text-white">
                        {wizardData.documents.length} documents uploaded
                      </p>
                    </div>
                    
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <div className="flex items-start">
                        <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5 mr-2" />
                        <div>
                          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                            Submission Notice
                          </p>
                          <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                            By submitting this request, you certify that all information is accurate and complete.
                            The authorization will be submitted to the payer for review.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Wizard Navigation */}
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => {
                  if (currentStep === 1) {
                    setIsWizardOpen(false);
                  } else {
                    handlePrevStep();
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                {currentStep === 1 ? 'Cancel' : 'Back'}
              </button>
              
              <button
                type="button"
                onClick={currentStep === 5 ? handleWizardSubmit : handleNextStep}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center disabled:opacity-50"
              >
                {currentStep === 5 ? (
                  <>{isSubmitting ? 'Submitting…' : 'Submit Request'}</>
                ) : (
                  <>Next <ArrowRight className="ml-1 w-4 h-4" /></>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}