import { useEffect, useState } from 'react'

const THEMES: [string, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'System']
]

const STATUS_TEXT: Record<string, string> = {
  checking: 'Checking for updates…',
  available: 'Update available — downloading…',
  'not-available': "You're up to date.",
  downloaded: 'Update ready — restart to apply.',
  error: "Couldn't check for updates.",
  dev: 'Updates run in the installed app.'
}

export function SettingsModal(props: { theme: string; onTheme: (t: string) => void; onClose: () => void }) {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    // guard against an older preload (e.g. dev not fully restarted) so the
    // modal never crashes the app
    try {
      window.scripty.appVersion?.().then(setVersion).catch(() => {})
      return window.scripty.onUpdateStatus?.(setStatus)
    } catch {
      return undefined
    }
  }, [])

  const check = () => {
    try {
      setStatus('checking')
      window.scripty.checkUpdates?.()
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Settings</div>

        <div className="set-row">
          <div>
            <div className="set-label">Appearance</div>
            <div className="set-sub">Light, dark, or follow your system.</div>
          </div>
          <div className="seg">
            {THEMES.map(([v, label]) => (
              <span key={v} className={props.theme === v ? 'on' : ''} onClick={() => props.onTheme(v)}>
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="set-row">
          <div>
            <div className="set-label">Version</div>
            <div className="set-sub">
              Scripty {version}
              {STATUS_TEXT[status] ? ` · ${STATUS_TEXT[status]}` : ''}
            </div>
          </div>
          <button className="ghost" onClick={check}>
            Check for Updates
          </button>
        </div>

        <div className="modal-foot">
          <button className="ghost" onClick={props.onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
