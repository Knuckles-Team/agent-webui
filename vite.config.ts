import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
// import { analyzer } from 'vite-bundle-analyzer'

// 8000 is quite common for backend, avoid the clash
const BACKEND_DEV_SERVER_PORT = process.env.BACKEND_PORT ?? 38001

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), tsconfigPaths({ root: __dirname })],
  base: '',
  build: {
    outDir: 'agent/agent_web/dist',
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
    },
  },
}))
