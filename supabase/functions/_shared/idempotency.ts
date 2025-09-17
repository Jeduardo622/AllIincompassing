import type { PostgrestError, SupabaseClient } from "npm:@supabase/supabase-js@2.50.0";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export interface StoredIdempotencyResponse<T extends Json = Json> {
  key: string;
  endpoint: string;
  responseHash: string;
  responseBody: T;
  statusCode: number;
}

export interface IdempotencyAdapter<T extends Json = Json> {
  get(key: string, endpoint: string): Promise<StoredIdempotencyResponse<T> | null>;
  set(record: StoredIdempotencyResponse<T>): Promise<StoredIdempotencyResponse<T>>;
}

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

function normalize(value: Json): Json {
  if (Array.isArray(value)) {
    return value.map(item => normalize(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, Json>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, normalize(val)] as const);

    return entries.reduce<Record<string, Json>>((acc, [key, val]) => {
      acc[key] = val;
      return acc;
    }, {});
  }

  return value;
}

function cloneJson<T extends Json>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export async function hashResponse(body: Json, statusCode: number): Promise<string> {
  const encoder = new TextEncoder();
  const canonical = normalize({ body, statusCode });
  const payload = encoder.encode(JSON.stringify(canonical));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

class SupabaseIdempotencyAdapter implements IdempotencyAdapter {
  private static readonly TABLE = "function_idempotency_keys";

  constructor(private readonly client: SupabaseClient) {}

  async get(key: string, endpoint: string): Promise<StoredIdempotencyResponse | null> {
    const { data, error } = await this.client
      .from(SupabaseIdempotencyAdapter.TABLE)
      .select("endpoint, idempotency_key, response_hash, response_body, status_code")
      .eq("idempotency_key", key)
      .eq("endpoint", endpoint)
      .maybeSingle();

    if (error) {
      throw new Error(error.message ?? "Failed to fetch idempotency record");
    }

    if (!data) {
      return null;
    }

    return {
      key: data.idempotency_key as string,
      endpoint: data.endpoint as string,
      responseHash: data.response_hash as string,
      responseBody: data.response_body as Json,
      statusCode: data.status_code as number,
    };
  }

  async set(record: StoredIdempotencyResponse): Promise<StoredIdempotencyResponse> {
    const row = {
      idempotency_key: record.key,
      endpoint: record.endpoint,
      response_hash: record.responseHash,
      response_body: cloneJson(record.responseBody),
      status_code: record.statusCode,
    };

    const { data, error } = await this.client
      .from(SupabaseIdempotencyAdapter.TABLE)
      .insert(row)
      .select("endpoint, idempotency_key, response_hash, response_body, status_code")
      .single();

    if (error) {
      if ((error as PostgrestError).code === "23505") {
        const existing = await this.get(record.key, record.endpoint);
        if (existing && existing.responseHash === record.responseHash) {
          return existing;
        }
        throw new IdempotencyConflictError("Idempotency key already used with a different response");
      }
      throw new Error(error.message ?? "Failed to store idempotency response");
    }

    return {
      key: data.idempotency_key as string,
      endpoint: data.endpoint as string,
      responseHash: data.response_hash as string,
      responseBody: data.response_body as Json,
      statusCode: data.status_code as number,
    };
  }
}

class MemoryIdempotencyAdapter implements IdempotencyAdapter {
  private readonly store = new Map<string, StoredIdempotencyResponse>();

  constructor(initial?: StoredIdempotencyResponse[]) {
    initial?.forEach(record => {
      const key = this.composeKey(record.key, record.endpoint);
      this.store.set(key, {
        ...record,
        responseBody: cloneJson(record.responseBody),
      });
    });
  }

  async get(key: string, endpoint: string): Promise<StoredIdempotencyResponse | null> {
    const record = this.store.get(this.composeKey(key, endpoint));
    if (!record) {
      return null;
    }

    return {
      ...record,
      responseBody: cloneJson(record.responseBody),
    };
  }

  async set(record: StoredIdempotencyResponse): Promise<StoredIdempotencyResponse> {
    const key = this.composeKey(record.key, record.endpoint);
    const existing = this.store.get(key);

    if (existing) {
      if (existing.responseHash !== record.responseHash) {
        throw new IdempotencyConflictError("Idempotency key already used with a different response");
      }
      return {
        ...existing,
        responseBody: cloneJson(existing.responseBody),
      };
    }

    const copy: StoredIdempotencyResponse = {
      ...record,
      responseBody: cloneJson(record.responseBody),
    };
    this.store.set(key, copy);

    return {
      ...copy,
      responseBody: cloneJson(copy.responseBody),
    };
  }

  private composeKey(key: string, endpoint: string): string {
    return `${endpoint}::${key}`;
  }
}

export class IdempotencyService<T extends Json = Json> {
  constructor(private readonly adapter: IdempotencyAdapter<T>) {}

  async find(key: string, endpoint: string): Promise<StoredIdempotencyResponse<T> | null> {
    return this.adapter.get(key, endpoint);
  }

  async persist(
    key: string,
    endpoint: string,
    responseBody: T,
    statusCode: number,
  ): Promise<StoredIdempotencyResponse<T>> {
    const responseHash = await hashResponse(responseBody, statusCode);
    return this.adapter.set({
      key,
      endpoint,
      responseHash,
      responseBody,
      statusCode,
    });
  }
}

export function createSupabaseIdempotencyService(client: SupabaseClient): IdempotencyService {
  return new IdempotencyService(new SupabaseIdempotencyAdapter(client));
}

export function createInMemoryIdempotencyService(initial?: StoredIdempotencyResponse[]): IdempotencyService {
  return new IdempotencyService(new MemoryIdempotencyAdapter(initial));
}
