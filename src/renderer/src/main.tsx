import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Stamped before the first render, from a value the preload read synchronously - otherwise a
// dark-theme window paints one light frame while React boots.
if (window.api.initialDark) document.documentElement.dataset.theme = 'dark'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
