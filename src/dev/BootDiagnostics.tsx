import React, { useEffect, useMemo, useRef, useState } from 'react';

interface BootDiagnosticsProps {
  enabled?: boolean;
  children: React.ReactNode;
}

type PendingRequest = {
  id: number;
  url: string;
  method: string;
  startedAt: number;
  stack?: string;
};

const KEY_LIST = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_EDGE_URL',
];

export default function BootDiagnostics({ enabled, children }: BootDiagnosticsProps) {
  const [open, setOpen] = useState(false);
  const [firstPaint, setFirstPaint] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const idCounter = useRef(0);
  const restoreRef = useRef<(() => void) | null>(null);

  // Evaluate presence of env keys without exposing values
  const envPresence = useMemo(() => {
    const env = ((import.meta as unknown) as { env?: Record<string, unknown> }).env ?? {};
    const info: Record<string, boolean> = {};
    for (const k of KEY_LIST) info[k] = Boolean(env[k]);
    // Also surface VITE_API_* keys generically
    Object.keys(env)
      .filter((k) => k.startsWith('VITE_API_'))
      .forEach((k) => {
        info[k] = Boolean((env as Record<string, unknown>)[k]);
      });
    return info;
  }, []);

  useEffect(() => {
    setFirstPaint(true);
  }, []);

  // Hook global errors
  useEffect(() => {
    if (!enabled) return;
    const onError = (e: ErrorEvent) => {
      setErrors((prev) => [...prev.slice(-10), e.message]);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const message = e.reason?.message || String(e.reason);
      setErrors((prev) => [...prev.slice(-10), `UnhandledRejection: ${message}`]);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [enabled]);

  // Wrap fetch to detect long pending requests
  useEffect(() => {
    if (!enabled) return;
    if (restoreRef.current) return; // already installed

    const originalFetch = window.fetch.bind(window);
    const currentPending = new Map<number, PendingRequest>();

    function updatePendingView() {
      setPending(Array.from(currentPending.values()));
    }

    function wrappedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const id = ++idCounter.current;
      const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const url = input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);
      const record: PendingRequest = {
        id,
        url,
        method,
        startedAt: performance.now(),
        stack: new Error().stack,
      };
      currentPending.set(id, record);
      updatePendingView();

      const pendingTimer = window.setTimeout(() => {
        const elapsed = Math.round(performance.now() - record.startedAt);
        // Log but do not throw
        console.warn(`[BootDiagnostics] fetch pending > 5000ms (${elapsed}ms)`, { url: record.url, method: record.method, stack: record.stack });
      }, 5000);

      const finalize = () => {
        window.clearTimeout(pendingTimer);
        currentPending.delete(id);
        updatePendingView();
      };

      return originalFetch(input, init)
        .then((res) => {
          finalize();
          return res;
        })
        .catch((err) => {
          finalize();
          throw err;
        });
    }

    (globalThis as unknown as { fetch: typeof window.fetch }).fetch = wrappedFetch as typeof window.fetch;

    restoreRef.current = () => {
      (globalThis as unknown as { fetch: typeof window.fetch }).fetch = originalFetch;
      currentPending.clear();
      updatePendingView();
    };

    return () => {
      restoreRef.current?.();
      restoreRef.current = null;
    };
  }, [enabled]);

  if (!enabled) return <>{children}</>;

  return (
    <>
      {children}
      <div style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 9999,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      }}>
        <div style={{ background: 'rgba(17,24,39,0.9)', color: '#E5E7EB', border: '1px solid #374151', borderRadius: 8, padding: 10, minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700 }}>Boot Diagnostics</div>
            <button onClick={() => setOpen(!open)} style={{ color: '#93C5FD', background: 'transparent', border: 'none', cursor: 'pointer' }}>{open ? 'hide' : 'show'}</button>
          </div>
          {!open ? (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              <div>mounted: {String(firstPaint)}</div>
              <div>pending fetches: {pending.length}</div>
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.4 }}>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>Env presence</div>
              {Object.entries(envPresence).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>{k}</span>
                  <span style={{ color: v ? '#34D399' : '#F87171' }}>{v ? 'OK' : 'MISSING'}</span>
                </div>
              ))}
              <div style={{ margin: '10px 0 6px', fontWeight: 600 }}>Pending requests</div>
              {pending.length === 0 ? (
                <div>none</div>
              ) : (
                pending.slice(0, 6).map((p) => (
                  <div key={p.id} style={{ marginBottom: 6 }}>
                    <div>{p.method} {p.url}</div>
                  </div>
                ))
              )}
              {errors.length > 0 && (
                <>
                  <div style={{ margin: '10px 0 6px', fontWeight: 600, color: '#FCA5A5' }}>Errors</div>
                  {errors.slice(-5).map((e, idx) => (
                    <div key={idx}>• {e}</div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}


