import { supabase } from './supabase';

export interface EdgeInvokeOptions<TBody = unknown> {
  body?: TBody;
  accessToken?: string;
  anonKey?: string;
}

export function createEdgeInvoke(client: { auth: { getSession: () => Promise<{ data: { session: { access_token?: string } | null } }> }, functions: { invoke: (name: string, init: { headers: Headers; body?: unknown }) => Promise<{ data: unknown; error: Error | null }> } }) {
  return async function edgeInvoke<TResponse = unknown>(functionName: string, options: EdgeInvokeOptions = {}): Promise<{ data: TResponse | null; error: Error | null; status: number }> {
    const headers = new Headers();

    const providedToken = typeof options.accessToken === 'string' ? options.accessToken.trim() : '';
    if (providedToken.length > 0) {
      headers.set('Authorization', `Bearer ${providedToken}`);
    } else {
      try {
        const { data: { session } } = await client.auth.getSession();
        if (session?.access_token) {
          headers.set('Authorization', `Bearer ${session.access_token}`);
        }
      } catch {
        // Proceed without Authorization if session lookup fails in test/SSR
      }
    }

    if (typeof options.anonKey === 'string' && options.anonKey.trim().length > 0) {
      headers.set('apikey', options.anonKey.trim());
    }

    try {
      const invokeInit: any = { body: options.body };
      if (headers.size > 0) {
        invokeInit.headers = headers;
      }
      const { data, error } = await client.functions.invoke(functionName, invokeInit);
      const status = (error as any)?.status ?? (error ? 500 : 200);
      return { data: (data as TResponse | null) ?? null, error: (error as Error | null) ?? null, status };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return { data: null, error, status: (error as any)?.status ?? 500 };
    }
  };
}

export const edgeInvoke = createEdgeInvoke(supabase);


