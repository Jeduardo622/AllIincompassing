import { useCallback, useEffect, useState } from 'react';
import { useForm, UseFormReturn, FieldValues, Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { 
  validateTimeRange, 
  validateDateRange, 
  validateUnitsRange,
  formatValidationErrors
} from './validation';

// Hook for form validation with Zod schema
export function useValidatedForm<T extends FieldValues>(
  schema: z.ZodSchema<T>,
  defaultValues?: Partial<T>
): UseFormReturn<T> & { isValid: boolean } {
  const form = useForm<T>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues as Partial<T>,
    mode: 'onChange',
  });

  const isValid = form.formState.isValid;

  return {
    ...form,
    isValid,
  };
}

// Hook for real-time field validation
export function useFieldValidation<T>(
  value: T,
  validator: (value: T) => string | null,
  debounceMs: number = 300
) {
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const validateField = useCallback(
    async (val: T) => {
      setIsValidating(true);
      try {
        const result = validator(val);
        setError(result);
      } catch {
        setError('Validation error occurred');
      } finally {
        setIsValidating(false);
      }
    },
    [validator]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      validateField(value);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [value, validateField, debounceMs]);

  return {
    error,
    isValidating,
    isValid: !error,
  };
}

// Hook for cross-field validation
export function useCrossFieldValidation<T extends FieldValues>(
  form: UseFormReturn<T>,
  validationRules: Array<{
    fields: Path<T>[];
    validator: (values: Partial<T>) => string | null;
    errorField: Path<T>;
  }>
) {
  const watchedFields = form.watch();

  useEffect(() => {
    validationRules.forEach(({ fields, validator, errorField }) => {
      const fieldValues = fields.reduce((acc, field) => {
        acc[field] = watchedFields[field];
        return acc;
      }, {} as Partial<T>);

      const error = validator(fieldValues);
      
      if (error) {
        form.setError(errorField, { message: error });
      } else {
        form.clearErrors(errorField);
      }
    });
  }, [watchedFields, validationRules, form]);
}

// Hook for availability hours validation
export function useAvailabilityValidation() {
  const validateAvailability = useCallback((availability: Record<string, { start: string; end: string }>) => {
    const errors: Record<string, string> = {};
    
    Object.entries(availability).forEach(([day, hours]) => {
      if (hours && hours.start && hours.end) {
        const error = validateTimeRange(hours.start, hours.end);
        if (error) {
          errors[`${day}.end`] = error;
        }
      }
    });

    return Object.keys(errors).length > 0 ? errors : null;
  }, []);

  return { validateAvailability };
}

// Hook for session validation
export function useSessionValidation() {
  const validateSession = useCallback((data: {
    start_time?: string;
    end_time?: string;
    session_date?: string;
  }) => {
    const errors: Record<string, string> = {};

    // Time validation
    if (data.start_time && data.end_time) {
      const timeError = validateTimeRange(data.start_time, data.end_time);
      if (timeError) {
        errors.end_time = timeError;
      }
    }

    // Date validation (not in the past)
    if (data.session_date) {
      const sessionDate = new Date(data.session_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (sessionDate < today) {
        errors.session_date = 'Session date cannot be in the past';
      }
    }

    return Object.keys(errors).length > 0 ? errors : null;
  }, []);

  return { validateSession };
}

// Hook for authorization validation
export function useAuthorizationValidation() {
  const validateAuthorization = useCallback((data: {
    start_date?: string;
    end_date?: string;
    units_used?: number;
    units_authorized?: number;
  }) => {
    const errors: Record<string, string> = {};

    // Date range validation
    if (data.start_date && data.end_date) {
      const dateError = validateDateRange(data.start_date, data.end_date);
      if (dateError) {
        errors.end_date = dateError;
      }
    }

    // Units validation
    if (data.units_used !== undefined && data.units_authorized !== undefined) {
      const unitsError = validateUnitsRange(data.units_used, data.units_authorized);
      if (unitsError) {
        errors.units_used = unitsError;
      }
    }

    return Object.keys(errors).length > 0 ? errors : null;
  }, []);

  return { validateAuthorization };
}

// Hook for form submission with validation
export function useValidatedSubmission<T extends FieldValues>(
  form: UseFormReturn<T>,
  onSubmit: (data: T) => Promise<void>,
  schema?: z.ZodSchema<T>
) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (data: T) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Additional validation if schema provided
      if (schema) {
        const result = schema.safeParse(data);
        if (!result.success) {
          const validationResult = formatValidationErrors(result);
          
          // Set form errors
          Object.entries(validationResult.errors).forEach(([field, message]) => {
            form.setError(field as Path<T>, { message });
          });
          
          setSubmitError('Please fix the validation errors before submitting');
          return;
        }
      }

      await onSubmit(data);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  }, [form, onSubmit, schema]);

  return {
    handleSubmit: form.handleSubmit(handleSubmit),
    isSubmitting,
    submitError,
  };
}

// Hook for form state management
export function useFormState<T extends FieldValues>(form: UseFormReturn<T>) {
  const [isDirty, setIsDirty] = useState(false);
  const [hasErrors, setHasErrors] = useState(false);

  useEffect(() => {
    setIsDirty(form.formState.isDirty);
    setHasErrors(Object.keys(form.formState.errors).length > 0);
  }, [form.formState.isDirty, form.formState.errors]);

  const resetForm = useCallback(() => {
    form.reset();
    setIsDirty(false);
    setHasErrors(false);
  }, [form]);

  return {
    isDirty,
    hasErrors,
    isValid: form.formState.isValid,
    isSubmitting: form.formState.isSubmitting,
    resetForm,
  };
}

// Hook for conditional validation
export function useConditionalValidation<T extends FieldValues>(
  form: UseFormReturn<T>,
  conditions: Array<{
    condition: (values: T) => boolean;
    fields: Path<T>[];
    validator: z.ZodSchema;
  }>
) {
  const watchedValues = form.watch();

  useEffect(() => {
    conditions.forEach(({ condition, fields, validator }) => {
      if (condition(watchedValues)) {
        // Apply validation to required fields
        fields.forEach(field => {
          const value = watchedValues[field];
          const result = validator.safeParse(value);
          
          if (!result.success) {
            form.setError(field, { 
              message: result.error.errors[0]?.message || 'Invalid value' 
            });
          } else {
            form.clearErrors(field);
          }
        });
      } else {
        // Clear validation errors for fields that are no longer required
        fields.forEach(field => {
          form.clearErrors(field);
        });
      }
    });
  }, [watchedValues, conditions, form]);
}

// Hook for async validation
export function useAsyncValidation<T>(
  value: T,
  asyncValidator: (value: T) => Promise<string | null>,
  debounceMs: number = 500
) {
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (value) {
        setIsValidating(true);
        try {
          const result = await asyncValidator(value);
          setError(result);
        } catch {
          setError('Validation error occurred');
        } finally {
          setIsValidating(false);
        }
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [value, asyncValidator, debounceMs]);

  return {
    error,
    isValidating,
    isValid: !error,
  };
}

// Hook for validation summary
export function useValidationSummary<T extends FieldValues>(form: UseFormReturn<T>) {
  const [summary, setSummary] = useState<{
    errorCount: number;
    warningCount: number;
    errors: Record<string, string>;
    isValid: boolean;
  }>({
    errorCount: 0,
    warningCount: 0,
    errors: {},
    isValid: true,
  });

  useEffect(() => {
    const errors = form.formState.errors;
    const errorEntries = Object.entries(errors);
    
    setSummary({
      errorCount: errorEntries.length,
      warningCount: 0, // Can be extended for warnings
      errors: errorEntries.reduce((acc, [key, error]) => {
        acc[key] = error.message || 'Invalid value';
        return acc;
      }, {} as Record<string, string>),
      isValid: errorEntries.length === 0,
    });
  }, [form.formState.errors]);

  return summary;
} 