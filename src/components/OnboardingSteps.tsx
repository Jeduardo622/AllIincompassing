import React from 'react';
import { CheckCircle } from 'lucide-react';

interface OnboardingStepsProps {
  labels: string[];
  currentStep: number;
}

export function OnboardingSteps({ labels, currentStep }: OnboardingStepsProps) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        {labels.map((_, index) => {
          const step = index + 1;
          let stepClass = '';
          if (step < currentStep) {
            stepClass = 'bg-blue-600 text-white';
          } else if (step === currentStep) {
            stepClass =
              'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border-2 border-blue-600';
          } else {
            stepClass =
              'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400';
          }
          return (
            <div
              key={step}
              className={`flex items-center justify-center w-10 h-10 rounded-full ${stepClass}`}
            >
              {step < currentStep ? (
                <CheckCircle className="w-6 h-6" />
              ) : (
                <span>{step}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}
