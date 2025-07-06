import React from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

interface ValidationSummaryProps {
  errors: Record<string, string>;
  warnings?: Record<string, string>;
  isValid: boolean;
  showSuccessState?: boolean;
  title?: string;
  onDismiss?: () => void;
  className?: string;
}

export const ValidationSummary: React.FC<ValidationSummaryProps> = ({
  errors,
  warnings = {},
  isValid,
  showSuccessState = false,
  title,
  onDismiss,
  className = '',
}) => {
  const errorCount = Object.keys(errors).length;
  const warningCount = Object.keys(warnings).length;

  // Don't render if there are no errors/warnings and not showing success state
  if (errorCount === 0 && warningCount === 0 && !showSuccessState) {
    return null;
  }

  // Don't render success state if there are errors
  if (showSuccessState && errorCount > 0) {
    return null;
  }

  const getFieldLabel = (fieldName: string): string => {
    // Convert camelCase/snake_case to readable labels
    return fieldName
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  };

  if (showSuccessState && isValid) {
    return (
      <div className={`
        flex items-center p-3 bg-green-50 dark:bg-green-900/20 
        border border-green-200 dark:border-green-800 rounded-md
        ${className}
      `}>
        <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
        <div className="ml-3">
          <p className="text-sm font-medium text-green-800 dark:text-green-200">
            {title || 'Form validation successful'}
          </p>
          <p className="text-sm text-green-700 dark:text-green-300">
            All fields are valid and ready for submission.
          </p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="ml-auto text-green-400 hover:text-green-600 dark:hover:text-green-300"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`
      p-4 border rounded-md
      ${errorCount > 0 
        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' 
        : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
      }
      ${className}
    `}>
      <div className="flex items-start">
        <div className="flex-shrink-0">
          {errorCount > 0 ? (
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          ) : (
            <Info className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
          )}
        </div>
        
        <div className="ml-3 flex-1">
          <h3 className={`
            text-sm font-medium
            ${errorCount > 0 
              ? 'text-red-800 dark:text-red-200' 
              : 'text-yellow-800 dark:text-yellow-200'
            }
          `}>
            {title || (errorCount > 0 
              ? `${errorCount} validation error${errorCount > 1 ? 's' : ''} found`
              : `${warningCount} warning${warningCount > 1 ? 's' : ''} found`
            )}
          </h3>
          
          {errorCount > 0 && (
            <div className="mt-2">
              <ul className="space-y-1 text-sm text-red-700 dark:text-red-300">
                {Object.entries(errors).map(([field, message]) => (
                  <li key={field} className="flex items-start">
                    <span className="font-medium">{getFieldLabel(field)}:</span>
                    <span className="ml-1">{message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {warningCount > 0 && (
            <div className="mt-2">
              <ul className="space-y-1 text-sm text-yellow-700 dark:text-yellow-300">
                {Object.entries(warnings).map(([field, message]) => (
                  <li key={field} className="flex items-start">
                    <span className="font-medium">{getFieldLabel(field)}:</span>
                    <span className="ml-1">{message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        
        {onDismiss && (
          <button
            onClick={onDismiss}
            className={`
              ml-3 text-sm
              ${errorCount > 0 
                ? 'text-red-400 hover:text-red-600 dark:hover:text-red-300' 
                : 'text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300'
              }
            `}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

interface ValidationTooltipProps {
  message: string;
  type?: 'error' | 'warning' | 'info';
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export const ValidationTooltip: React.FC<ValidationTooltipProps> = ({
  message,
  type = 'error',
  position = 'bottom',
  className = '',
}) => {
  const getPositionClasses = () => {
    switch (position) {
      case 'top':
        return 'bottom-full left-1/2 transform -translate-x-1/2 mb-2';
      case 'bottom':
        return 'top-full left-1/2 transform -translate-x-1/2 mt-2';
      case 'left':
        return 'right-full top-1/2 transform -translate-y-1/2 mr-2';
      case 'right':
        return 'left-full top-1/2 transform -translate-y-1/2 ml-2';
      default:
        return 'top-full left-1/2 transform -translate-x-1/2 mt-2';
    }
  };

  const getArrowClasses = () => {
    switch (position) {
      case 'top':
        return 'top-full left-1/2 transform -translate-x-1/2 border-t-4 border-l-4 border-r-4 border-b-0';
      case 'bottom':
        return 'bottom-full left-1/2 transform -translate-x-1/2 border-b-4 border-l-4 border-r-4 border-t-0';
      case 'left':
        return 'left-full top-1/2 transform -translate-y-1/2 border-l-4 border-t-4 border-b-4 border-r-0';
      case 'right':
        return 'right-full top-1/2 transform -translate-y-1/2 border-r-4 border-t-4 border-b-4 border-l-0';
      default:
        return 'bottom-full left-1/2 transform -translate-x-1/2 border-b-4 border-l-4 border-r-4 border-t-0';
    }
  };

  const getColorClasses = () => {
    switch (type) {
      case 'error':
        return {
          bg: 'bg-red-100 dark:bg-red-900 border-red-200 dark:border-red-800',
          text: 'text-red-800 dark:text-red-200',
          arrow: 'border-red-200 dark:border-red-800',
        };
      case 'warning':
        return {
          bg: 'bg-yellow-100 dark:bg-yellow-900 border-yellow-200 dark:border-yellow-800',
          text: 'text-yellow-800 dark:text-yellow-200',
          arrow: 'border-yellow-200 dark:border-yellow-800',
        };
      case 'info':
        return {
          bg: 'bg-blue-100 dark:bg-blue-900 border-blue-200 dark:border-blue-800',
          text: 'text-blue-800 dark:text-blue-200',
          arrow: 'border-blue-200 dark:border-blue-800',
        };
      default:
        return {
          bg: 'bg-gray-100 dark:bg-gray-900 border-gray-200 dark:border-gray-800',
          text: 'text-gray-800 dark:text-gray-200',
          arrow: 'border-gray-200 dark:border-gray-800',
        };
    }
  };

  const colors = getColorClasses();

  return (
    <div className={`absolute z-10 ${getPositionClasses()} ${className}`}>
      <div className={`
        px-3 py-2 text-sm rounded-md border shadow-lg max-w-xs
        ${colors.bg} ${colors.text}
      `}>
        {message}
      </div>
      <div className={`
        absolute w-0 h-0 border-4 border-transparent
        ${getArrowClasses()} ${colors.arrow}
      `} />
    </div>
  );
};

interface ValidationProgressProps {
  totalFields: number;
  validFields: number;
  errorFields: number;
  className?: string;
}

export const ValidationProgress: React.FC<ValidationProgressProps> = ({
  totalFields,
  validFields,
  errorFields,
  className = '',
}) => {
  const percentage = totalFields > 0 ? (validFields / totalFields) * 100 : 0;
  const hasErrors = errorFields > 0;

  return (
    <div className={`${className}`}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Form Completion
        </span>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {validFields}/{totalFields} fields complete
        </span>
      </div>
      
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div
          className={`
            h-2 rounded-full transition-all duration-300
            ${hasErrors ? 'bg-red-500' : percentage === 100 ? 'bg-green-500' : 'bg-blue-500'}
          `}
          style={{ width: `${percentage}%` }}
        />
      </div>
      
      {hasErrors && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">
          {errorFields} field{errorFields > 1 ? 's' : ''} need{errorFields === 1 ? 's' : ''} attention
        </p>
      )}
    </div>
  );
}; 