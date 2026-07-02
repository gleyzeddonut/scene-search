import { useEffect, useState } from 'react'
import { api, stem } from './api'
import type { UpdateMsg, UpdatePhase, Prefs } from './api'

const THEMES: [string, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'System']
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

type Tab = 'general' | 'library' | 'updates'

const TABS: [Tab, string, string][] = [
  ['general', 'General', 'ic-gen'],
  ['library', 'Library', 'ic-lib'],
  ['updates', 'Updates', 'ic-upd']
]

function Switch(props: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={'switch' + (props.on ? ' on' : '')}
      role="switch"
      aria-checked={props.on}
      onClick={() => props.onChange(!props.on)}
    >
      <span className="knob" />
    </button>
  )
}

export function SettingsModal(props: { theme: string; onTheme: (t: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('general')
  const [version, setVersion] = useState('')
  const [upd, setUpd] = useState<UpdateMsg>({ phase: 'idle' })
  const [rebuildMsg, setRebuildMsg] = useState('')
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [hidden, setHidden] = useState<string[]>([])
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
  const toggleTop = (v: boolean) => {
    localStorage.setItem('alwaysOnTop', v ? '1' : '0')
    window.scripty.setAlwaysOnTop?.(v).catch(() => {})
    setOnTop(v)
  }
  const restore = async (p: string) => {
    await api.addScript(p).catch(() => {})
    setHidden(await api.hiddenFiles().catch(() => []))
  }

  // Esc closes, like every macOS sheet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="set-modal" onClick={(e) => e.stopPropagation()}>
        <div className="set-side">
          <div className="t">Settings</div>
          {TABS.map(([id, label, ic]) => (
            <button key={id} className={'set-nav' + (tab === id ? ' on' : '')} onClick={() => setTab(id)}>
              <span className={'ic ' + ic} />
              {label}
            </button>
          ))}
          <div className="set-ver">Scripty {version}</div>
        </div>

        <div className="set-pane">
          {tab === 'general' && (
            <>
              <div className="set-pane-title">General</div>
              <div className="set-row">
                <div>
                  <div className="set-label">Theme</div>
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
                  <div className="set-label">Monologue length</div>
                  <div className="set-sub">Minimum solo speech for the filter.</div>
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
                  <div className="set-sub">Float above other apps.</div>
                </div>
                <Switch on={onTop} onChange={toggleTop} />
              </div>
            </>
          )}

          {tab === 'library' && (
            <>
              <div className="set-pane-title">Library</div>
              <div className="set-cap">Removed files</div>
              {hidden.length > 0 ? (
                <div className="hidden-list">
                  {hidden.map((p) => (
                    <div key={p} className="hidden-row">
                      <span className="name" title={p}>{stem(p.split('/').pop() || p)}</span>
                      <button className="ghost sm" onClick={() => restore(p)}>Restore</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="set-sub">Nothing removed — files you remove from the library show up here.</div>
              )}
              <div className="set-row">
                <div>
                  <div className="set-label">Rebuild library</div>
                  <div className="set-sub">
                    {rebuildMsg || 'Re-parses every script. Tags and edits are kept.'}
                  </div>
                </div>
                <button className="ghost" onClick={rebuild}>Rebuild</button>
              </div>
            </>
          )}

          {tab === 'updates' && (
            <>
              <div className="set-pane-title">Updates</div>
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
                <Switch on={!prefs || prefs.autoDownload} onChange={setAuto} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
