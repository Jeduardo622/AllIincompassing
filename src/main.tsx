import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import BootDiagnostics from './dev/BootDiagnostics';
import DevErrorBoundary from './dev/ErrorBoundary';

const devEnabled = import.meta.env.DEV && (import.meta.env.VITE_DEV_DIAGNOSTICS ?? '1') === '1';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DevErrorBoundary>
      <BootDiagnostics enabled={devEnabled}>
        <App />
      </BootDiagnostics>
    </DevErrorBoundary>
  </React.StrictMode>
);
