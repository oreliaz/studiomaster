import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.js'
import { getLang, isRtl } from './i18n.js'
import './styles.css'

// Apply the stored UI language direction before first paint.
document.documentElement.lang = getLang()
document.documentElement.dir = isRtl() ? 'rtl' : 'ltr'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
