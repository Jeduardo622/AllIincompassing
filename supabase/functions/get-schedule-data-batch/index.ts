import { z } from 'zod'
import { createRequestClient } from "../_shared/database.ts";
import { getUserOrThrow } from "../_shared/auth.ts";
import { corsHeaders } from '../_shared/cors.ts'
import { errorEnvelope, getRequestId, rateLimit, IsoDateSchema } from '../lib/http/error.ts'

const MAX_BATCH_SIZE = 100

interface BatchScheduleRequest { start_date: string; end_date: string; therapist_ids?: string[]; client_ids?: string[]; batch_size?: number; offset?: number; include_availability?: boolean; include_conflicts?: boolean; }
interface ScheduleBatch { sessions: Array<{ id: string; start_time: string; end_time: string; status: string; location_type: string; therapist: { id: string; full_name: string; email: string; }; client: { id: string; full_name: string; email: string; }; authorization?: { id: string; sessions_remaining: number; end_date: string; }; }>; availability?: Array<{ therapist_id: string; therapist_name: string; date: string; available_slots: Array<{ start_time: string; end_time: string; duration_minutes: number; }>; }>; conflicts?: Array<{ type: 'double_booking' | 'insufficient_break' | 'authorization_expired'; description: string; session_ids: string[]; suggested_resolution: string; }>; pagination: { total_records: number; batch_size: number; current_offset: number; has_more: boolean; next_offset?: number; }; performance: { query_time_ms: number; cache_hit: boolean; }; }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const startTime = Date.now();
    const requestId = getRequestId(req);

    const db = createRequestClient(req);
    await getUserOrThrow(db);

    const { data: organizationId, error: organizationError } = await db.rpc('current_user_organization_id')
    if (organizationError) {
      console.error('Failed to resolve caller organization:', organizationError)
      return errorEnvelope({ requestId, code: 'internal_error', message: 'Could not resolve organization', status: 500 })
    }
    if (!organizationId) return errorEnvelope({ requestId, code: 'forbidden', message: 'Organization context required', status: 403 })

    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const rl = rateLimit(`schedule:${ip}`, 60, 60_000);
    if (!rl.allowed) return errorEnvelope({ requestId, code: 'rate_limited', message: 'Too many requests', status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } });

    let requestData: BatchScheduleRequest;
    if (req.method === 'POST') requestData = await req.json();
    else {
      const url = new URL(req.url);
      requestData = { start_date: url.searchParams.get('start_date') || new Date().toISOString().split('T')[0], end_date: url.searchParams.get('end_date') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], therapist_ids: url.searchParams.get('therapist_ids')?.split(','), client_ids: url.searchParams.get('client_ids')?.split(','), batch_size: parseInt(url.searchParams.get('batch_size') || '100'), offset: parseInt(url.searchParams.get('offset') || '0'), include_availability: url.searchParams.get('include_availability') === 'true', include_conflicts: url.searchParams.get('include_conflicts') === 'true' };
    }

    const BodySchema = z.object({ start_date: IsoDateSchema, end_date: IsoDateSchema, therapist_ids: z.array(z.string()).optional(), client_ids: z.array(z.string()).optional(), batch_size: z.number().int().positive().max(MAX_BATCH_SIZE).optional().default(MAX_BATCH_SIZE), offset: z.number().int().nonnegative().optional().default(0), include_availability: z.boolean().optional().default(false), include_conflicts: z.boolean().optional().default(false) });
    const parsedBody = BodySchema.safeParse(requestData);
    if (!parsedBody.success) return errorEnvelope({ requestId, code: 'invalid_body', message: 'Invalid request body', status: 400 });
    const { start_date, end_date, therapist_ids, client_ids, batch_size, offset, include_availability, include_conflicts } = parsedBody.data;

    const sanitizedTherapistIds = therapist_ids?.filter(id => typeof id === 'string' && id.trim().length > 0) ?? []
    const sanitizedClientIds = client_ids?.filter(id => typeof id === 'string' && id.trim().length > 0) ?? []

    let allowedTherapistIds = sanitizedTherapistIds
    if (sanitizedTherapistIds.length > 0) {
      const { data: therapistMatches, error: therapistError } = await db
        .from('therapists')
        .select('id')
        .eq('organization_id', organizationId)
        .in('id', sanitizedTherapistIds)
      if (therapistError) throw therapistError
      const accessibleTherapistIds = (therapistMatches ?? []).map(match => match.id)
      const unauthorizedTherapists = sanitizedTherapistIds.filter(id => !accessibleTherapistIds.includes(id))
      if (unauthorizedTherapists.length > 0) return errorEnvelope({ requestId, code: 'forbidden', message: 'Access denied for therapist scope', status: 403 })
      allowedTherapistIds = accessibleTherapistIds
    }

    let allowedClientIds = sanitizedClientIds
    if (sanitizedClientIds.length > 0) {
      const { data: clientMatches, error: clientError } = await db
        .from('clients')
        .select('id')
        .eq('organization_id', organizationId)
        .in('id', sanitizedClientIds)
      if (clientError) throw clientError
      const accessibleClientIds = (clientMatches ?? []).map(match => match.id)
      const unauthorizedClients = sanitizedClientIds.filter(id => !accessibleClientIds.includes(id))
      if (unauthorizedClients.length > 0) return errorEnvelope({ requestId, code: 'forbidden', message: 'Access denied for client scope', status: 403 })
      allowedClientIds = accessibleClientIds
    }

    const effectiveBatchSize = Math.min(batch_size, MAX_BATCH_SIZE)

    let sessionQuery = db
      .from('sessions')
      .select('id, start_time, end_time, status, location_type, therapist_id, client_id, authorization_id, therapist:therapists!inner(id, full_name, email), client:clients!inner(id, full_name, email), authorization:authorizations(id, authorized_sessions, sessions_used, end_date)', { count: 'exact' })
      .eq('organization_id', organizationId)
      .gte('start_time', `${start_date}T00:00:00`).lte('start_time', `${end_date}T23:59:59`).order('start_time', { ascending: true });

    if (allowedTherapistIds.length > 0) sessionQuery = sessionQuery.in('therapist_id', allowedTherapistIds)
    if (allowedClientIds.length > 0) sessionQuery = sessionQuery.in('client_id', allowedClientIds)

    sessionQuery = sessionQuery.range(offset, offset + effectiveBatchSize - 1);

    const { data: sessions, error: sessionError, count } = await sessionQuery; if (sessionError) throw sessionError;

    const formattedSessions = sessions?.map(session => ({ id: session.id, start_time: session.start_time, end_time: session.end_time, status: session.status, location_type: session.location_type, therapist: session.therapist, client: session.client, authorization: session.authorization ? { id: session.authorization.id, sessions_remaining: (session.authorization.authorized_sessions || 0) - (session.authorization.sessions_used || 0), end_date: session.authorization.end_date } : undefined })) || [];

    let availability: any[] = [];
    if (include_availability && allowedTherapistIds.length > 0) {
      const { data: therapists } = await db
        .from('therapists')
        .select('id, full_name, availability_hours')
        .eq('organization_id', organizationId)
        .in('id', allowedTherapistIds.slice(0, effectiveBatchSize))
        .is('deleted_at', null);
      availability = therapists?.map(therapist => {
        const availableSlots: Array<{ start_time: string; end_time: string; duration_minutes: number }>= [];
        const currentDate = new Date(start_date);
        const endDate = new Date(end_date);
        while (currentDate <= endDate) {
          const dayOfWeek = currentDate.toLocaleDateString('en-US', { weekday: 'lowercase' });
          // @ts-expect-error - availability_hours is a JSONB column without a typed shape
          const dayAvailability = (therapist as any).availability_hours?.[dayOfWeek];
          if (dayAvailability?.start && dayAvailability?.end) {
            const startHour = parseInt(dayAvailability.start.split(':')[0]);
            const endHour = parseInt(dayAvailability.end.split(':')[0]);
            for (let hour = startHour; hour < endHour; hour++) {
              availableSlots.push({ start_time: `${currentDate.toISOString().split('T')[0]}T${hour.toString().padStart(2, '0')}:00:00`, end_time: `${currentDate.toISOString().split('T')[0]}T${(hour + 1).toString().padStart(2, '0')}:00:00`, duration_minutes: 60 });
            }
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
        return { therapist_id: therapist.id, therapist_name: therapist.full_name, date: start_date, available_slots: availableSlots.slice(0, 10) };
      }) || [];
    }

    const conflicts: any[] = [];
    if (include_conflicts && formattedSessions.length > 0) {
      const therapistSessions = formattedSessions.reduce((acc, session) => { const therapistId = (session as any).therapist.id; if (!acc[therapistId]) (acc[therapistId] = [] as any[]); (acc[therapistId] as any[]).push(session); return acc; }, {} as Record<string, any[]>);
      Object.entries(therapistSessions).forEach(([, sessions]) => {
        for (let i = 0; i < (sessions as any[]).length; i++) {
          for (let j = i + 1; j < (sessions as any[]).length; j++) {
            const session1: any = (sessions as any[])[i];
            const session2: any = (sessions as any[])[j];
            const start1 = new Date(session1.start_time); const end1 = new Date(session1.end_time);
            const start2 = new Date(session2.start_time); const end2 = new Date(session2.end_time);
            if (start1 < end2 && start2 < end1) {
              conflicts.push({ type: 'double_booking', description: `Therapist ${session1.therapist.full_name} has overlapping sessions`, session_ids: [session1.id, session2.id], suggested_resolution: 'Reschedule one of the conflicting sessions' });
            }
          }
        }
      });
      formattedSessions.forEach((session: any) => {
        if (session.authorization && session.authorization.end_date) {
          const authEndDate = new Date(session.authorization.end_date);
          const sessionDate = new Date(session.start_time);
          if (sessionDate > authEndDate) conflicts.push({ type: 'authorization_expired', description: `Session scheduled after authorization expires`, session_ids: [session.id], suggested_resolution: 'Renew authorization or reschedule session' });
        }
      });
    }

    const totalRecords = count || 0;
    const hasMore = offset + effectiveBatchSize < totalRecords;
    const nextOffset = hasMore ? offset + effectiveBatchSize : undefined;

    const truncatedAvailability = include_availability ? availability.slice(0, effectiveBatchSize) : undefined
    const truncatedConflicts = include_conflicts ? conflicts.slice(0, effectiveBatchSize) : undefined

    const response: ScheduleBatch = { sessions: formattedSessions, ...(include_availability && { availability: truncatedAvailability }), ...(include_conflicts && { conflicts: truncatedConflicts }), pagination: { total_records: totalRecords, batch_size: effectiveBatchSize, current_offset: offset, has_more: hasMore, next_offset: nextOffset }, performance: { query_time_ms: Date.now() - startTime, cache_hit: false } };

    const requestParameters = { ...requestData, therapist_ids: allowedTherapistIds, client_ids: allowedClientIds, batch_size: effectiveBatchSize }

    return new Response(JSON.stringify({ success: true, data: response, request_parameters: requestParameters, requestId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    const requestId = getRequestId(new Request('http://local'));
    console.error('Schedule batch data error:', error);
    return errorEnvelope({ requestId, code: 'internal_error', message: 'Unexpected error', status: 500 });
  }
})
