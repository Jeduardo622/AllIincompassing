import { createRequestClient } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { corsHeaders } from '../_shared/cors.ts'

interface DropdownData { therapists: Array<{ id: string; full_name: string; email: string; status: string; specialties?: string[] }>; clients: Array<{ id: string; full_name: string; email: string; status: string }>; locations: Array<{ id: string; name: string; type: string }>; serviceTypes: Array<{ id: string; name: string; description: string }>; sessionStatuses: Array<{ value: string; label: string; color: string }>; authorizationStatuses: Array<{ value: string; label: string; color: string }>; }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const db = createRequestClient(req);
    await getUserOrThrow(db);

    const url = new URL(req.url);
    const includeInactive = url.searchParams.get('include_inactive') === 'true';
    const dataTypes = url.searchParams.get('types')?.split(',') || ['all'];

    const dropdownData: Partial<DropdownData> = {};

    if (dataTypes.includes('therapists') || dataTypes.includes('all')) {
      let therapistQuery = db
        .from('therapists')
        .select('id, full_name, email, status, specialties')
        .is('deleted_at', null);
      if (!includeInactive) therapistQuery = therapistQuery.eq('status', 'active');
      const { data: therapists, error: therapistError } = await therapistQuery.order('full_name');
      if (therapistError) throw therapistError;
      dropdownData.therapists = therapists || [];
    }

    if (dataTypes.includes('clients') || dataTypes.includes('all')) {
      let clientQuery = db
        .from('clients')
        .select('id, full_name, email, status')
        .is('deleted_at', null);
      if (!includeInactive) clientQuery = clientQuery.eq('status', 'active');
      const { data: clients, error: clientError } = await clientQuery.order('full_name');
      if (clientError) throw clientError;
      dropdownData.clients = clients || [];
    }

    if (dataTypes.includes('locations') || dataTypes.includes('all')) {
      dropdownData.locations = [
        { id: 'clinic', name: 'In Clinic', type: 'physical' },
        { id: 'home', name: 'In Home', type: 'physical' },
        { id: 'telehealth', name: 'Telehealth', type: 'virtual' },
        { id: 'community', name: 'Community', type: 'physical' },
        { id: 'school', name: 'School', type: 'physical' }
      ];
    }

    if (dataTypes.includes('serviceTypes') || dataTypes.includes('all')) {
      dropdownData.serviceTypes = [
        { id: 'individual_therapy', name: 'Individual Therapy', description: 'One-on-one therapy session' },
        { id: 'group_therapy', name: 'Group Therapy', description: 'Group therapy session' },
        { id: 'family_therapy', name: 'Family Therapy', description: 'Family therapy session' },
        { id: 'consultation', name: 'Consultation', description: 'Consultation meeting' },
        { id: 'assessment', name: 'Assessment', description: 'Initial or ongoing assessment' },
        { id: 'training', name: 'Training', description: 'Skills training session' }
      ];
    }

    if (dataTypes.includes('sessionStatuses') || dataTypes.includes('all')) {
      dropdownData.sessionStatuses = [
        { value: 'scheduled', label: 'Scheduled', color: 'blue' },
        { value: 'in_progress', label: 'In Progress', color: 'yellow' },
        { value: 'completed', label: 'Completed', color: 'green' },
        { value: 'cancelled', label: 'Cancelled', color: 'red' },
        { value: 'no_show', label: 'No Show', color: 'orange' },
        { value: 'rescheduled', label: 'Rescheduled', color: 'purple' }
      ];
    }

    if (dataTypes.includes('authorizationStatuses') || dataTypes.includes('all')) {
      dropdownData.authorizationStatuses = [
        { value: 'pending', label: 'Pending', color: 'yellow' },
        { value: 'approved', label: 'Approved', color: 'green' },
        { value: 'denied', label: 'Denied', color: 'red' },
        { value: 'expired', label: 'Expired', color: 'gray' },
        { value: 'cancelled', label: 'Cancelled', color: 'red' }
      ];
    }

    return new Response(JSON.stringify({ success: true, data: dropdownData, cached: false, lastUpdated: new Date().toISOString() }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error('Dropdown data error:', error);
    return new Response(JSON.stringify({ success: false, error: (error as any).message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
