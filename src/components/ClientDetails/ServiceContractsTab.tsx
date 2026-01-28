import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Contact as FileContract, FileText, Plus, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useActiveOrganizationId } from '../../lib/organization';

interface ServiceContractsTabProps {
  client: { id: string };
}

interface Contract {
  id: string;
  payer_name: string;
  effective_date: string;
  termination_date: string;
  covered_cpt_codes: {
    code: string;
    description: string;
    rate: number;
    modifiers?: string[];
  }[];
  reimbursement_method: 'ACH' | 'Check';
  file_url: string;
  confidence_score: number;
  versions: {
    id: string;
    uploaded_at: string;
    uploaded_by: string;
  }[];
}

export default function ServiceContractsTab({ client }: ServiceContractsTabProps) {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [expandedContract, setExpandedContract] = useState<string | null>(null);
  const organizationId = useActiveOrganizationId();

  const {
    data: cptCodes = [],
    isLoading: isLoadingCptCodes,
    error: cptCodesError,
  } = useQuery({
    queryKey: ['cpt-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cpt_codes')
        .select('code, short_description')
        .eq('is_active', true)
        .order('code');
      if (error) throw error;
      return data as Array<{ code: string; short_description: string }>;
    },
  });
  
  const {
    data: serviceContracts = [],
    isLoading: isLoadingContracts,
    error: contractsError,
  } = useQuery({
    queryKey: ['service-contracts', client.id, organizationId ?? 'MISSING_ORG'],
    queryFn: async () => {
      if (!organizationId) {
        throw new Error('Organization context is required to load service contracts.');
      }

      const { data, error } = await supabase
        .from('service_contracts')
        .select(`
          id,
          payer_name,
          effective_date,
          termination_date,
          reimbursement_method,
          file_url,
          confidence_score,
          versions:service_contract_versions(
            id,
            uploaded_at,
            uploaded_by
          ),
          rates:service_contract_rates(
            rate,
            modifiers,
            cpt_code:cpt_codes(
              code,
              short_description
            )
          )
        `)
        .eq('client_id', client.id)
        .eq('organization_id', organizationId)
        .order('effective_date', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(client.id && organizationId),
  });
  
  const toggleContract = (contractId: string) => {
    if (expandedContract === contractId) {
      setExpandedContract(null);
    } else {
      setExpandedContract(contractId);
    }
  };
  
  const handleGenerateSummary = (contractId: string) => {
    // This would generate a PDF summary of the contract
    alert(`Generating summary for contract ${contractId}`);
  };

  const cptCodeOptions = useMemo(() => {
    return cptCodes.map((code) => ({
      value: code.code,
      label: `${code.code} - ${code.short_description}`,
    }));
  }, [cptCodes]);

  const cptCodeDescriptions = useMemo(() => {
    return cptCodes.reduce<Record<string, string>>((acc, code) => {
      acc[code.code] = code.short_description;
      return acc;
    }, {});
  }, [cptCodes]);

  const cptCodesErrorMessage =
    cptCodesError instanceof Error ? cptCodesError.message : 'Unable to load CPT codes.';

  const contractsErrorMessage =
    contractsError instanceof Error ? contractsError.message : 'Unable to load service contracts.';

  const contracts = useMemo<Contract[]>(() => {
    return (serviceContracts ?? []).map((contract: {
      id: string;
      payer_name: string;
      effective_date: string;
      termination_date: string;
      reimbursement_method: string;
      file_url: string | null;
      confidence_score: number | null;
      versions?: Array<{ id: string; uploaded_at: string; uploaded_by: string | null }> | null;
      rates?: Array<{
        rate: number | null;
        modifiers: string[] | null;
        cpt_code?: { code: string; short_description: string } | null;
      }> | null;
    }) => ({
      id: contract.id,
      payer_name: contract.payer_name,
      effective_date: contract.effective_date,
      termination_date: contract.termination_date,
      covered_cpt_codes: (contract.rates ?? []).map((rate) => ({
        code: rate.cpt_code?.code ?? 'Unknown',
        description: rate.cpt_code?.short_description ?? '',
        rate: rate.rate ?? 0,
        modifiers: rate.modifiers ?? undefined,
      })),
      reimbursement_method: contract.reimbursement_method === 'Check' ? 'Check' : 'ACH',
      file_url: contract.file_url ?? '#',
      confidence_score: contract.confidence_score ?? 0,
      versions: (contract.versions ?? []).map((version) => ({
        id: version.id,
        uploaded_at: version.uploaded_at,
        uploaded_by: version.uploaded_by ?? 'Unknown',
      })),
    }));
  }, [serviceContracts]);
  
  return (
    <div className="space-y-8">
      {/* Contract Upload */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Service Contracts
          </h3>
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
          >
            <Plus className="w-4 h-4 mr-1" />
            Upload Contract
          </button>
        </div>
        
        {contractsError && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
            {contractsErrorMessage}
          </div>
        )}

        {isLoadingContracts ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            Loading contracts...
          </div>
        ) : contracts.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            No contracts found
          </div>
        ) : (
          <div className="space-y-4">
            {contracts.map(contract => (
              <div 
                key={contract.id} 
                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
              >
                <div 
                  className="bg-gray-50 dark:bg-gray-800 p-4 flex justify-between items-center cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleContract(contract.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleContract(contract.id); }}
                >
                  <div className="flex items-center">
                    <FileContract className="h-5 w-5 text-blue-600 dark:text-blue-400 mr-3" />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {contract.payer_name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Valid: {new Date(contract.effective_date).toLocaleDateString()} - {new Date(contract.termination_date).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGenerateSummary(contract.id);
                      }}
                      className="mr-4 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      Generate Summary
                    </button>
                    {expandedContract === contract.id ? (
                      <ChevronUp className="h-5 w-5 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-gray-400" />
                    )}
                  </div>
                </div>
                
                {expandedContract === contract.id && (
                  <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="mb-4">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Covered CPT Codes & Rates
                      </h4>
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-800">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                              Code
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                              Description
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                              Rate
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                              Modifiers
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-dark-lighter divide-y divide-gray-200 dark:divide-gray-700">
                          {contract.covered_cpt_codes.map(cpt => {
                            const catalogDescription = cptCodeDescriptions[cpt.code];
                            return (
                            <tr key={cpt.code}>
                              <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                {cpt.code}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-900 dark:text-white">
                                {catalogDescription ?? cpt.description}
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                ${cpt.rate.toFixed(2)}
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                {cpt.modifiers?.join(', ') || 'None'}
                              </td>
                            </tr>
                          );
                          })}
                        </tbody>
                      </table>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Contract Details
                        </h4>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500 dark:text-gray-400">Reimbursement Method:</span>
                            <span className="text-gray-900 dark:text-white">{contract.reimbursement_method}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500 dark:text-gray-400">Confidence Score:</span>
                            <span className="text-gray-900 dark:text-white">{(contract.confidence_score * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Version History
                        </h4>
                        <div className="space-y-2">
                          {contract.versions.map(version => (
                            <div key={version.id} className="flex justify-between text-sm">
                              <span className="text-gray-500 dark:text-gray-400">
                                {new Date(version.uploaded_at).toLocaleDateString()}
                              </span>
                              <span className="text-gray-900 dark:text-white">{version.uploaded_by}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-4 flex justify-end">
                      <button
                        className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Download Original
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Billing Codes & Units Helper */}
      <div className="bg-white dark:bg-dark-lighter rounded-lg border dark:border-gray-700 p-6">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
          Billing Codes & Units Helper
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="helper-cpt-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              CPT Code
            </label>
            <select
              id="helper-cpt-code"
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              defaultValue=""
              disabled={isLoadingCptCodes}
            >
              <option value="">
                {isLoadingCptCodes ? 'Loading CPT codes...' : 'Select CPT code'}
              </option>
              {cptCodeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {cptCodesError
                ? cptCodesErrorMessage
                : 'Codes and descriptions sourced from the CPT catalog.'}
            </p>
          </div>
          
          <div>
            <label htmlFor="helper-units" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Units
            </label>
            <div className="flex items-center">
              <input
                id="helper-units"
                type="number"
                min="1"
                defaultValue="4"
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
              <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                = 1 hour
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              1 unit = 15 minutes
            </p>
          </div>
        </div>
        
        <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Typical Modifiers
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-sm">
              <span className="font-medium text-gray-900 dark:text-white">HO</span>
              <span className="ml-2 text-gray-600 dark:text-gray-400">Master's level provider</span>
            </div>
            <div className="text-sm">
              <span className="font-medium text-gray-900 dark:text-white">HN</span>
              <span className="ml-2 text-gray-600 dark:text-gray-400">Bachelor's level provider</span>
            </div>
            <div className="text-sm">
              <span className="font-medium text-gray-900 dark:text-white">GT</span>
              <span className="ml-2 text-gray-600 dark:text-gray-400">Via telehealth</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Contract Upload Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Upload Contract
            </h2>
            
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                Drag and drop contract file here, or click to select
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Supported formats: PDF, DOCX, JPG, PNG (max 10MB)
              </p>
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/20 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Select File
              </button>
            </div>
            
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <div className="flex items-start">
                <FileText className="w-5 h-5 text-blue-500 mt-0.5 mr-2" />
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    Automatic Contract Parsing
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Our system will automatically extract key information from your contract, including covered CPT codes, rates, and effective dates. You'll have a chance to review and edit the extracted information before saving.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => setIsUploadModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Upload & Process
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}