import React, { forwardRef, useState, useEffect } from 'react';
import { Eye, EyeOff, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { useFieldValidation } from '../../lib/validationHooks';

interface ValidatedInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
  isRequired?: boolean;
  showValidationIcon?: boolean;
  realTimeValidation?: boolean;
  validator?: (value: string) => string | null;
  onValidationChange?: (isValid: boolean, error?: string) => void;
}

export const ValidatedInput = forwardRef<HTMLInputElement, ValidatedInputProps>(
  ({
    label,
    error,
    helperText,
    isRequired = false,
    showValidationIcon = true,
    realTimeValidation = false,
    validator,
    onValidationChange,
    className = '',
    type = 'text',
    value = '',
    onChange,
    ...props
  }, ref) => {
    const [inputValue, setInputValue] = useState(value);
    const [showPassword, setShowPassword] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    // Real-time validation
    const { 
      error: validationError, 
      isValidating, 
      isValid 
    } = useFieldValidation(
      inputValue,
      validator || (() => null),
      realTimeValidation ? 300 : 0
    );

    // Determine the actual error to display
    const displayError = error || (realTimeValidation ? validationError : null);
    const hasError = Boolean(displayError);
    const showSuccess = !hasError && isValid && inputValue && showValidationIcon;

    useEffect(() => {
      if (onValidationChange) {
        onValidationChange(isValid, validationError || undefined);
      }
    }, [isValid, validationError, onValidationChange]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setInputValue(newValue);
      onChange?.(e);
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      props.onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      props.onBlur?.(e);
    };

    const isPassword = type === 'password';
    const inputType = isPassword && showPassword ? 'text' : type;

    return (
      <div className="w-full">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {label}
          {isRequired && (
            <span className="text-red-500 ml-1" aria-label="required">*</span>
          )}
        </label>
        
        <div className="relative">
          <input
            ref={ref}
            type={inputType}
            value={inputValue}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            className={`
              w-full px-3 py-2 border rounded-md shadow-sm
              focus:outline-none focus:ring-2 focus:ring-offset-0
              dark:bg-dark dark:text-gray-200 dark:border-gray-600
              transition-colors duration-200
              ${hasError
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                : isFocused
                  ? 'border-blue-300 focus:ring-blue-500 focus:border-blue-500'
                  : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
              }
              ${isPassword || showValidationIcon ? 'pr-10' : ''}
              ${className}
            `}
            aria-invalid={hasError}
            aria-describedby={`${props.id}-error ${props.id}-helper`}
            {...props}
          />
          
          {/* Validation icons and password toggle */}
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">
            {isValidating && (
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
            )}
            
            {!isValidating && showValidationIcon && (
              <>
                {hasError && (
                  <AlertCircle className="w-4 h-4 text-red-500" />
                )}
                {showSuccess && (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                )}
              </>
            )}
            
            {isPassword && !isValidating && (
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="ml-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        </div>
        
        {/* Error message */}
        {displayError && (
          <p 
            id={`${props.id}-error`}
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {displayError}
          </p>
        )}
        
        {/* Helper text */}
        {helperText && !displayError && (
          <p 
            id={`${props.id}-helper`}
            className="mt-1 text-sm text-gray-500 dark:text-gray-400"
          >
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

ValidatedInput.displayName = 'ValidatedInput';

interface ValidatedSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  helperText?: string;
  isRequired?: boolean;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
}

export const ValidatedSelect = forwardRef<HTMLSelectElement, ValidatedSelectProps>(
  ({
    label,
    error,
    helperText,
    isRequired = false,
    options,
    placeholder = 'Select an option',
    className = '',
    value = '',
    onChange,
    ...props
  }, ref) => {
    const [isFocused, setIsFocused] = useState(false);
    const hasError = Boolean(error);

    const handleFocus = (e: React.FocusEvent<HTMLSelectElement>) => {
      setIsFocused(true);
      props.onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLSelectElement>) => {
      setIsFocused(false);
      props.onBlur?.(e);
    };

    return (
      <div className="w-full">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {label}
          {isRequired && (
            <span className="text-red-500 ml-1" aria-label="required">*</span>
          )}
        </label>
        
        <div className="relative">
          <select
            ref={ref}
            value={value}
            onChange={onChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            className={`
              w-full px-3 py-2 border rounded-md shadow-sm
              focus:outline-none focus:ring-2 focus:ring-offset-0
              dark:bg-dark dark:text-gray-200 dark:border-gray-600
              transition-colors duration-200
              ${hasError
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                : isFocused
                  ? 'border-blue-300 focus:ring-blue-500 focus:border-blue-500'
                  : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
              }
              ${className}
            `}
            aria-invalid={hasError}
            aria-describedby={`${props.id}-error ${props.id}-helper`}
            {...props}
          >
            <option value="" disabled>
              {placeholder}
            </option>
            {options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))}
          </select>
          
          {/* Error icon */}
          {hasError && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-8">
              <AlertCircle className="w-4 h-4 text-red-500" />
            </div>
          )}
        </div>
        
        {/* Error message */}
        {error && (
          <p 
            id={`${props.id}-error`}
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {error}
          </p>
        )}
        
        {/* Helper text */}
        {helperText && !error && (
          <p 
            id={`${props.id}-helper`}
            className="mt-1 text-sm text-gray-500 dark:text-gray-400"
          >
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

ValidatedSelect.displayName = 'ValidatedSelect';

interface ValidatedTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  helperText?: string;
  isRequired?: boolean;
  showCharacterCount?: boolean;
  maxLength?: number;
}

export const ValidatedTextarea = forwardRef<HTMLTextAreaElement, ValidatedTextareaProps>(
  ({
    label,
    error,
    helperText,
    isRequired = false,
    showCharacterCount = false,
    maxLength,
    className = '',
    value = '',
    onChange,
    ...props
  }, ref) => {
    const [isFocused, setIsFocused] = useState(false);
    const hasError = Boolean(error);
    const charCount = String(value).length;

    const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
      setIsFocused(true);
      props.onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
      setIsFocused(false);
      props.onBlur?.(e);
    };

    return (
      <div className="w-full">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {label}
          {isRequired && (
            <span className="text-red-500 ml-1" aria-label="required">*</span>
          )}
        </label>
        
        <div className="relative">
          <textarea
            ref={ref}
            value={value}
            onChange={onChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            maxLength={maxLength}
            className={`
              w-full px-3 py-2 border rounded-md shadow-sm
              focus:outline-none focus:ring-2 focus:ring-offset-0
              dark:bg-dark dark:text-gray-200 dark:border-gray-600
              transition-colors duration-200 resize-vertical
              ${hasError
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                : isFocused
                  ? 'border-blue-300 focus:ring-blue-500 focus:border-blue-500'
                  : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
              }
              ${className}
            `}
            aria-invalid={hasError}
            aria-describedby={`${props.id}-error ${props.id}-helper`}
            {...props}
          />
          
          {/* Error icon */}
          {hasError && (
            <div className="absolute top-2 right-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
            </div>
          )}
        </div>
        
        {/* Character count */}
        {showCharacterCount && maxLength && (
          <div className="mt-1 text-right">
            <span className={`text-sm ${
              charCount > maxLength * 0.9 
                ? 'text-red-500' 
                : 'text-gray-500 dark:text-gray-400'
            }`}>
              {charCount}/{maxLength}
            </span>
          </div>
        )}
        
        {/* Error message */}
        {error && (
          <p 
            id={`${props.id}-error`}
            className="mt-1 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {error}
          </p>
        )}
        
        {/* Helper text */}
        {helperText && !error && (
          <p 
            id={`${props.id}-helper`}
            className="mt-1 text-sm text-gray-500 dark:text-gray-400"
          >
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

ValidatedTextarea.displayName = 'ValidatedTextarea'; 