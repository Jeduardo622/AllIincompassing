import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ClientOnboarding } from '../components/ClientOnboarding';

export function ClientOnboardingPage() {
  const navigate = useNavigate();

  const handleComplete = () => {
    navigate('/clients');
  };

  return (
    <div className="h-full">
      <div className="flex items-center mb-6">
        <button
          onClick={() => navigate('/clients')}
          className="mr-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <ArrowLeft className="h-5 w-5 text-gray-500 dark:text-gray-400" />
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          New Client Onboarding
        </h1>
      </div>

      <ClientOnboarding onComplete={handleComplete} />
    </div>
  );
}
