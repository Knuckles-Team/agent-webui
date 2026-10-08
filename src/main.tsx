import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { installCspNonce } from './lib/csp-nonce'
import App from './App.tsx'

installCspNonce()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
