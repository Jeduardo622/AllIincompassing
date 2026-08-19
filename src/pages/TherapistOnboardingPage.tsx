import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { TherapistOnboarding } from '../components/TherapistOnboarding';

export function TherapistOnboardingPage() {
  const navigate = useNavigate();

  const handleComplete = () => {
    navigate('/therapists');
  };

  return (
    <div className="h-full">
      <div className="flex items-center mb-6">
        <button
          onClick={() => navigate('/therapists')}
          className="mr-4 min-h-11 min-w-11 rounded-full p-2.5 hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label="Back to therapists"
        >
          <ArrowLeft className="h-5 w-5 text-gray-500 dark:text-gray-400" />
        </button>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          New Therapist Onboarding
        </h1>
      </div>

      <TherapistOnboarding onComplete={handleComplete} />
    </div>
  );
}
