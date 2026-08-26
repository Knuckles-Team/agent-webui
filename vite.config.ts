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
    // BUG-PE-062: `agent/agent_webui/dist` is the LIVE, NFS-mounted
    // production artifact -- vite empties `outDir` and writes files into
    // it over the whole build, `index.html` last, so building straight
    // into that path let any interrupted build (Ctrl-C, OOM, a `git push`
    // cut off mid pre-push hook) serve a headless dashboard to every user
    // (confirmed live twice in one day). Build into a staging directory
    // instead; `scripts/publish-dist.mjs` (run as the last step of `pnpm
    // build`) verifies the staged build is complete and swaps it into
    // `dist` atomically. Never point this at `dist` directly -- see that
    // script's header for why.
    outDir: 'agent/agent_webui/dist.tmp',
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
