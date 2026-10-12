/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base da API vista pelo navegador (padrão: /api, encaminhado pelo proxy do Vite). */
  readonly VITE_API_URL?: string;
  /** Chave pública do Mercado Pago (tokeniza o cartão no navegador). Sem ela o cartão fica desativado. */
  readonly VITE_MP_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
