import { z } from 'zod';

// Common validation patterns
const emailSchema = z.string().email('Please enter a valid email address').or(z.literal(''));
const phoneSchema = z
  .string()
  .regex(/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/, 'Please enter a valid phone number')
  .or(z.literal(''));
const urlSchema = z
  .string()
  .url('Please enter a valid URL')
  .or(z.literal(''))
  .or(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}/, 'Please enter a valid URL or domain'));

// Utility schemas
const requiredStringSchema = (field: string) => 
  z.string().min(1, `${field} is required`).transform(val => val.trim());

const optionalStringSchema = z.string().optional().or(z.literal(''));

const zipCodeSchema = z
  .string()
  .regex(/^\d{5}(-\d{4})?$/, 'Please enter a valid ZIP code (12345 or 12345-6789)')
  .or(z.literal(''));

const stateSchema = z
  .string()
  .length(2, 'Please enter a valid 2-letter state code')
  .or(z.literal(''));

// Availability hours schema
const timeSchema = z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please enter time in HH:MM format');

const dayAvailabilitySchema = z.object({
  start: timeSchema,
  end: timeSchema,
}).refine(
  (data) => {
    const start = new Date(`2000-01-01T${data.start}:00`);
    const end = new Date(`2000-01-01T${data.end}:00`);
    return start < end;
  },
  {
    message: 'Start time must be before end time',
    path: ['end'],
  }
);

const availabilityHoursSchema = z.object({
  monday: dayAvailabilitySchema.optional(),
  tuesday: dayAvailabilitySchema.optional(),
  wednesday: dayAvailabilitySchema.optional(),
  thursday: dayAvailabilitySchema.optional(),
  friday: dayAvailabilitySchema.optional(),
  saturday: dayAvailabilitySchema.optional(),
  sunday: dayAvailabilitySchema.optional(),
});

// Client validation schema
export const clientSchema = z.object({
  // Demographics
  first_name: requiredStringSchema('First name'),
  middle_name: optionalStringSchema,
  last_name: requiredStringSchema('Last name'),
  full_name: optionalStringSchema,
  email: emailSchema,
  phone: phoneSchema,
  date_of_birth: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['Male', 'Female', 'Other', ''], { message: 'Please select a gender' }),
  
  // Address
  address_line1: optionalStringSchema,
  address_line2: optionalStringSchema,
  city: optionalStringSchema,
  state: stateSchema,
  zip_code: zipCodeSchema,
  
  // Client-specific fields
  client_id: optionalStringSchema,
  cin_number: optionalStringSchema,
  
  // Units
  one_to_one_units: z.number().min(0, 'Units must be non-negative').default(0),
  supervision_units: z.number().min(0, 'Units must be non-negative').default(0),
  parent_consult_units: z.number().min(0, 'Units must be non-negative').default(0),
  
  // Service preferences
  service_preference: z.array(z.string()).default([]),
  
  // Availability
  availability_hours: availabilityHoursSchema.optional(),
  
  // Parent/Guardian info
  parent1_first_name: optionalStringSchema,
  parent1_last_name: optionalStringSchema,
  parent1_phone: phoneSchema,
  parent1_email: emailSchema,
  parent1_relationship: optionalStringSchema,
  parent2_first_name: optionalStringSchema,
  parent2_last_name: optionalStringSchema,
  parent2_phone: phoneSchema,
  parent2_email: emailSchema,
  parent2_relationship: optionalStringSchema,
  
  // Insurance
  insurance_info: z.any().optional(),
}).refine(
  (data) => {
    // Cross-field validation: if parent info is provided, ensure consistency
    if (data.parent1_first_name && !data.parent1_last_name) {
      return false;
    }
    if (data.parent1_last_name && !data.parent1_first_name) {
      return false;
    }
    return true;
  },
  {
    message: 'If parent information is provided, both first and last names are required',
    path: ['parent1_last_name'],
  }
);

// Therapist validation schema
export const therapistSchema = z.object({
  // Basic info
  first_name: requiredStringSchema('First name'),
  middle_name: optionalStringSchema,
  last_name: requiredStringSchema('Last name'),
  full_name: optionalStringSchema,
  email: emailSchema,
  phone: phoneSchema,
  
  // Professional info
  title: z.enum(['BCBA', 'BCaBA', 'BT', 'RBT', 'Supervisor', 'Therapist', ''], { 
    message: 'Please select a valid title' 
  }),
  facility: optionalStringSchema,
  employee_type: z.enum(['Full-time', 'Part-time', 'Contract', 'Intern', ''], { 
    message: 'Please select an employee type' 
  }),
  staff_id: optionalStringSchema,
  supervisor: optionalStringSchema,
  status: z.enum(['active', 'inactive', 'pending']).default('active'),
  
  // Credentials
  npi_number: z.string().regex(/^\d{10}$/, 'NPI number must be 10 digits').or(z.literal('')),
  medicaid_id: optionalStringSchema,
  practitioner_id: optionalStringSchema,
  taxonomy_code: optionalStringSchema,
  rbt_number: optionalStringSchema,
  bcba_number: optionalStringSchema,
  
  // Location
  time_zone: z.string().default('UTC'),
  street: optionalStringSchema,
  city: optionalStringSchema,
  state: stateSchema,
  zip_code: zipCodeSchema,
  
  // Service info
  service_type: z.array(z.string()).default([]),
  specialties: z.array(z.string()).default([]),
  preferred_areas: z.array(z.string()).default([]),
  
  // Schedule
  weekly_hours_min: z.number().min(0, 'Minimum hours must be non-negative').default(0),
  weekly_hours_max: z.number().min(0, 'Maximum hours must be non-negative').default(40),
  availability_hours: availabilityHoursSchema.optional(),
}).refine(
  (data) => {
    // Cross-field validation: max hours >= min hours
    return data.weekly_hours_max >= data.weekly_hours_min;
  },
  {
    message: 'Maximum hours must be greater than or equal to minimum hours',
    path: ['weekly_hours_max'],
  }
);

// Session validation schema
export const sessionSchema = z.object({
  client_id: z.string().min(1, 'Client is required'),
  therapist_id: z.string().min(1, 'Therapist is required'),
  session_date: z.string().min(1, 'Session date is required'),
  start_time: timeSchema,
  end_time: timeSchema,
  session_type: z.enum(['Individual', 'Group', 'Assessment', 'Consultation'], {
    message: 'Please select a session type'
  }),
  location: optionalStringSchema,
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no-show']).default('scheduled'),
  notes: optionalStringSchema,
}).refine(
  (data) => {
    // Cross-field validation: end time after start time
    const start = new Date(`2000-01-01T${data.start_time}:00`);
    const end = new Date(`2000-01-01T${data.end_time}:00`);
    return start < end;
  },
  {
    message: 'End time must be after start time',
    path: ['end_time'],
  }
);

// Authorization validation schema
export const authorizationSchema = z.object({
  client_id: z.string().min(1, 'Client is required'),
  insurance_provider: z.string().min(1, 'Insurance provider is required'),
  authorization_number: z.string().min(1, 'Authorization number is required'),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
  units_authorized: z.number().min(1, 'Units authorized must be at least 1'),
  units_used: z.number().min(0, 'Units used must be non-negative').default(0),
  status: z.enum(['active', 'pending', 'expired', 'cancelled']).default('active'),
}).refine(
  (data) => {
    // Cross-field validation: end date after start date
    const start = new Date(data.start_date);
    const end = new Date(data.end_date);
    return start < end;
  },
  {
    message: 'End date must be after start date',
    path: ['end_date'],
  }
).refine(
  (data) => {
    // Cross-field validation: units used <= units authorized
    return data.units_used <= data.units_authorized;
  },
  {
    message: 'Units used cannot exceed units authorized',
    path: ['units_used'],
  }
);

// Company settings validation schema
export const companySettingsSchema = z.object({
  company_name: requiredStringSchema('Company name'),
  address: optionalStringSchema,
  phone: phoneSchema,
  email: emailSchema,
  website: urlSchema,
  logo_url: urlSchema,
  tax_id: optionalStringSchema,
  license_number: optionalStringSchema,
  default_session_duration: z.number().min(15, 'Session duration must be at least 15 minutes').default(60),
  default_break_duration: z.number().min(0, 'Break duration must be non-negative').default(15),
  business_hours: availabilityHoursSchema.optional(),
});

// User settings validation schema
export const userSettingsSchema = z.object({
  first_name: requiredStringSchema('First name'),
  last_name: requiredStringSchema('Last name'),
  email: emailSchema,
  phone: phoneSchema,
  time_zone: z.string().min(1, 'Time zone is required'),
  notification_preferences: z.object({
    email_notifications: z.boolean().default(true),
    sms_notifications: z.boolean().default(false),
    push_notifications: z.boolean().default(true),
    reminder_notifications: z.boolean().default(true),
  }).default({
    email_notifications: true,
    sms_notifications: false,
    push_notifications: true,
    reminder_notifications: true,
  }),
});

// Export types
export type ClientFormData = z.infer<typeof clientSchema>;
export type TherapistFormData = z.infer<typeof therapistSchema>;
export type SessionFormData = z.infer<typeof sessionSchema>;
export type AuthorizationFormData = z.infer<typeof authorizationSchema>;
export type CompanySettingsFormData = z.infer<typeof companySettingsSchema>;
export type UserSettingsFormData = z.infer<typeof userSettingsSchema>;

// Validation helper functions
export const validateClientData = (data: unknown) => clientSchema.safeParse(data);
export const validateTherapistData = (data: unknown) => therapistSchema.safeParse(data);
export const validateSessionData = (data: unknown) => sessionSchema.safeParse(data);
export const validateAuthorizationData = (data: unknown) => authorizationSchema.safeParse(data);
export const validateCompanySettingsData = (data: unknown) => companySettingsSchema.safeParse(data);
export const validateUserSettingsData = (data: unknown) => userSettingsSchema.safeParse(data); 