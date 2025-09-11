import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, MapPin, Phone, Mail, Clock, Building2, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase'; 
import { prepareFormData } from '../../lib/validation';

interface Location {
  id: string;
  name: string;
  type: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
  is_active: boolean;
  operating_hours: {
    [key: string]: {
      start: string;
      end: string;
    };
  };
}

interface LocationFormData {
  name: string;
  type: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
  phone: string;
  fax: string;
  email: string;
  is_active: boolean;
  operating_hours: {
    [key: string]: {
      start: string;
      end: string;
    };
  };
}

const DEFAULT_OPERATING_HOURS = {
  monday: { start: '09:00', end: '17:00' },
  tuesday: { start: '09:00', end: '17:00' },
  wednesday: { start: '09:00', end: '17:00' },
  thursday: { start: '09:00', end: '17:00' },
  friday: { start: '09:00', end: '17:00' },
};

export default function LocationSettings() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [formData, setFormData] = useState<LocationFormData>({
    name: '',
    type: 'clinic',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    zip_code: '',
    phone: '',
    fax: '',
    email: '',
    is_active: true,
    operating_hours: DEFAULT_OPERATING_HOURS,
  });

  const queryClient = useQueryClient();

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .order('name');
      
      if (error) throw error;
      return data as Location[];
    },
  });

  const createLocation = useMutation({
    mutationFn: async (newLocation: LocationFormData) => {
      // Format data before submission
      const formattedLocation = prepareFormData(newLocation);
      
      const { data, error } = await supabase
        .from('locations')
        .insert([formattedLocation])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      setIsModalOpen(false);
      resetForm();
    },
  });

  const updateLocation = useMutation({
    mutationFn: async (location: LocationFormData & { id: string }) => {
      // Format data before submission
      const formattedLocation = prepareFormData(location);
      
      const { data, error } = await supabase
        .from('locations')
        .update(formattedLocation)
        .eq('id', formattedLocation.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      setIsModalOpen(false);
      resetForm();
    },
  });

  const deleteLocation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('locations')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'clinic',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      zip_code: '',
      phone: '',
      fax: '',
      email: '',
      is_active: true,
      operating_hours: DEFAULT_OPERATING_HOURS,
    });
    setEditingLocation(null);
  };

  const handleEdit = (location: Location) => {
    setEditingLocation(location);
    setFormData({
      name: location.name,
      type: location.type,
      address_line1: location.address_line1 || '',
      address_line2: location.address_line2 || '',
      city: location.city || '',
      state: location.state || '',
      zip_code: location.zip_code || '',
      phone: location.phone || '',
      fax: location.fax || '',
      email: location.email || '',
      is_active: location.is_active,
      operating_hours: location.operating_hours || DEFAULT_OPERATING_HOURS,
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this location?')) {
      await deleteLocation.mutateAsync(id);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingLocation) {
      await updateLocation.mutateAsync({ ...formData, id: editingLocation.id });
    } else {
      await createLocation.mutateAsync(formData);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleOperatingHoursChange = (day: string, field: 'start' | 'end', value: string) => {
    setFormData(prev => ({
      ...prev,
      operating_hours: {
        ...prev.operating_hours,
        [day]: {
          ...prev.operating_hours[day],
          [field]: value,
        },
      },
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white">Locations</h2>
        <button
          onClick={() => {
            resetForm();
            setIsModalOpen(true);
          }}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <Plus className="w-4 h-4 mr-2 inline-block" />
          Add Location
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      ) : locations.length === 0 ? (
        <div className="text-center py-4 text-gray-500 dark:text-gray-400">
          No locations found. Add your first location to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {locations.map(location => (
            <div
              key={location.id}
              className={`bg-white dark:bg-dark-lighter rounded-lg shadow-sm border ${
                location.is_active
                  ? 'border-gray-200 dark:border-gray-700'
                  : 'border-red-200 dark:border-red-900'
              }`}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center">
                    <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-2" />
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                      {location.name}
                    </h3>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleEdit(location)}
                      className="p-1 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(location.id)}
                      className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex items-start">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 mr-2" />
                    <div>
                      <div>{location.address_line1}</div>
                      {location.address_line2 && <div>{location.address_line2}</div>}
                      <div>
                        {location.city}, {location.state} {location.zip_code}
                      </div>
                    </div>
                  </div>

                  {location.phone && (
                    <div className="flex items-center">
                      <Phone className="w-4 h-4 text-gray-400 mr-2" />
                      <span>{location.phone}</span>
                    </div>
                  )}

                  {location.email && (
                    <div className="flex items-center">
                      <Mail className="w-4 h-4 text-gray-400 mr-2" />
                      <span>{location.email}</span>
                    </div>
                  )}

                  <div className="flex items-center">
                    <Clock className="w-4 h-4 text-gray-400 mr-2" />
                    <span className="capitalize">{location.type}</span>
                  </div>

                  {!location.is_active && (
                    <div className="mt-2">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                        Inactive
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                  Operating Hours
                </h4>
                <div className="space-y-1 text-sm">
                  {/* Fix: Check if operating_hours exists and is an object before using Object.entries */}
                  {location.operating_hours && typeof location.operating_hours === 'object' ? 
                    Object.entries(location.operating_hours).map(([day, hours]) => (
                      <div key={day} className="flex justify-between">
                        <span className="capitalize text-gray-500 dark:text-gray-400">
                          {day}
                        </span>
                        <span className="text-gray-900 dark:text-white">
                          {hours.start} - {hours.end}
                        </span>
                      </div>
                    )) : 
                    <div className="text-gray-500 dark:text-gray-400">
                      No operating hours defined
                    </div>
                  }
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-dark-lighter rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
              {editingLocation ? 'Edit Location' : 'Add Location'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Location Name*
                  </label>
                  <input
                    type="text"
                    name="name"
                    required
                    value={formData.name}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Type*
                  </label>
                  <select
                    name="type"
                    required
                    value={formData.type}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  >
                    <option value="clinic">Clinic</option>
                    <option value="home">Home</option>
                    <option value="telehealth">Telehealth</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Status
                  </label>
                  <select
                    name="is_active"
                    value={formData.is_active ? 'true' : 'false'}
                    onChange={handleInputChange}
                    className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  Address
                </h3>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Address Line 1
                    </label>
                    <input
                      type="text"
                      name="address_line1"
                      value={formData.address_line1}
                      onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Address Line 2
                    </label>
                    <input
                      type="text"
                      name="address_line2"
                      value={formData.address_line2}
                      onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        City
                      </label>
                      <input
                        type="text"
                        name="city"
                        value={formData.city}
                        onChange={handleInputChange}
                        className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        State
                      </label>
                      <input
                        type="text"
                        name="state"
                        value={formData.state}
                        onChange={handleInputChange}
                        className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        ZIP Code
                      </label>
                      <input
                        type="text"
                        name="zip_code"
                        value={formData.zip_code}
                        onChange={handleInputChange}
                        className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  Contact Information
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Phone
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Fax
                    </label>
                    <input
                      type="tel"
                      name="fax"
                      value={formData.fax}
                      onChange={handleInputChange}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email
                    </label>
                    <input
                      type="text" 
                      name="email" 
                      value={formData.email}
                      onChange={(e) => {
                        handleInputChange(e);
                      }}
                      className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Enter email address (e.g., contact@example.com)
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Enter email address (e.g., contact@example.com)
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  Operating Hours
                </h3>

                {Object.entries(formData.operating_hours).map(([day, hours]) => (
                  <div key={day} className="grid grid-cols-3 gap-4 items-center">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">
                      {day}
                    </div>
                    <div>
                      <input
                        type="time"
                        value={hours.start}
                        onChange={(e) => handleOperatingHoursChange(day, 'start', e.target.value)}
                        className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                      />
                    </div>
                    <div>
                      <input
                        type="time"
                        value={hours.end}
                        onChange={(e) => handleOperatingHoursChange(day, 'end', e.target.value)}
                        className="w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200"
                      />
                    </div>
                  </div>
                ))}
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
                  {editingLocation ? 'Update Location' : 'Create Location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}