import { useEffect, useState } from 'react'
import { api, getScriptScale, setScriptScale, stem } from './api'
import type { UpdateMsg, UpdatePhase, Prefs } from './api'

const THEMES: [string, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'System']
]

// script preview text sizes (multiplier for every script-text font)
const SIZES: [number, string][] = [
  [0.9, 'Small'],
  [1, 'Normal'],
  [1.15, 'Large'],
  [1.3, 'Huge']
]

// the Monologue filter's minimum speech length
const MONO_MINS = [30, 45, 60, 90]

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
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [hidden, setHidden] = useState<string[]>([])
  const [scale, setScale] = useState(getScriptScale())
  const [onTop, setOnTop] = useState(localStorage.getItem('alwaysOnTop') === '1')

  useEffect(() => {
    // guard against an older preload (e.g. dev not fully restarted) so the
    // modal never crashes the app
    try {
      window.scripty.appVersion?.().then(setVersion).catch(() => {})
      api.prefs().then(setPrefs).catch(() => {})
      api.hiddenFiles().then(setHidden).catch(() => {})
      return window.scripty.onUpdateStatus?.((m) => setUpd((m as UpdateMsg) || { phase: 'idle' }))
    } catch {
      return undefined
    }
  }, [])

  const setMono = (v: number) => api.setPref('monologueMin', v).then(setPrefs).catch(() => {})
  const setAuto = (v: boolean) => api.setPref('autoDownload', v).then(setPrefs).catch(() => {})
  const pickScale = (v: number) => {
    setScriptScale(v)
    setScale(v)
  }
  const toggleTop = (v: boolean) => {
    localStorage.setItem('alwaysOnTop', v ? '1' : '0')
    window.scripty.setAlwaysOnTop?.(v).catch(() => {})
    setOnTop(v)
  }
  const restore = async (p: string) => {
    await api.addScript(p).catch(() => {})
    setHidden(await api.hiddenFiles().catch(() => []))
  }

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
      const r = await api.rebuild() // kicks off a full re-parse in the background
      setRebuildMsg(
        r.started
          ? 'Rebuilding your library… progress shows in the Library tab.'
          : 'An index is already running — it’ll finish first.'
      )
    } catch {
      setRebuildMsg('Couldn’t start the rebuild.')
    }
  }

  const phase = upd.phase
  const pct = Math.min(100, Math.max(0, Math.round(upd.pct || 0)))
  const manualDl = phase === 'available' && prefs != null && !prefs.autoDownload
  const status = manualDl ? 'A new version is available.' : STATUS[phase]

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
            <div className="set-label">Script text size</div>
            <div className="set-sub">How large scenes and sides read.</div>
          </div>
          <div className="seg">
            {SIZES.map(([v, label]) => (
              <span key={v} className={Math.abs(scale - v) < 0.01 ? 'on' : ''} onClick={() => pickScale(v)}>
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="set-row">
          <div>
            <div className="set-label">Monologue length</div>
            <div className="set-sub">How long a solo speech must run to count for the Monologue filter.</div>
          </div>
          <div className="seg">
            {MONO_MINS.map((v) => (
              <span key={v} className={prefs?.monologueMin === v ? 'on' : ''} onClick={() => setMono(v)}>
                {v}s
              </span>
            ))}
          </div>
        </div>

        <div className="set-row">
          <div>
            <div className="set-label">Keep window on top</div>
            <div className="set-sub">Float above other apps — handy while running lines or self-taping.</div>
          </div>
          <div className="seg">
            <span className={!onTop ? 'on' : ''} onClick={() => toggleTop(false)}>Off</span>
            <span className={onTop ? 'on' : ''} onClick={() => toggleTop(true)}>On</span>
          </div>
        </div>

        {hidden.length > 0 && (
          <>
            <div className="set-row">
              <div>
                <div className="set-label">Removed files</div>
                <div className="set-sub">
                  {hidden.length} file{hidden.length !== 1 ? 's' : ''} you removed — restore to bring one back.
                </div>
              </div>
            </div>
            <div className="hidden-list">
              {hidden.map((p) => (
                <div key={p} className="hidden-row">
                  <span className="name" title={p}>{stem(p.split('/').pop() || p)}</span>
                  <button className="ghost" onClick={() => restore(p)}>Restore</button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="set-row">
          <div>
            <div className="set-label">Rebuild library</div>
            <div className="set-sub">
              {rebuildMsg || 'Re-parse every script from scratch — use if something looks parsed wrong. Your tags and edits are kept.'}
            </div>
          </div>
          <button className="ghost" onClick={rebuild}>Rebuild</button>
        </div>

        <div className="updcard">
          <div className="ut">Software update</div>
          <div className="ustatus">{status || ' '}</div>

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
                <div className="d">{manualDl ? 'Ready to download' : 'Starting download…'}</div>
              </div>
              {manualDl && (
                <button className="btn-accent" onClick={() => window.scripty.downloadUpdate?.()}>
                  Download
                </button>
              )}
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
          <div className="upd-auto">
            <span className="d">Download updates automatically</span>
            <div className="seg">
              <span className={prefs && !prefs.autoDownload ? 'on' : ''} onClick={() => setAuto(false)}>Off</span>
              <span className={!prefs || prefs.autoDownload ? 'on' : ''} onClick={() => setAuto(true)}>On</span>
            </div>
          </div>
        </div>

        <div className="set-note">
          Scripts come in every format under the sun, and parsing is still being refined —
          so a scene, character, or estimate may occasionally look off. If something seems
          wrong, “Rebuild library” re-parses with the latest improvements.
        </div>

        <div className="modal-foot">
          <button className="ghost" onClick={props.onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
