import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// O .env é único, na raiz do monorepo (só variáveis VITE_* chegam ao navegador).
const envDir = path.resolve(import.meta.dirname, '../..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, 'VITE_')
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3000'
  return {
    envDir,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    // Em desenvolvimento a API fica na mesma origem (cookies first-party, sem CORS).
    server: {
      proxy: {
        '/api': { target: apiTarget, changeOrigin: false, xfwd: true, ws: true },
      },
    },
    preview: {
      proxy: {
        '/api': { target: apiTarget, changeOrigin: false, xfwd: true, ws: true },
      },
    },
  }
})
