import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { 
  Search, 
  Edit2, 
  Trash2, 
  User,
  Mail,
  MapPin,
  Briefcase,
  Clock,
  Filter,
  Building,
  UserPlus,
  Eye
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Therapist } from '../types';
import TherapistModal from '../components/TherapistModal';
import { prepareFormData } from '../lib/validation';
import { showSuccess, showError } from '../lib/toast';

const Therapists = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTherapist, setSelectedTherapist] = useState<Therapist | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLocation, setFilterLocation] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterServiceLine, setFilterServiceLine] = useState('all');
  
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: therapists = [], isLoading } = useQuery({
    queryKey: ['therapists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('therapists')
        .select('*')
        .order('full_name');
      
      if (error) throw error;
      return data || [];
    },
  });

  const createTherapistMutation = useMutation({
    mutationFn: async (newTherapist: Partial<Therapist>) => {
      // Format data before submission
      const formattedTherapist = prepareFormData(newTherapist);
      
      // Prepare therapist data with proper formatting
      const parsedTherapist = {
        ...formattedTherapist,
        service_type: formattedTherapist.service_type,
        specialties: formattedTherapist.specialties,
        preferred_areas: formattedTherapist.preferred_areas,
        availability_hours: formattedTherapist.availability_hours || {},
        full_name: `${formattedTherapist.first_name} ${formattedTherapist.middle_name || ''} ${formattedTherapist.last_name}`.trim()
      };

      // Insert the new therapist
      const { data, error } = await supabase
        .from('therapists')
        .insert([parsedTherapist])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['therapists'] });
      setIsModalOpen(false);
      setSelectedTherapist(undefined);
      showSuccess('Therapist saved successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const updateTherapistMutation = useMutation({
    mutationFn: async (updatedTherapist: Partial<Therapist>) => {
      // Prepare therapist data with proper formatting
      const parsedTherapist = {
        ...updatedTherapist,
        service_type: updatedTherapist.service_type,
        specialties: updatedTherapist.specialties,
        preferred_areas: updatedTherapist.preferred_areas,
        availability_hours: updatedTherapist.availability_hours || {},
        full_name: `${updatedTherapist.first_name} ${updatedTherapist.middle_name || ''} ${updatedTherapist.last_name}`.trim()
      };

      // Update the therapist
      const { data, error } = await supabase
        .from('therapists')
        .update(parsedTherapist)
        .eq('id', selectedTherapist?.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['therapists'] });
      setIsModalOpen(false);
      setSelectedTherapist(undefined);
      showSuccess('Therapist saved successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const deleteTherapistMutation = useMutation({
    mutationFn: async (therapistId: string) => {
      const { error } = await supabase
        .from('therapists')
        .delete()
        .eq('id', therapistId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['therapists'] });
      showSuccess('Therapist deleted successfully');
    },
    onError: (error) => {
      showError(error);
    },
  });

  const handleCreateTherapist = () => {
    setSelectedTherapist(undefined);
    setIsModalOpen(true);
  };

  const handleEditTherapist = (therapist: Therapist) => {
    setSelectedTherapist(therapist);
    setIsModalOpen(true);
  };

  const handleViewTherapist = (therapist: Therapist) => {
    navigate(`/therapists/${therapist.id}`);
  };

  const handleDeleteTherapist = async (therapistId: string) => {
    if (window.confirm('Are you sure you want to delete this staff member?')) {
      await deleteTherapistMutation.mutateAsync(therapistId);
    }
  };

  const handleSubmit = async (data: Partial<Therapist>) => {
    try {
      if (selectedTherapist) {
        await updateTherapistMutation.mutateAsync(data);
      } else {
        await createTherapistMutation.mutateAsync(data);
      }
    } catch (error) {
      console.error('Error submitting therapist:', error);
    }
  };

  const handleOnboardTherapist = () => {
    navigate('/therapists/new');
  };

  const filteredTherapists = therapists.filter(therapist => {
    const matchesSearch = (
      (therapist.full_name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (therapist.email?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    );

    const matchesLocation = filterLocation === 'all' || therapist.service_type?.includes(filterLocation);
    const matchesServiceLine = filterServiceLine === 'all' || therapist.specialties?.includes(filterServiceLine);
    const matchesStatus = filterStatus === 'all'; // Add more status conditions as needed

    return matchesSearch && matchesLocation && matchesServiceLine && matchesStatus;
  });

  return (
    <div className="h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Staff Members</h1>
        <button
          onClick={handleOnboardTherapist}
          className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
        >
          <UserPlus className="w-5 h-5 mr-2 inline-block" />
          Onboard Therapist
        </button>
      </div>

      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow mb-6">
        <div className="p-4 border-b dark:border-gray-700">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-dark dark:text-gray-200"
              />
            </div>

            <select
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200 py-2 px-3"
            >
              <option value="all">All Locations</option>
              <option value="In clinic">Clinic</option>
              <option value="In home">Home</option>
              <option value="Telehealth">Telehealth</option>
            </select>

            <select
              value={filterServiceLine}
              onChange={(e) => setFilterServiceLine(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200 py-2 px-3"
            >
              <option value="all">All Service Lines</option>
              <option value="ABA Therapy">ABA Therapy</option>
              <option value="Speech Therapy">Speech Therapy</option>
              <option value="Occupational Therapy">Occupational Therapy</option>
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-dark dark:text-gray-200 py-2 px-3"
            >
              <option value="all">All Active</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Staff Member
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Title
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Facility
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Service Lines
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
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                    Loading staff members...
                  </td>
                </tr>
              ) : filteredTherapists.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500 dark:text-gray-400">
                    No staff members found
                  </td>
                </tr>
              ) : (
                filteredTherapists.map((therapist) => (
                  <tr key={therapist.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <User className="w-8 h-8 text-gray-400 bg-gray-100 dark:bg-gray-600 rounded-full p-1" />
                        <div className="ml-4">
                          <Link
                            to={`/therapists/${therapist.id}`}
                            className="text-sm font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400"
                          >
                            {therapist.full_name}
                          </Link>
                          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                            <Mail className="w-3 h-3 mr-1" />
                            {therapist.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 dark:text-gray-200">
                        <Briefcase className="w-4 h-4 inline-block mr-1" />
                        {therapist.title || 'Therapist'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 dark:text-gray-200">
                        <Building className="w-4 h-4 inline-block mr-1" />
                        {therapist.facility || 'Multiple Locations'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        {therapist.specialties?.map((specialty, index) => (
                          <span
                            key={index}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                          >
                            <MapPin className="w-3 h-3 mr-1" />
                            {specialty}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                        Active
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => handleViewTherapist(therapist)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                          title="View therapist details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEditTherapist(therapist)}
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                          title="Edit therapist"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteTherapist(therapist.id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                          title="Delete therapist"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <TherapistModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedTherapist(undefined);
          }}
          onSubmit={handleSubmit}
          therapist={selectedTherapist}
        />
      )}
    </div>
  );
};

export default Therapists;