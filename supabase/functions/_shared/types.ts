// Shared types for Supabase Edge Functions
export interface CorsHeaders {
  "Access-Control-Allow-Origin": string;
  "Access-Control-Allow-Headers": string;
  "Access-Control-Allow-Methods"?: string;
}

export interface StandardResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface AuthenticatedRequest {
  headers: {
    get(name: string): string | null;
  };
  json(): Promise<any>;
  method: string;
}

export interface DatabaseError {
  message: string;
  code?: string;
  details?: string;
}

// Common response builder
export function createResponse<T>(
  data: T,
  status: number = 200,
  corsHeaders: CorsHeaders
): Response {
  const response: StandardResponse<T> = {
    success: status < 400,
    data: status < 400 ? data : undefined,
    error: status >= 400 ? (data as any)?.message || 'An error occurred' : undefined
  };

  return new Response(
    JSON.stringify(response),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    }
  );
}

// Common error handler
export function handleError(error: any, corsHeaders: CorsHeaders): Response {
  console.error('Edge function error:', error);
  
  const status = error.status || 500;
  const message = error.message || 'Internal server error';
  
  return createResponse({ message }, status, corsHeaders);
}

// Common auth validation
export async function validateAuth(req: AuthenticatedRequest, supabase: any): Promise<any> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    throw new Error("Invalid token or user not found");
  }
  
  return user;
} 