/**
 * Enhanced validation utilities for form inputs
 */
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

// Input sanitization functions
export const sanitizeString = (input: string): string => {
  if (!input) return '';
  return DOMPurify.sanitize(input.trim(), { ALLOWED_TAGS: [] });
};

export const sanitizeEmail = (email: string): string => {
  if (!email) return '';
  return sanitizeString(email).toLowerCase();
};

export const sanitizePhone = (phone: string): string => {
  if (!phone) return '';
  // Remove all non-digit characters except + for international numbers
  return phone.replace(/[^\d+]/g, '');
};

export const sanitizeUrl = (url: string): string => {
  if (!url) return '';
  const cleaned = sanitizeString(url);
  // Ensure protocol is present
  if (cleaned && !cleaned.match(/^https?:\/\//)) {
    return `https://${cleaned}`;
  }
  return cleaned;
};

// Enhanced validation functions with better error messages
export const isValidUrl = (url: string): boolean => {
  if (!url) return true;
  
  try {
    const urlToValidate = url.match(/^https?:\/\//) ? url : `https://${url}`;
    const urlObject = new URL(urlToValidate);
    
    // Additional validation for security
    if (urlObject.protocol !== 'https:' && urlObject.protocol !== 'http:') {
      return false;
    }
    
    // Check for valid domain format
    if (!urlObject.hostname || urlObject.hostname.length < 3) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
};

export const formatUrl = (url: string): string => {
  if (!url) return '';
  const sanitized = sanitizeUrl(url);
  return sanitized;
};

export const isValidEmail = (email: string): boolean => {
  if (!email) return true;
  
  // More comprehensive email validation
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (!emailRegex.test(email)) {
    return false;
  }
  
  // Additional checks
  if (email.length > 254) return false; // RFC 5321 limit
  if (email.split('@')[0].length > 64) return false; // Local part limit
  
  return true;
};

export const isValidPhone = (phone: string): boolean => {
  if (!phone) return true;
  
  // Enhanced phone validation supporting international formats
  const phoneRegex = /^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/;
  const internationalRegex = /^\+?[1-9]\d{1,14}$/; // E.164 format
  
  const cleaned = sanitizePhone(phone);
  
  return phoneRegex.test(phone) || internationalRegex.test(cleaned);
};

export const isValidZipCode = (zipCode: string): boolean => {
  if (!zipCode) return true;
  return /^\d{5}(-\d{4})?$/.test(zipCode);
};

export const isValidState = (state: string): boolean => {
  if (!state) return true;
  return /^[A-Z]{2}$/.test(state.toUpperCase());
};

export const isValidDate = (date: string): boolean => {
  if (!date) return true;
  const dateObj = new Date(date);
  return !isNaN(dateObj.getTime());
};

export const isValidTime = (time: string): boolean => {
  if (!time) return true;
  return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
};

export const isValidNPI = (npi: string): boolean => {
  if (!npi) return true;
  return /^\d{10}$/.test(npi);
};

// Enhanced form data preparation with sanitization
export const prepareFormData = <T extends Record<string, any>>(data: T): T => {
  const result = { ...data };
  
  // Sanitize string fields
  Object.keys(result).forEach(key => {
    if (typeof result[key] === 'string') {
      result[key] = sanitizeString(result[key]);
    }
  });
  
  // Handle empty strings for nullable fields
  const nullableFields = [
    'client_id', 'cin_number', 'phone', 'address_line1', 'address_line2', 
    'city', 'state', 'zip_code', 'parent1_first_name', 'parent1_last_name', 
    'parent1_phone', 'parent1_relationship', 'parent2_first_name', 
    'parent2_last_name', 'parent2_phone', 'parent2_relationship',
    'middle_name', 'staff_id', 'supervisor', 'npi_number', 'medicaid_id',
    'practitioner_id', 'taxonomy_code', 'rbt_number', 'bcba_number',
    'facility', 'street', 'title', 'employee_type'
  ];
  
  nullableFields.forEach(field => {
    if (field in result && (result[field] === '' || result[field] === undefined)) {
      result[field] = null;
    }
  });
  
  // Special handling for specific fields
  if ('email' in result && result.email) {
    result.email = sanitizeEmail(result.email);
  }
  
  if ('phone' in result && result.phone) {
    result.phone = sanitizePhone(result.phone);
  }
  
  if ('parent1_phone' in result && result.parent1_phone) {
    result.parent1_phone = sanitizePhone(result.parent1_phone);
  }
  
  if ('parent2_phone' in result && result.parent2_phone) {
    result.parent2_phone = sanitizePhone(result.parent2_phone);
  }
  
  if ('parent1_email' in result && result.parent1_email) {
    result.parent1_email = sanitizeEmail(result.parent1_email);
  }
  
  if ('parent2_email' in result && result.parent2_email) {
    result.parent2_email = sanitizeEmail(result.parent2_email);
  }
  
  // Format URL fields
  if ('website' in result && result.website) {
    result.website = formatUrl(result.website);
  }
  
  if ('logo_url' in result && result.logo_url) {
    result.logo_url = formatUrl(result.logo_url);
  }
  
  // Ensure arrays are properly formatted
  const arrayFields = [
    'service_preference', 'service_type', 'specialties', 'preferred_areas'
  ];
  
  arrayFields.forEach(field => {
    if (field in result) {
      result[field] = processArrayField(result[field]);
    }
  });
  
  // Handle JSON fields safely
  if ('insurance_info' in result && typeof result.insurance_info === 'string') {
    try {
      const parsed = JSON.parse(result.insurance_info);
      // Sanitize the parsed object
      result.insurance_info = sanitizeObject(parsed);
    } catch {
      result.insurance_info = {};
    }
  }
  
  // Handle availability_hours with validation
  if ('availability_hours' in result && typeof result.availability_hours === 'string') {
    try {
      const parsed = JSON.parse(result.availability_hours);
      result.availability_hours = sanitizeAvailabilityHours(parsed);
    } catch {
      // Default availability hours
      result.availability_hours = {
        monday: { start: "09:00", end: "17:00" },
        tuesday: { start: "09:00", end: "17:00" },
        wednesday: { start: "09:00", end: "17:00" },
        thursday: { start: "09:00", end: "17:00" },
        friday: { start: "09:00", end: "17:00" },
      };
    }
  }
  
  return result;
};

// Enhanced array field processing with sanitization
function processArrayField(field: unknown): string[] {
  if (typeof field === 'string') {
    return field
      .split(',')
      .map((s: string) => sanitizeString(s))
      .filter(Boolean);
  } else if (Array.isArray(field)) {
    return field
      .map(item => typeof item === 'string' ? sanitizeString(item) : String(item))
      .filter(Boolean);
  }
  return [];
}

// Sanitize nested objects
function sanitizeObject(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const sanitizedKey = sanitizeString(key);
    if (typeof value === 'string') {
      sanitized[sanitizedKey] = sanitizeString(value);
    } else if (typeof value === 'object') {
      sanitized[sanitizedKey] = sanitizeObject(value);
    } else {
      sanitized[sanitizedKey] = value;
    }
  }
  
  return sanitized;
}

// Sanitize availability hours
function sanitizeAvailabilityHours(hours: unknown): Record<string, { start: string; end: string }> {
  if (typeof hours !== 'object' || hours === null) {
    return {};
  }
  
  const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const sanitized: Record<string, { start: string; end: string }> = {};
  
  for (const day of validDays) {
    const dayData = (hours as Record<string, unknown>)[day];
    if (dayData && typeof dayData === 'object') {
      const { start, end } = dayData as { start: string; end: string };
      if (isValidTime(start) && isValidTime(end)) {
        sanitized[day] = { start: sanitizeString(start), end: sanitizeString(end) };
      }
    }
  }
  
  return sanitized;
}

// Validation result formatting
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  data?: unknown;
}

export const formatValidationErrors = (zodResult: z.SafeParseReturnType<unknown, unknown>): ValidationResult => {
  if (zodResult.success) {
    return {
      isValid: true,
      errors: {},
      data: zodResult.data
    };
  }
  
  const errors: Record<string, string> = {};
  
  zodResult.error.errors.forEach(error => {
    const path = error.path.join('.');
    errors[path] = error.message;
  });
  
  return {
    isValid: false,
    errors
  };
};

// Real-time validation helpers
export const createFieldValidator = (schema: z.ZodSchema) => {
  return (value: unknown) => {
    const result = schema.safeParse(value);
    return result.success ? null : result.error.errors[0]?.message || 'Invalid value';
  };
};

// Cross-field validation helpers
export const validateTimeRange = (startTime: string, endTime: string): string | null => {
  if (!startTime || !endTime) return null;
  
  if (!isValidTime(startTime) || !isValidTime(endTime)) {
    return 'Please enter valid times in HH:MM format';
  }
  
  const start = new Date(`2000-01-01T${startTime}:00`);
  const end = new Date(`2000-01-01T${endTime}:00`);
  
  if (start >= end) {
    return 'Start time must be before end time';
  }
  
  return null;
};

export const validateDateRange = (startDate: string, endDate: string): string | null => {
  if (!startDate || !endDate) return null;
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return 'Please enter valid dates';
  }
  
  if (start >= end) {
    return 'Start date must be before end date';
  }
  
  return null;
};

export const validateUnitsRange = (used: number, authorized: number): string | null => {
  if (used > authorized) {
    return 'Units used cannot exceed units authorized';
  }
  return null;
};

// Password validation for auth
export const validatePassword = (password: string): string | null => {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters long';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
  return null;
};

export const validatePasswordConfirmation = (password: string, confirmation: string): string | null => {
  if (!confirmation) return 'Password confirmation is required';
  if (password !== confirmation) return 'Passwords do not match';
  return null;
};