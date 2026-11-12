import '@fontsource-variable/geist'
import '@fontsource-variable/fraunces'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App, { applyTheme, type Theme } from './App'
import './styles.css'

applyTheme((localStorage.getItem('plan.theme') as Theme | null) ?? 'system')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// offline support and "add to home screen"; skipped in development so edits show up immediately
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {})
