import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { createProtectedRoute, corsHeaders, logApiAccess, RouteOptions } from "../_shared/auth-middleware.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_ANON_KEY") ?? ""
);

interface ProfileUpdateRequest {
  first_name?: string;
  last_name?: string;
  phone?: string;
  avatar_url?: string;
  time_zone?: string;
  preferences?: Record<string, any>;
}

export default createProtectedRoute(async (req: Request, userContext) => {
  const method = req.method;
  
  // GET /profiles/me - Get current user profile
  if (method === 'GET') {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userContext.user.id)
        .single();

      if (error || !profile) {
        console.error('Profile fetch error:', error);
        return new Response(
          JSON.stringify({ error: 'Profile not found' }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      logApiAccess('GET', '/profiles/me', userContext, 200);

      return new Response(
        JSON.stringify({
          profile: {
            id: profile.id,
            email: profile.email,
            role: profile.role,
            first_name: profile.first_name,
            last_name: profile.last_name,
            full_name: profile.full_name,
            phone: profile.phone,
            avatar_url: profile.avatar_url,
            time_zone: profile.time_zone,
            preferences: profile.preferences,
            is_active: profile.is_active,
            last_login_at: profile.last_login_at,
            created_at: profile.created_at,
            updated_at: profile.updated_at,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      console.error('Profile fetch error:', error);
      logApiAccess('GET', '/profiles/me', userContext, 500);
      
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // PUT /profiles/me - Update current user profile
  if (method === 'PUT') {
    try {
      const updateData: ProfileUpdateRequest = await req.json();

      // Validate update data
      const allowedFields = ['first_name', 'last_name', 'phone', 'avatar_url', 'time_zone', 'preferences'];
      const filteredData = Object.keys(updateData)
        .filter(key => allowedFields.includes(key))
        .reduce((obj, key) => {
          obj[key] = updateData[key];
          return obj;
        }, {} as any);

      if (Object.keys(filteredData).length === 0) {
        return new Response(
          JSON.stringify({ error: 'No valid fields to update' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Validate phone number format if provided
      if (filteredData.phone) {
        const phoneRegex = /^\+?[\d\s\-\(\)]+$/;
        if (!phoneRegex.test(filteredData.phone)) {
          return new Response(
            JSON.stringify({ error: 'Invalid phone number format' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      // Validate time zone if provided
      if (filteredData.time_zone) {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: filteredData.time_zone });
        } catch (error) {
          return new Response(
            JSON.stringify({ error: 'Invalid time zone' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      // Update profile
      const { data: updatedProfile, error } = await supabase
        .from('profiles')
        .update(filteredData)
        .eq('id', userContext.user.id)
        .select()
        .single();

      if (error || !updatedProfile) {
        console.error('Profile update error:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to update profile' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      logApiAccess('PUT', '/profiles/me', userContext, 200);

      return new Response(
        JSON.stringify({
          message: 'Profile updated successfully',
          profile: {
            id: updatedProfile.id,
            email: updatedProfile.email,
            role: updatedProfile.role,
            first_name: updatedProfile.first_name,
            last_name: updatedProfile.last_name,
            full_name: updatedProfile.full_name,
            phone: updatedProfile.phone,
            avatar_url: updatedProfile.avatar_url,
            time_zone: updatedProfile.time_zone,
            preferences: updatedProfile.preferences,
            is_active: updatedProfile.is_active,
            last_login_at: updatedProfile.last_login_at,
            created_at: updatedProfile.created_at,
            updated_at: updatedProfile.updated_at,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      console.error('Profile update error:', error);
      logApiAccess('PUT', '/profiles/me', userContext, 500);
      
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // Method not allowed
  return new Response(
    JSON.stringify({ error: 'Method not allowed' }),
    {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}, RouteOptions.authenticated);