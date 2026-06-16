import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './design/theme.css'

// Self-hosted fonts (full Cyrillic coverage). Display: Spectral; UI: IBM Plex
// Sans; mono (TeX/code, used by later modules): IBM Plex Mono.
import '@fontsource/spectral/500.css'
import '@fontsource/spectral/600.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'

import { App } from './app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
