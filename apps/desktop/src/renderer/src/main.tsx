import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.js'
import { getLang, isRtl, syncLang } from './i18n.js'
import './styles.css'

// Apply the stored UI language direction before first paint.
document.documentElement.lang = getLang()
document.documentElement.dir = isRtl() ? 'rtl' : 'ltr'
// Mirror the language to the main process so the OBS dock opens in the same one.
syncLang()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
