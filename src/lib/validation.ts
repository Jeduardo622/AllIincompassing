/**
 * Validation utilities for form inputs
 */

/**
 * Validates if a string is a valid URL
 * Accepts URLs with or without protocol
 */
export const isValidUrl = (url: string): boolean => {
  if (!url) return true;
  
  // If URL doesn't have a protocol, add https:// for validation
  const urlToValidate = url.match(/^https?:\/\//) ? url : `https://${url}`;
  
  try {
    new URL(urlToValidate);
    return true;
  } catch (e) {
    return false;
  }
};

/**
 * Formats a URL by ensuring it has a protocol
 */
export const formatUrl = (url: string): string => {
  if (!url) return '';
  return url.match(/^https?:\/\//) ? url : `https://${url}`;
};

/**
 * Validates if a string is a valid email address
 */
export const isValidEmail = (email: string): boolean => {
  if (!email) return true;
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email);
};

/**
 * Validates if a string is a valid phone number
 * Accepts various formats
 */
export const isValidPhone = (phone: string): boolean => {
  if (!phone) return true;
  return /^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/im.test(phone);
};

/**
 * Prepares form data for submission by formatting URLs
 */
export const prepareFormData = <T extends Record<string, any>>(data: T): T => {
  const result = { ...data };
  
  // Handle empty strings for nullable fields
  if ('client_id' in result && result.client_id === '') {
    result.client_id = null;
  }
  
  // Format URL fields if they exist
  if ('website' in result && result.website) {
    result.website = formatUrl(result.website);
  }
  
  if ('logo_url' in result && result.logo_url) {
    result.logo_url = formatUrl(result.logo_url);
  }
  
  // Ensure arrays are properly formatted
  if ('service_preference' in result) {
    result.service_preference = processArrayField(result.service_preference);
  }
  
  if ('service_type' in result) {
    result.service_type = processArrayField(result.service_type);
  }
  
  if ('specialties' in result) {
    result.specialties = processArrayField(result.specialties);
  }

  // Handle empty strings for client fields
  const nullableFields = [
    'cin_number', 'phone', 'address_line1', 'city', 'state', 'zip_code',
    'parent1_first_name', 'parent1_last_name', 'parent1_phone', 'parent1_relationship'
  ];
  
  nullableFields.forEach(field => {
    if (field in result && (result[field] === '' || result[field] === undefined)) {
      result[field] = null;
    }
  });
  
  if ('preferred_areas' in result) {
    result.preferred_areas = processArrayField(result.preferred_areas);
  }
  
  // Handle JSON fields
  if ('insurance_info' in result && typeof result.insurance_info === 'string') {
    try {
      result.insurance_info = JSON.parse(result.insurance_info);
    } catch (e) {
      result.insurance_info = {};
    }
  }
  
  // Handle availability_hours
  if ('availability_hours' in result && typeof result.availability_hours === 'string') {
    try {
      result.availability_hours = JSON.parse(result.availability_hours);
    } catch (e) {
      // Default availability hours
      result.availability_hours = {
        monday: { start: "06:00", end: "21:00" },
        tuesday: { start: "06:00", end: "21:00" },
        wednesday: { start: "06:00", end: "21:00" },
        thursday: { start: "06:00", end: "21:00" },
        friday: { start: "06:00", end: "21:00" },
        saturday: { start: "06:00", end: "21:00" }
      };
    }
  }
  
  return result;
};

/**
 * Process array fields to ensure they are properly formatted
 * Returns an empty array instead of null if the field is empty
 */
function processArrayField(field: unknown): string[] {
  if (typeof field === 'string') {
    const items = field
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    return items.length > 0 ? items : [];
  } else if (Array.isArray(field)) {
    return field.length > 0 ? field : [];
  }
  return [];
}