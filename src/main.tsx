import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import BootDiagnostics from './dev/BootDiagnostics';
import DevErrorBoundary from './dev/ErrorBoundary';
import { ensureRuntimeSupabaseConfig } from './lib/runtimeConfig';
import { registerServiceWorker } from './registerServiceWorker';

const devEnabled = import.meta.env.DEV && (import.meta.env.VITE_DEV_DIAGNOSTICS ?? '1') === '1';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

const root = ReactDOM.createRoot(rootElement);

const RuntimeConfigError: React.FC<{ message: string }> = ({ message }) => (
  <div
    style={{
      padding: 24,
      fontFamily: 'system-ui, sans-serif',
      color: '#ef4444',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#0b1120',
    }}
  >
    <div style={{ width: '100%', maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Configuration error</h1>
      <p style={{ marginBottom: 12 }}>The application failed to load the Supabase runtime configuration.</p>
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: '#111827',
          color: '#f3f4f6',
          padding: 16,
          borderRadius: 8,
          maxHeight: '40vh',
          overflowY: 'auto',
        }}
      >
        {message}
      </pre>
    </div>
  </div>
);

const bootstrap = async (): Promise<void> => {
  try {
    const [, { default: App }] = await Promise.all([ensureRuntimeSupabaseConfig(), import('./App.tsx')]);
    root.render(
      <React.StrictMode>
        <DevErrorBoundary>
          <BootDiagnostics enabled={devEnabled}>
            <App />
          </BootDiagnostics>
        </DevErrorBoundary>
      </React.StrictMode>,
    );
    void registerServiceWorker();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown runtime configuration failure';
    console.error('[Bootstrap] Failed to initialise Supabase runtime config', error);
    root.render(
      <React.StrictMode>
        <DevErrorBoundary>
          <BootDiagnostics enabled={devEnabled}>
            <RuntimeConfigError message={message} />
          </BootDiagnostics>
        </DevErrorBoundary>
      </React.StrictMode>,
    );
    void registerServiceWorker();
  }
};

void bootstrap();
