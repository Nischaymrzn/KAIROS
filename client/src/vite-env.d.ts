/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Inference API base URL (default http://localhost:8000). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
