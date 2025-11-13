const normalize = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const DEFAULT_ORG_FALLBACK = 'org-default-123';

export const handler = async () => {
  // Support multiple possible env var names from Netlify + Supabase integration
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_DATABASE_URL ||
    process.env.VITE_SUPABASE_URL;

  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  const supabaseEdgeUrl =
    process.env.SUPABASE_EDGE_URL ||
    process.env.VITE_SUPABASE_EDGE_URL;

  const defaultOrganizationId =
    normalize(process.env.DEFAULT_ORGANIZATION_ID) ||
    normalize(process.env.SUPABASE_DEFAULT_ORGANIZATION_ID) ||
    normalize(process.env.VITE_DEFAULT_ORGANIZATION_ID) ||
    normalize(process.env.DEFAULT_ORG_ID) ||
    DEFAULT_ORG_FALLBACK;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        error: 'Missing required environment variables: SUPABASE_URL and/or SUPABASE_ANON_KEY',
      }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      supabaseUrl,
      supabaseAnonKey,
      supabaseEdgeUrl: supabaseEdgeUrl || undefined,
      defaultOrganizationId,
    }),
  };
};

