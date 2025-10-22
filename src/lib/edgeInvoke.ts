import { supabase } from './supabaseClient';

export interface EdgeInvokeOptions<TBody = unknown> {
  body?: TBody;
  accessToken?: string;
  anonKey?: string;
}

export async function edgeInvoke<TResponse = unknown>(functionName: string, options: EdgeInvokeOptions = {}): Promise<{ data: TResponse | null; error: Error | null; status: number }>
{
  const headers = new Headers({ 'Content-Type': 'application/json' });

  const providedToken = typeof options.accessToken === 'string' ? options.accessToken.trim() : '';
  if (providedToken.length > 0) {
    headers.set('Authorization', `Bearer ${providedToken}`);
  } else {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.set('Authorization', `Bearer ${session.access_token}`);
    }
  }

  if (typeof options.anonKey === 'string' && options.anonKey.trim().length > 0) {
    headers.set('apikey', options.anonKey.trim());
  }

  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      headers,
      body: options.body,
    } as any);
    const status = (error as any)?.status ?? (error ? 500 : 200);
    return { data: (data as TResponse | null) ?? null, error: (error as Error | null) ?? null, status };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { data: null, error, status: (error as any)?.status ?? 500 };
  }
}


