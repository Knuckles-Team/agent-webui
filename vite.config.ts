import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const BACKEND_DEV_SERVER_PORT = process.env.BACKEND_PORT ?? 38001

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Vite type mismatch after dependency update
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), tsconfigPaths({ root: __dirname })],
  base: '',
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'agent/agent_webui/dist',
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  server: {
    port: 9000,
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_DEV_SERVER_PORT}/`,
        changeOrigin: true,
      },
      '/acp': {
        target: `http://localhost:${BACKEND_DEV_SERVER_PORT}/`,
        changeOrigin: true,
      },
    },
  },
}))
