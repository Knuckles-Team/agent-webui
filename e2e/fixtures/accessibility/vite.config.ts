import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const source = fileURLToPath(new URL('../../../src', import.meta.url))

export default defineConfig({
  root,
  plugins: [
    {
      name: 'synthetic-chat',
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === '../Chat' && importer?.endsWith('/src/components/ChatPanel.tsx')) return `${root}Chat.tsx`
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': source } },
  server: { host: '127.0.0.1', port: 5195, strictPort: true },
})
