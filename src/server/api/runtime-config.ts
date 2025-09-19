import { getRuntimeSupabaseConfig } from '../runtimeConfig';

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

export const runtimeConfigHandler = async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: JSON_HEADERS });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  try {
    const config = getRuntimeSupabaseConfig();
    return new Response(JSON.stringify(config), { status: 200, headers: JSON_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load runtime config';
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: JSON_HEADERS });
  }
};

