import { createRoot } from 'react-dom/client'
import App from './App'
import { QuickLookView } from './QuickLookView'
import { applyScriptScale, onScriptScale } from './api'

// script text size: apply on startup and follow changes live in BOTH windows (the
// 'storage' event carries a Settings change into the Quick Look pop-out)
applyScriptScale()
onScriptScale(applyScriptScale)

const root = createRoot(document.getElementById('root')!)
const ql = new URLSearchParams(window.location.search).get('quicklook')
if (ql) {
  // this window was opened as a Quick Look pop-out
  root.render(<QuickLookView {...JSON.parse(ql)} />)
} else {
  root.render(<App />)
}
