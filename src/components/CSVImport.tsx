import React, { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { AlertCircle, Upload, CheckCircle, X } from 'lucide-react';
import { showSuccess, showError } from '../lib/toast';
import type { Client, Therapist } from '../types';

interface CSVImportProps {
  onClose: () => void;
  entityType?: 'client' | 'therapist';
}

interface ImportStatus {
  total: number;
  processed: number;
  success: number;
  failed: number;
  inProgress: boolean;
  errors: { row: number; message: string }[];
}

const CSVImport: React.FC<CSVImportProps> = ({ onClose, entityType = 'client' }) => {
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [headerMap, setHeaderMap] = useState<Record<string, string>>({});
  const [importStatus, setImportStatus] = useState<ImportStatus>({
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    inProgress: false,
    errors: []
  });
  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'import'>('upload');
  
  const queryClient = useQueryClient();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target && typeof event.target.result === 'string') {
          parseCSV(event.target.result);
        }
      };
      reader.readAsText(e.target.files[0]);
    }
  };

  const parseCSV = (content: string) => {
    // Basic CSV parsing - split by newlines and commas
    // More sophisticated parsing would handle quoted fields with commas, etc.
    const lines = content.split('\n');
    
    // Find the actual header line (skipping initial description rows)
    let headerIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('First Name') && lines[i].includes('Last Name') && lines[i].includes('DOB')) {
        headerIndex = i;
        break;
      }
    }
    
    const headerLine = lines[headerIndex];
    const headers = headerLine.split(',').map(h => h.trim());
    
    // Parse the data rows
    const dataRows: string[][] = [];
    for (let i = headerIndex + 1; i < lines.length; i++) {
      if (lines[i].trim()) {
        const rowData = parseCSVLine(lines[i]);
        if (rowData.length >= headers.length / 2) { // Basic validation to ensure row has enough columns
          dataRows.push(rowData);
        }
      }
    }
    
    setHeaders(headers);
    setCsvData(dataRows);
    
    // Create initial header mapping suggestion
    const initialMap: Record<string, string> = {};
    headers.forEach((header, index) => {
      // Map CSV headers to client fields
      const normalizedHeader = header.toLowerCase().trim();
      if (normalizedHeader.includes('first name')) initialMap[index.toString()] = 'first_name';
      else if (normalizedHeader.includes('middle name')) initialMap[index.toString()] = 'middle_name';
      else if (normalizedHeader.includes('last name')) initialMap[index.toString()] = 'last_name';
      else if ((normalizedHeader.includes('dob') || normalizedHeader.includes('birth')) && entityType === 'client') initialMap[index.toString()] = 'date_of_birth';
      else if (normalizedHeader.includes('gender') && entityType === 'client') initialMap[index.toString()] = 'gender';
      else if (normalizedHeader.includes('street')) {
        initialMap[index.toString()] = entityType === 'client' ? 'address_line1' : 'street';
      }
      else if (normalizedHeader.includes('city')) initialMap[index.toString()] = 'city';
      else if (normalizedHeader.includes('state')) initialMap[index.toString()] = 'state';
      else if (normalizedHeader.includes('postal') || normalizedHeader.includes('zip')) initialMap[index.toString()] = 'zip_code';
      else if ((entityType === 'client' && normalizedHeader.includes('client id')) || 
               (entityType === 'therapist' && normalizedHeader.includes('staff id'))) {
        initialMap[index.toString()] = entityType === 'client' ? 'client_id' : 'staff_id';
      }
      else if (entityType === 'client' && normalizedHeader.includes('uci')) initialMap[index.toString()] = 'cin_number';
      else if (entityType === 'therapist' && normalizedHeader.includes('npi')) initialMap[index.toString()] = 'npi_number';
      else if (entityType === 'therapist' && normalizedHeader.includes('facility')) initialMap[index.toString()] = 'facility';
      else if (entityType === 'therapist' && normalizedHeader.includes('title')) initialMap[index.toString()] = 'title';
      else if (normalizedHeader.includes('email')) initialMap[index.toString()] = 'email';
      else if (normalizedHeader.includes('phone')) initialMap[index.toString()] = 'phone';
      else if (normalizedHeader.includes('notes')) initialMap[index.toString()] = 'notes';
    });
    
    setHeaderMap(initialMap);
    setStep('map');
  };
  
  const parseCSVLine = (line: string): string[] => {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current); // Push the last field
    return result.map(field => field.trim());
  };

  const handleHeaderMapChange = (index: string, value: string) => {
    setHeaderMap(prev => ({
      ...prev,
      [index]: value
    }));
  };

  const previewData = useCallback(() => {
    setStep('preview');
  }, []);

  const createEntityMutation = useMutation({
    mutationFn: async (data: Partial<Client> | Partial<Therapist>) => {
      const { data: insertedData, error } = await supabase
        .from(entityType === 'client' ? 'clients' : 'therapists')
        .insert([data])
        .select('id')
        .single();
      
      if (error) throw error;
      return insertedData;
    }
  });
  
  const processImport = async () => {
    setImportStatus({
      total: csvData.length,
      processed: 0,
      success: 0,
      failed: 0,
      inProgress: true,
      errors: []
    });
    setStep('import');
    
    // Process in batches to avoid overwhelming the server
    const batchSize = 5;
    
    for (let i = 0; i < csvData.length; i += batchSize) {
      const batch = csvData.slice(i, i + batchSize);
      const promises = batch.map(async (row, rowIndex) => {
        const actualRowIndex = i + rowIndex;
        try {
          // Map CSV data to entity object
          const entityData: Partial<Client> | Partial<Therapist> = {};
          
          // Map fields according to headerMap
          for (const [index, field] of Object.entries(headerMap)) {
            if (field && row[parseInt(index)] !== undefined) {
              let value = row[parseInt(index)].trim();
              
              // Special handling for date fields
              if (field === 'date_of_birth' && value) {
                // Convert MM/DD/YYYY to YYYY-MM-DD
                const parts = value.split('/');
                if (parts.length === 3) {
                  value = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
                }
              }
              
              // Handle service preferences
              if (field === 'service_preference' && value) {
                entityData.service_preference = value.split(',').map(s => s.trim());
              } else if (field === 'service_type' && value) {
                entityData.service_type = value.split(',').map(s => s.trim());
              } else if (field === 'specialties' && value) {
                entityData.specialties = value.split(',').map(s => s.trim());
              } else {
                entityData[field] = value || null;
              }
            }
          }
          
          // Ensure we have a full_name
          if (entityData.first_name || entityData.last_name) {
            entityData.full_name = [entityData.first_name, entityData.middle_name, entityData.last_name]
              .filter(Boolean)
              .join(' ');
          }
          
          // Create entity
          await createEntityMutation.mutateAsync(entityData);
          
          setImportStatus(prev => ({
            ...prev,
            processed: prev.processed + 1,
            success: prev.success + 1
          }));
        } catch (error) {
          console.error(`Error importing row ${actualRowIndex}:`, error);
          setImportStatus(prev => ({
            ...prev,
            processed: prev.processed + 1,
            failed: prev.failed + 1,
            errors: [...prev.errors, { 
              row: actualRowIndex + 1, 
              message: error instanceof Error ? error.message : 'Unknown error' 
            }]
          }));
        }
      });
      
      await Promise.all(promises);
    }
    
    setImportStatus(prev => ({
      ...prev,
      inProgress: false
    }));
    
    // Refresh client data
    queryClient.invalidateQueries({ queryKey: [entityType === 'client' ? 'clients' : 'therapists'] });
    
    if (importStatus.failed === 0) {
      showSuccess(`Successfully imported ${importStatus.success} ${entityType}s`);
    } else {
      showError(`Imported ${importStatus.success} ${entityType}s with ${importStatus.failed} failures`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Import {entityType === 'client' ? 'Clients' : 'Therapists'} from CSV
          </h2>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'upload' && (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg mb-6 max-w-xl">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      Upload a CSV file containing {entityType === 'client' ? 'client' : 'therapist'} information. 
                      The file should include columns for information such as names, contact details, etc.
                    </p>
                  </div>
                </div>
              </div>
              
              <label className="flex flex-col items-center px-4 py-6 bg-white dark:bg-gray-800 text-blue rounded-lg shadow-lg tracking-wide uppercase border border-blue cursor-pointer hover:bg-blue-500 hover:text-white">
                <Upload className="w-8 h-8" />
                <span className="mt-2 text-base leading-normal">Select a CSV file</span>
                <input type='file' accept=".csv" className="hidden" onChange={handleFileChange} />
              </label>
              
              {file && (
                <div className="mt-4 text-center">
                  <p className="text-sm text-gray-600 dark:text-gray-400">Selected file: {file.name}</p>
                </div>
              )}
            </div>
          )}
          
          {step === 'map' && headers.length > 0 && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                Map CSV Headers to {entityType === 'client' ? 'Client' : 'Therapist'} Fields
              </h3>
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                Please map the CSV headers to the corresponding {entityType} fields. We've made some suggestions based on the header names.
              </p>
              
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg mb-6">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      Fields like First Name, Last Name, and Date of Birth are most important. Other fields are optional.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                {headers.map((header, index) => (
                  <div key={index} className="border dark:border-gray-700 rounded-lg p-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {header}
                    </p>
                    <select 
                      value={headerMap[index.toString()] || ''}
                      onChange={(e) => handleHeaderMapChange(index.toString(), e.target.value)}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-200"
                    >
                      <option value="">-- Skip this field --</option>
                      <option value="first_name">First Name</option>
                      <option value="middle_name">Middle Name</option>
                      <option value="last_name">Last Name</option>
                      <option value="email">Email</option>
                      <option value="phone">Phone</option>
                      {entityType === 'client' ? (
                        <>
                          <option value="date_of_birth">Date of Birth</option>
                          <option value="gender">Gender</option>
                          <option value="client_id">Client ID</option>
                          <option value="cin_number">UCI/CIN Number</option>
                          <option value="service_preference">Service Preference</option>
                          <option value="diagnosis">Diagnosis</option>
                          <option value="preferred_language">Preferred Language</option>
                        </>
                      ) : (
                        <>
                          <option value="title">Title/Position</option>
                          <option value="staff_id">Staff ID</option>
                          <option value="npi_number">NPI Number</option>
                          <option value="medicaid_id">Medicaid ID</option>
                          <option value="service_type">Service Types</option>
                          <option value="specialties">Specialties</option>
                          <option value="facility">Facility/Location</option>
                          <option value="supervisor">Supervisor</option>
                          <option value="weekly_hours_min">Min Weekly Hours</option>
                          <option value="weekly_hours_max">Max Weekly Hours</option>
                        </>
                      )}
                      {entityType === 'client' ? (
                        <option value="address_line1">Street Address</option>
                      ) : (
                        <option value="street">Street Address</option>
                      )}
                      <option value="city">City</option>
                      <option value="state">State</option>
                      <option value="zip_code">Postal/ZIP Code</option>
                      <option value="notes">Notes</option>
                    </select>
                  </div>
                ))}
              </div>
              
              <div className="flex justify-end">
                <button
                  onClick={previewData}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Preview Import Data
                </button>
              </div>
            </div>
          )}
          
          {step === 'preview' && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                Preview Import Data
              </h3>
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                Review the data that will be imported. {csvData.length} {entityType}s will be created.
              </p>
              
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      {Object.entries(headerMap).filter(([_, field]) => field).map(([index, field]) => (
                        <th key={index} className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          {field}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {csvData.slice(0, 5).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {Object.entries(headerMap).filter(([_, field]) => field).map(([index, _]) => (
                          <td key={index} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {row[parseInt(index)] || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {csvData.length > 5 && (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  ... and {csvData.length - 5} more rows
                </p>
              )}
              
              <div className="mt-4 flex justify-end space-x-4">
                <button
                  onClick={() => setStep('map')}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  Back to Mapping
                </button>
                <button
                  onClick={processImport}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Start Import
                </button>
              </div>
            </div>
          )}
          
          {step === 'import' && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                Importing {entityType === 'client' ? 'Clients' : 'Therapists'}
              </h3>
              
              <div className="mb-6">
                <div className="mb-2 flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Progress</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {importStatus.processed} of {importStatus.total}
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full" 
                    style={{ width: `${(importStatus.processed / importStatus.total) * 100}%` }}
                  ></div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                  <div className="flex items-center">
                    <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-300">
                      Successful Imports
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-green-700 dark:text-green-300">
                    {importStatus.success}
                  </p>
                </div>
                
                <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                  <div className="flex items-center">
                    <X className="h-5 w-5 text-red-500 mr-2" />
                    <span className="text-sm font-medium text-red-700 dark:text-red-300">
                      Failed Imports
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-red-700 dark:text-red-300">
                    {importStatus.failed}
                  </p>
                </div>
              </div>
              
              {importStatus.errors.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-md font-medium text-gray-900 dark:text-white mb-2">
                    Error Details
                  </h4>
                  <div className="bg-red-50 dark:bg-red-900/10 rounded-lg p-4 max-h-48 overflow-y-auto">
                    {importStatus.errors.map((error, index) => (
                      <div key={index} className="text-sm text-red-700 dark:text-red-300 mb-1">
                        <span className="font-medium">Row {error.row}:</span> {error.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {!importStatus.inProgress && (
                <div className="flex justify-end">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        
        {(step === 'upload' || step === 'map') && (
          <div className="p-4 border-t dark:border-gray-700 flex justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            
            {step === 'map' && (
              <button
                onClick={previewData}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Continue
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CSVImport;