/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base da API vista pelo navegador (padrão: /api, encaminhado pelo proxy do Vite). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
