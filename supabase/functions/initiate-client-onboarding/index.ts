import { createClient } from "npm:@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const { 
      client_name, 
      client_email, 
      date_of_birth, 
      insurance_provider, 
      referral_source, 
      service_preference 
    } = await req.json();

    // Validate required fields
    if (!client_name || !client_email) {
      throw new Error("Client name and email are required");
    }

    // Parse client name into first and last name
    let first_name = client_name;
    let last_name = "";
    
    if (client_name.includes(" ")) {
      const nameParts = client_name.split(" ");
      first_name = nameParts[0];
      last_name = nameParts.slice(1).join(" ");
    }

    // Construct the onboarding URL with query parameters
    const queryParams = new URLSearchParams();
    queryParams.append("first_name", first_name);
    queryParams.append("last_name", last_name);
    queryParams.append("email", client_email);
    
    if (date_of_birth) {
      queryParams.append("date_of_birth", date_of_birth);
    }
    
    if (insurance_provider) {
      queryParams.append("insurance_provider", insurance_provider);
    }
    
    if (referral_source) {
      queryParams.append("referral_source", referral_source);
    }
    
    if (service_preference && Array.isArray(service_preference)) {
      queryParams.append("service_preference", service_preference.join(","));
    }

    const onboardingUrl = `/clients/new?${queryParams.toString()}`;

    return new Response(
      JSON.stringify({ 
        success: true,
        onboardingUrl,
        message: "Client onboarding initiated successfully"
      }),
      {
        headers: { 
          ...corsHeaders,
          "Content-Type": "application/json" 
        },
      }
    );
  } catch (error) {
    console.error("Error initiating client onboarding:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message || "An error occurred while initiating client onboarding"
      }),
      {
        status: 400,
        headers: { 
          ...corsHeaders,
          "Content-Type": "application/json" 
        },
      }
    );
  }
});