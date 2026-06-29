import { useEffect, useState } from 'react'
import { api } from './api'
import type { UpdateMsg, UpdatePhase } from './api'

const THEMES: [string, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'System']
]

const STATUS: Record<UpdatePhase, string> = {
  idle: '',
  checking: 'Checking for updates…',
  available: 'A new version is ready — downloading…',
  downloading: 'Fetching the latest build…',
  ready: 'Downloaded — relaunch to finish installing.',
  none: "You're on the latest version.",
  error: "Couldn't check for updates.",
  dev: 'Updates run in the installed app.'
}

export function SettingsModal(props: { theme: string; onTheme: (t: string) => void; onClose: () => void }) {
  const [version, setVersion] = useState('')
  const [upd, setUpd] = useState<UpdateMsg>({ phase: 'idle' })
  const [rebuildMsg, setRebuildMsg] = useState('')

  useEffect(() => {
    // guard against an older preload (e.g. dev not fully restarted) so the
    // modal never crashes the app
    try {
      window.scripty.appVersion?.().then(setVersion).catch(() => {})
      return window.scripty.onUpdateStatus?.((m) => setUpd((m as UpdateMsg) || { phase: 'idle' }))
    } catch {
      return undefined
    }
  }, [])

  const check = () => {
    try {
      setUpd({ phase: 'checking' })
      window.scripty.checkUpdates?.()
    } catch {
      setUpd({ phase: 'error' })
    }
  }
  const relaunch = () => {
    try {
      window.scripty.quitAndInstall?.()
    } catch {
      /* ignore */
    }
  }
  const rebuild = async () => {
    try {
      await api.rebuild() // kicks off a full re-parse in the background
      setRebuildMsg('Rebuilding your library… progress shows in the Library tab.')
    } catch {
      setRebuildMsg('Couldn’t start the rebuild.')
    }
  }

  const phase = upd.phase
  const pct = Math.min(100, Math.max(0, Math.round(upd.pct || 0)))

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
            <div className="set-label">Rebuild library</div>
            <div className="set-sub">
              {rebuildMsg || 'Re-parse every script from scratch — use if something looks parsed wrong. Your tags and edits are kept.'}
            </div>
          </div>
          <button className="ghost" onClick={rebuild} disabled={!!rebuildMsg}>
            {rebuildMsg ? 'Rebuilding…' : 'Rebuild'}
          </button>
        </div>

        <div className="updcard">
          <div className="ut">Software update</div>
          <div className="ustatus">{STATUS[phase] || ' '}</div>

          {phase === 'downloading' ? (
            <div className="upd-row">
              <div className="upd-dl">
                <div className="upd-dl-top">
                  <span className="upd-arrow fast">↓</span>
                  <span className="lab">Downloading update…</span>
                  <span className="pct">{pct}%</span>
                </div>
                <div className="sc-track">
                  <div className="sc-fill" style={{ width: pct + '%' }} />
                </div>
              </div>
            </div>
          ) : phase === 'ready' ? (
            <div className="upd-row">
              <div className="upd-tile solid">
                <span className="upd-check">✓</span>
              </div>
              <div className="upd-info">
                <div className="v">Version {upd.version || ''} downloaded</div>
                <div className="d">Relaunch to finish installing.</div>
              </div>
              <button className="btn-accent" onClick={relaunch}>
                Relaunch
              </button>
            </div>
          ) : phase === 'available' ? (
            <div className="upd-row">
              <div className="upd-tile">
                <span className="upd-arrow">↓</span>
              </div>
              <div className="upd-info">
                <div className="v">Version {upd.version || ''}</div>
                <div className="d">Starting download…</div>
              </div>
            </div>
          ) : (
            <div className="upd-row">
              <div className="upd-tile">
                <span className="upd-arrow still">↓</span>
              </div>
              <div className="upd-info">
                <div className="v">Scripty {version}</div>
                <div className="d">
                  {phase === 'none' ? 'Up to date' : phase === 'dev' ? 'Installed app only' : 'Check for a newer version'}
                </div>
              </div>
              <button className="ghost" onClick={check} disabled={phase === 'checking'}>
                {phase === 'checking' ? 'Checking…' : 'Check for Updates'}
              </button>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="ghost" onClick={props.onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
