import { z } from 'zod';
import type { Database } from './generated/database.types';

// Common validation patterns
const phonePattern = /^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/;

const preprocessTrim = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(value => (typeof value === 'string' ? value.trim() : value), schema);

const requiredStringSchema = (field: string) =>
  preprocessTrim(z.string().min(1, `${field} is required`));

const optionalStringSchema = preprocessTrim(z.string()).optional().transform(value => value ?? '');

const emailSchema = preprocessTrim(
  z.string().min(1, 'Email is required').email('Please enter a valid email address')
);

const optionalEmailSchema = preprocessTrim(
  z.union([z.literal(''), z.string().email('Please enter a valid email address')])
);

const phoneSchema = preprocessTrim(
  z.union([z.literal(''), z.string().regex(phonePattern, 'Please enter a valid phone number')])
);

const urlSchema = preprocessTrim(
  z.union([
    z.literal(''),
    z.string().url('Please enter a valid URL'),
    z
      .string()
      .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}/,
        'Please enter a valid URL or domain'
      ),
  ])
);

const zipCodeSchema = preprocessTrim(
  z.union([
    z.literal(''),
    z.string().regex(/^\d{5}(-\d{4})?$/, 'Please enter a valid ZIP code (12345 or 12345-6789)'),
  ])
);

const stateSchema = preprocessTrim(
  z.union([
    z.literal(''),
    z
      .string()
      .length(2, 'Please enter a valid 2-letter state code')
      .transform(val => val.toUpperCase()),
  ])
);

// Availability hours schema
const timeSchema = z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please enter time in HH:MM format');

const availabilityTimeSchema = z.preprocess(
  value => {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    }

    return value;
  },
  z.union([z.literal(null), timeSchema])
);

const dayAvailabilitySchema = z
  .object({
    start: availabilityTimeSchema,
    end: availabilityTimeSchema,
    start2: availabilityTimeSchema.optional(),
    end2: availabilityTimeSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const validateWindow = (
      startValue: string | null | undefined,
      endValue: string | null | undefined,
      startPath: 'start' | 'start2',
      endPath: 'end' | 'end2'
    ) => {
      if (startValue && endValue) {
        const start = new Date(`2000-01-01T${startValue}:00`);
        const end = new Date(`2000-01-01T${endValue}:00`);
        if (start >= end) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'End time must be after start time',
            path: [endPath],
          });
        }
      }

      if ((startValue && !endValue) || (!startValue && endValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Both start and end times are required for a day',
          path: startValue ? [endPath] : [startPath],
        });
      }
    };

    validateWindow(data.start, data.end, 'start', 'end');
    validateWindow(data.start2, data.end2, 'start2', 'end2');

    if (data.start && data.end && data.start2 && data.end2) {
      const firstStart = new Date(`2000-01-01T${data.start}:00`);
      const firstEnd = new Date(`2000-01-01T${data.end}:00`);
      const secondStart = new Date(`2000-01-01T${data.start2}:00`);
      const secondEnd = new Date(`2000-01-01T${data.end2}:00`);
      const hasOverlap = firstStart < secondEnd && secondStart < firstEnd;

      if (hasOverlap) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Availability time blocks cannot overlap',
          path: ['start2'],
        });
      }
    }
  });

const availabilityHoursSchema = z.record(dayAvailabilitySchema);

const insuranceInfoStringSchema = preprocessTrim(z.string()).superRefine((value, ctx) => {
  if (value.length === 0) {
    return;
  }

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Insurance information must be valid JSON',
      });
    }
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Insurance information must be valid JSON',
    });
  }
});

const insuranceInfoSchema = z.union([
  z.record(z.unknown()),
  insuranceInfoStringSchema,
]);

const nonNegativeNumber = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .min(0, `${label} must be 0 or greater`);

type ClientInsert = Database['public']['Tables']['clients']['Insert'];

const genderSchema = preprocessTrim(
  z.union([z.literal(''), z.enum(['Male', 'Female', 'Other'])])
);

const servicePreferenceSchema = z.array(preprocessTrim(z.string())).default([]);
const serviceContractProviderSchema = z.enum(['Private', 'IEHP', 'CalOptima']);
const serviceContractSchema = z.object({
  provider: serviceContractProviderSchema,
  units: nonNegativeNumber('Service contract units').default(0),
  cpt_codes: z.array(preprocessTrim(z.string())).default([]),
});

// Client validation schema
export const clientFormSchema = z
  .object({
    // Demographics
    first_name: requiredStringSchema('First name'),
    middle_name: optionalStringSchema,
    last_name: requiredStringSchema('Last name'),
    full_name: optionalStringSchema,
    email: optionalEmailSchema,
    phone: phoneSchema,
    date_of_birth: requiredStringSchema('Date of birth'),
    gender: genderSchema,

    // Address
    address_line1: optionalStringSchema,
    address_line2: optionalStringSchema,
    city: optionalStringSchema,
    state: stateSchema,
    zip_code: zipCodeSchema,

    // Client-specific fields
    client_id: optionalStringSchema,
    cin_number: optionalStringSchema,
    referral_source: optionalStringSchema,

    // Units
    one_to_one_units: nonNegativeNumber('1:1 units').default(0),
    supervision_units: nonNegativeNumber('Supervision units').default(0),
    parent_consult_units: nonNegativeNumber('Parent consult units').default(0),
    assessment_units: nonNegativeNumber('Assessment units').default(0),
    auth_units: nonNegativeNumber('Auth units').default(0),
    auth_start_date: optionalStringSchema,
    auth_end_date: optionalStringSchema,
    service_contracts: z.array(serviceContractSchema).default([]),

    // Service preferences
    service_preference: servicePreferenceSchema,

    // Availability
    availability_hours: availabilityHoursSchema.default({}),

    // Parent/Guardian info
    parent1_first_name: optionalStringSchema,
    parent1_last_name: optionalStringSchema,
    parent1_phone: phoneSchema,
    parent1_email: optionalEmailSchema,
    parent1_relationship: optionalStringSchema,
    parent2_first_name: optionalStringSchema,
    parent2_last_name: optionalStringSchema,
    parent2_phone: phoneSchema,
    parent2_email: optionalEmailSchema,
    parent2_relationship: optionalStringSchema,

    // Insurance
    insurance_info: insuranceInfoSchema.optional(),

    // Consent
    documents_consent: z
      .boolean({ invalid_type_error: 'Consent acknowledgement is required' })
      .refine(value => value === true, 'Consent acknowledgement is required'),
  })
  .superRefine((data, ctx) => {
    if (data.parent1_first_name && !data.parent1_last_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'If parent information is provided, both first and last names are required',
        path: ['parent1_last_name'],
      });
    }

    if (data.parent1_last_name && !data.parent1_first_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'If parent information is provided, both first and last names are required',
        path: ['parent1_first_name'],
      });
    }

    if (data.auth_start_date && data.auth_end_date) {
      const start = new Date(data.auth_start_date);
      const end = new Date(data.auth_end_date);
      if (start > end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Authorization end date must be on or after the start date',
          path: ['auth_end_date'],
        });
      }
    }
  });

export const clientSchema = clientFormSchema;

const jsonValueSchema = z.union([z.record(z.unknown()), z.array(z.unknown())]);

const availabilityPayloadSchema = z
  .record(
    z.object({
      start: z.string().nullable(),
      end: z.string().nullable(),
      start2: z.string().nullable().optional(),
      end2: z.string().nullable().optional(),
    })
  )
  .nullable();

export const clientPayloadSchema: z.ZodType<ClientInsert> = z
  .object({
    address_line1: z.string().nullable().optional(),
    address_line2: z.string().nullable().optional(),
    authorized_hours_per_month: z.number().nullable().optional(),
    availability_hours: availabilityPayloadSchema.optional(),
    avoid_rush_hour: z.boolean().nullable().optional(),
    cin_number: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    client_id: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    created_by: z.string().nullable().optional(),
    date_of_birth: z.string().nullable().optional(),
    daycare_after_school: z.boolean().nullable().optional(),
    diagnosis: z.array(z.string()).nullable().optional(),
    documents: jsonValueSchema.nullable().optional(),
    email: z.string().nullable().optional(),
    first_name: z.string().nullable().optional(),
    full_name: z.string().min(1, 'Full name is required'),
    gender: z.string().nullable().optional(),
    hours_provided_per_month: z.number().nullable().optional(),
    id: z.string().optional(),
    in_clinic: z.boolean().nullable().optional(),
    in_home: z.boolean().nullable().optional(),
    in_school: z.boolean().nullable().optional(),
    insurance_info: jsonValueSchema.nullable().optional(),
    last_name: z.string().nullable().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    max_travel_minutes: z.number().nullable().optional(),
    middle_name: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    one_to_one_units: z.number().nullable().optional(),
    organization_id: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    updated_by: z.string().nullable().optional(),
    parent_consult_units: z.number().nullable().optional(),
    assessment_units: z.number().nullable().optional(),
    auth_units: z.number().nullable().optional(),
    auth_start_date: z.string().nullable().optional(),
    auth_end_date: z.string().nullable().optional(),
    parent1_email: z.string().nullable().optional(),
    parent1_first_name: z.string().nullable().optional(),
    parent1_last_name: z.string().nullable().optional(),
    parent1_phone: z.string().nullable().optional(),
    parent1_relationship: z.string().nullable().optional(),
    parent2_email: z.string().nullable().optional(),
    parent2_first_name: z.string().nullable().optional(),
    parent2_last_name: z.string().nullable().optional(),
    parent2_phone: z.string().nullable().optional(),
    parent2_relationship: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    preferred_language: z.string().nullable().optional(),
    preferred_radius_km: z.number().nullable().optional(),
    preferred_session_time: z.array(z.string()).nullable().optional(),
    referral_source: z.string().nullable().optional(),
    service_preference: z.array(z.string()).nullable().optional(),
    state: z.string().nullable().optional(),
    status: z.string().optional(),
    supervision_units: z.number().nullable().optional(),
    unscheduled_hours: z.number().nullable().optional(),
    zip_code: z.string().nullable().optional(),
  })
  .strict();

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
export type ClientPayload = z.infer<typeof clientPayloadSchema>;
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