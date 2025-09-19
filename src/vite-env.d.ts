/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_DIAGNOSTICS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}