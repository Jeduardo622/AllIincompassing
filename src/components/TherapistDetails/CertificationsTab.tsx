import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Award, Calendar, FileText, Plus, Download, Inbox,
  CheckCircle, AlertTriangle, Trash2, Upload
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { showSuccess, showError } from '../../lib/toast';

interface CertificationsTabProps {
  therapist: any;
}

interface Certification {
  id: string;
  name: string;
  type: string;
  issue_date: string;
  expiry_date: string | null;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number;
  status: 'active' | 'expired' | 'pending';
  notes: string | null;
}

export default function CertificationsTab({ therapist }: CertificationsTabProps) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const queryClient = useQueryClient();
  
  // Fetch certifications
  const { data: certifications = [], isLoading } = useQuery({
    queryKey: ['therapist-certifications', therapist.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('therapist_certifications')
        .select('*')
        .eq('therapist_id', therapist.id)
        .order('expiry_date', { ascending: true });
        
      if (error) throw error;
      return data as Certification[];
    },
  });
  
  const deleteCertificationMutation = useMutation({
    mutationFn: async (certificationId: string) => {
      const { error } = await supabase
        .from('therapist_certifications')
        .delete()
        .eq('id', certificationId);
        
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['therapist-certifications', therapist.id] });
      showSuccess('Certification deleted successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });
  
  const handleDelete = async (certificationId: string) => {
    if (window.confirm('Are you sure you want to delete this certification?')) {
      await deleteCertificationMutation.mutateAsync(certificationId);
    }
  };
  
  const getStatusBadge = (certification: Certification) => {
    const now = new Date();
    const expiryDate = certification.expiry_date ? new Date(certification.expiry_date) : null;
    
    // Add more visible warning for certifications expiring soon
    const daysUntilExpiry = expiryDate ? 
      Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
    
    if (certification.status === 'pending') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
          <Clock className="w-3 h-3 mr-1" />
          Pending
        </span>
      );
    }
    
    if (certification.status === 'expired' || (expiryDate && expiryDate < now)) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Expired
        </span>
      );
    }
    
    // Check if expiring soon (within 30 days)
    if (expiryDate && ((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) <= 30) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Expiring in {daysUntilExpiry} days
        </span>
      );
    }
    
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300">
        <CheckCircle className="w-3 h-3 mr-1" />
        Active
      </span>
    );
  };
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">Certifications & Credentials</h2>
        <button
          onClick={() => setIsAddModalOpen(true)} 
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 flex items-center"
          aria-label="Add Certification"
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Certification
        </button>
      </div>
      
      {isLoading ? (
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-300">Loading certifications...</span>
        </div>
      ) : certifications.length === 0 ? (
        <div className="bg-white dark:bg-dark-lighter rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
          <Award className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-2">
            No Certifications Found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
            You haven't added any certifications or credentials yet. Add your professional 
            certifications to enhance your profile.
          </p>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Add First Certification
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {certifications.map(certification => (
            <div
              key={certification.id}
              className={`bg-white dark:bg-dark-lighter rounded-lg border ${
                certification.status === 'expired' 
                  ? 'border-red-200 dark:border-red-800' 
                  : certification.status === 'pending'
                  ? 'border-yellow-200 dark:border-yellow-800'
                  : 'border-green-200 dark:border-green-800'
              } shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md`}
            >
              <div className={`p-4 ${
                certification.status === 'expired'
                  ? 'bg-red-50 dark:bg-red-900/10 border-b border-red-200 dark:border-red-800'
                  : certification.status === 'pending'
                  ? 'bg-yellow-50 dark:bg-yellow-900/10 border-b border-yellow-200 dark:border-yellow-800'
                  : 'bg-green-50 dark:bg-green-900/10 border-b border-green-200 dark:border-green-800'
              } flex justify-between items-center`}>
                <div className="flex items-center">
                  <Award className="h-5 w-5 text-blue-600 dark:text-blue-400 mr-2" />
                  <h3 className="font-medium text-gray-900 dark:text-white">{certification.name}</h3>
                </div>
                {getStatusBadge(certification)}
              </div>
              
              <div className="p-4">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Type</p>
                    <p className="text-sm text-gray-900 dark:text-white">{certification.type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Issue Date</p>
                    <p className="text-sm text-gray-900 dark:text-white">
                      {new Date(certification.issue_date).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Expiry Date</p>
                    <p className="text-sm text-gray-900 dark:text-white">
                      {certification.expiry_date 
                        ? new Date(certification.expiry_date).toLocaleDateString() 
                        : 'No Expiration'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">File Type</p>
                    <p className="text-sm text-gray-900 dark:text-white">{certification.file_type}</p>
                  </div>
                </div>
                
                {certification.notes && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Notes</p>
                    <p className="text-sm text-gray-900 dark:text-white">{certification.notes}</p>
                  </div>
                )}
                
                <div className="flex justify-between items-center">
                  <a
                    href={certification.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center"
                  >
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </a>
                  
                  <button
                    onClick={() => handleDelete(certification.id)}
                    className="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 flex items-center"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Add Certification Modal */}
      {isAddModalOpen && (
        <AddCertificationModal
          therapistId={therapist.id}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={() => {
            setIsAddModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ['therapist-certifications', therapist.id] });
          }}
        />
      )}
    </div>
  );
}

interface AddCertificationModalProps {
  therapistId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function AddCertificationModal({ therapistId, onClose, onSuccess }: AddCertificationModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!file) {
      showError('Please select a file');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Upload file to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
      const filePath = `therapists/${therapistId}/certifications/${fileName}`;
      
      const { error: uploadError, data: uploadData } = await supabase.storage
        .from('therapist-documents')
        .upload(filePath, file);
        
      if (uploadError) throw uploadError;
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('therapist-documents')
        .getPublicUrl(filePath);
      
      // Create certification record
      const { error: insertError } = await supabase
        .from('therapist_certifications')
        .insert([{
          therapist_id: therapistId,
          name,
          type,
          issue_date: issueDate,
          expiry_date: expiryDate || null,
          file_url: publicUrl,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          status: 'active',
          notes: notes || null
        }]);
        
      if (insertError) throw insertError;
      
      showSuccess('Certification added successfully');
      onSuccess();
    } catch (error) {
      showError(error);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          Add Certification
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Certification Name*
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Type*
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              required
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            >
              <option value="">Select type</option>
              <option value="License">License</option>
              <option value="Certification">Certification</option>
              <option value="Degree">Degree</option>
              <option value="Training">Training</option>
              <option value="Other">Other</option>
            </select>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Issue Date*
              </label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                required
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Expiry Date
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Upload File*
            </label>
            <div className="mt-1 flex items-center">
              <input
                type="file"
                id="certification-file"
                onChange={handleFileChange}
                className="hidden"
                required
              />
              <label
                htmlFor="certification-file"
                className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 cursor-pointer"
              >
                <Upload className="w-4 h-4 inline-block mr-2" />
                Choose File
              </label>
              <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">
                {file ? file.name : 'No file chosen'}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Accepted formats: PDF, JPG, PNG, DOC, DOCX
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
              disabled={isSubmitting || !name || !type || !issueDate || !file}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Uploading...' : 'Add Certification'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}