import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, FileText, Clock, Lock, FileCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/authContext';
import { showError, showSuccess } from '../../lib/toast';

interface FileCabinetSetting {
  id: string;
  category_name: string;
  description: string | null;
  allowed_file_types: string[];
  max_file_size_mb: number;
  retention_period_days: number | null;
  requires_signature: boolean;
  is_active: boolean;
}

interface FileCabinetFormData {
  category_name: string;
  description: string;
  allowed_file_types: string[];
  max_file_size_mb: number;
  retention_period_days: string;
  requires_signature: boolean;
  is_active: boolean;
}

const DEFAULT_FILE_TYPES = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];

export default function FileCabinetSettings() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<FileCabinetSetting | null>(null);
  const [formData, setFormData] = useState<FileCabinetFormData>({
    category_name: '',
    description: '',
    allowed_file_types: DEFAULT_FILE_TYPES,
    max_file_size_mb: 10,
    retention_period_days: '',
    requires_signature: false,
    is_active: true,
  });

  const queryClient = useQueryClient();
  const { hasRole, loading: authLoading } = useAuth();
  const canManageConfig = hasRole('admin');

  const {
    data: categories = [],
    isLoading,
    error,
  } = useQuery<FileCabinetSetting[], Error>({
    queryKey: ['file-cabinet-settings'],
    queryFn: async () => {
      if (!canManageConfig) {
        throw new Error('Only admins can load file cabinet settings.');
      }
      const { data, error } = await supabase
        .from('file_cabinet_settings')
        .select('*')
        .order('category_name');

      if (error) throw error;
      return data as FileCabinetSetting[];
    },
    enabled: canManageConfig,
    retry: false,
  });

  const createCategory = useMutation({
    mutationFn: async (newCategory: FileCabinetFormData) => {
      if (!canManageConfig) {
        throw new Error('Only admins can create file cabinet categories.');
      }
      const { data, error } = await supabase
        .from('file_cabinet_settings')
        .insert([{
          ...newCategory,
          retention_period_days: newCategory.retention_period_days ? parseInt(newCategory.retention_period_days) : null,
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file-cabinet-settings'] });
      setIsModalOpen(false);
      resetForm();
      showSuccess('File cabinet category saved successfully');
    },
    onError: (mutationError) => {
      showError(mutationError);
    },
  });

  const updateCategory = useMutation({
    mutationFn: async (category: FileCabinetFormData & { id: string }) => {
      if (!canManageConfig) {
        throw new Error('Only admins can update file cabinet categories.');
      }
      const { data, error } = await supabase
        .from('file_cabinet_settings')
        .update({
          ...category,
          retention_period_days: category.retention_period_days ? parseInt(category.retention_period_days) : null,
        })
        .eq('id', category.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file-cabinet-settings'] });
      setIsModalOpen(false);
      resetForm();
      showSuccess('File cabinet category updated successfully');
    },
    onError: (mutationError) => {
      showError(mutationError);
    },
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      if (!canManageConfig) {
        throw new Error('Only admins can delete file cabinet categories.');
      }
      const { error } = await supabase
        .from('file_cabinet_settings')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file-cabinet-settings'] });
      showSuccess('File cabinet category deleted successfully');
    },
    onError: (mutationError) => {
      showError(mutationError);
    },
  });

  const resetForm = () => {
    setFormData({
      category_name: '',
      description: '',
      allowed_file_types: DEFAULT_FILE_TYPES,
      max_file_size_mb: 10,
      retention_period_days: '',
      requires_signature: false,
      is_active: true,
    });
    setEditingCategory(null);
  };

  const handleEdit = (category: FileCabinetSetting) => {
    setEditingCategory(category);
    setFormData({
      category_name: category.category_name,
      description: category.description || '',
      allowed_file_types: category.allowed_file_types,
      max_file_size_mb: category.max_file_size_mb,
      retention_period_days: category.retention_period_days?.toString() || '',
      requires_signature: category.requires_signature,
      is_active: category.is_active,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this category?')) {
      await deleteCategory.mutateAsync(id);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCategory) {
      await updateCategory.mutateAsync({ ...formData, id: editingCategory.id });
    } else {
      await createCategory.mutateAsync(formData);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleFileTypeChange = (fileType: string) => {
    setFormData(prev => ({
      ...prev,
      allowed_file_types: prev.allowed_file_types.includes(fileType)
        ? prev.allowed_file_types.filter(type => type !== fileType)
        : [...prev.allowed_file_types, fileType],
    }));
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!canManageConfig) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded-md p-6">
        You do not have permission to manage file cabinet settings.
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 rounded-md p-6">
        Failed to load file cabinet settings: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">File Cabinet Settings</h2>
        <button
          onClick={() => {
            resetForm();
            setIsModalOpen(true);
          }}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <Plus className="w-4 h-4 mr-2 inline-block" />
          Add Category
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      ) : categories.length === 0 ? (
        <div className="text-center py-4 text-gray-500 dark:text-gray-400">
          No document categories found. Add your first category to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map(category => (
            <div
              key={category.id}
              className={`bg-white dark:bg-dark-lighter rounded-lg shadow-sm border ${
                category.is_active
                  ? 'border-gray-200 dark:border-gray-700'
                  : 'border-red-200 dark:border-red-900'
              }`}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center">
                    <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-2" />
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                      {category.category_name}
                    </h3>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleEdit(category)}
                      className="p-1 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(category.id)}
                      className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {category.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                    {category.description}
                  </p>
                )}

                <div className="space-y-3 text-sm">
                  <div className="flex items-center">
                    <FileCheck className="w-4 h-4 text-gray-400 mr-2" />
                    <span className="text-gray-900 dark:text-white">
                      Allowed types: {category.allowed_file_types.join(', ')}
                    </span>
                  </div>

                  <div className="flex items-center">
                    <span className="text-gray-600 dark:text-gray-400">
                      Max size: {category.max_file_size_mb}MB
                    </span>
                  </div>

                  {category.retention_period_days && (
                    <div className="flex items-center">
                      <Clock className="w-4 h-4 text-gray-400 mr-2" />
                      <span className="text-gray-600 dark:text-gray-400">
                        Retention: {category.retention_period_days} days
                      </span>
                    </div>
                  )}

                  {category.requires_signature && (
                    <div className="flex items-center">
                      <Lock className="w-4 h-4 text-gray-400 mr-2" />
                      <span className="text-gray-600 dark:text-gray-400">
                        Requires signature
                      </span>
                    </div>
                  )}
                </div>

                {!category.is_active && (
                  <div className="mt-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                      Inactive
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
              {editingCategory ? 'Edit Category' : 'Add Category'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Category Name*
                </label>
                <input
                  type="text"
                  name="category_name"
                  required
                  value={formData.category_name}
                  onChange={handleInputChange}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  name="description"
                  rows={3}
                  value={formData.description}
                  onChange={handleInputChange}
                  className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Allowed File Types
                </label>
                <div className="space-y-2">
                  {DEFAULT_FILE_TYPES.map(fileType => (
                    <div key={fileType} className="flex items-center">
                      <input
                        type="checkbox"
                        id={`file-type-${fileType}`}
                        checked={formData.allowed_file_types.includes(fileType)}
                        onChange={() => handleFileTypeChange(fileType)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label
                        htmlFor={`file-type-${fileType}`}
                        className="ml-2 block text-sm text-gray-900 dark:text-gray-100"
                      >
                        {fileType}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Max File Size (MB)
                  </label>
                  <input
                    type="number"
                    name="max_file_size_mb"
                    min="1"
                    value={formData.max_file_size_mb}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Retention Period (Days)
                  </label>
                  <input
                    type="number"
                    name="retention_period_days"
                    min="0"
                    value={formData.retention_period_days}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="requires_signature"
                    id="requires_signature"
                    checked={formData.requires_signature}
                    onChange={handleInputChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="requires_signature" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                    Requires Signature
                  </label>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="is_active"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={handleInputChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                    Active
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    resetForm();
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  {editingCategory ? 'Update Category' : 'Create Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}