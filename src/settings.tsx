import { useRef, useState } from 'react'
import { canInstall, install, isIOS, isStandalone, saveFile } from './device'
import { connect, disconnect, reconnect, setClientId, useGoogle } from './google'
import { Icon } from './sections'
import { normalize, useApp } from './store'
import { setSyncAccount, useSyncStatus } from './sync'
import type { State } from './types'
import { Sheet, useUI } from './ui'

export type Theme = 'system' | 'light' | 'dark'
export function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#151412' : '#f3f0e8')
}
export const savedTheme = () => (localStorage.getItem('plan.theme') as Theme | null) ?? 'system'

const ago = (at?: number) => {
  if (!at) return ''
  const m = Math.round((Date.now() - at) / 60000)
  return m < 1 ? 'just now' : m === 1 ? 'a minute ago' : m < 60 ? `${m} minutes ago` : new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function Settings({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp()
  const ui = useUI()
  const g = useGoogle()
  const sync = useSyncStatus()
  const [id, setId] = useState(g.clientId)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [theme, setTheme] = useState<Theme>(savedTheme)
  const [, bump] = useState(0)
  const file = useRef<HTMLInputElement>(null)

  const run = (p: Promise<void>) => {
    setBusy(true)
    setErr('')
    p.catch((e) => setErr(e.message)).finally(() => setBusy(false))
  }
  const pickTheme = (t: Theme) => {
    setTheme(t)
    localStorage.setItem('plan.theme', t)
    applyTheme(t)
  }
  const importAll = async (f?: File) => {
    if (file.current) file.current.value = '' // so the same file can be chosen again
    if (!f) return
    let backup: State | null = null
    try {
      backup = normalize(JSON.parse(await f.text()))
    } catch {}
    if (!backup) return setErr('That file is not a Plan backup.')
    setErr('')
    const n = backup.cards.length
    if (await ui.confirm({
      title: 'Restore this backup?', cta: 'Restore', danger: true,
      body: `It has ${n} card${n === 1 ? '' : 's'} and replaces everything here${sync.account ? ', on every synced device' : ''}.`,
    })) {
      dispatch({ t: 'restore', state: backup })
      ui.toast('Backup restored')
    }
  }

  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="sheet-body settings">
        <h3>Appearance</h3>
        <div className="seg" role="radiogroup" aria-label="Theme">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} role="radio" aria-checked={theme === t} onClick={() => pickTheme(t)}>
              <Icon name={t === 'system' ? 'Monitor' : t === 'light' ? 'Sun' : 'Moon'} size={15} />
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {!isStandalone() && (isIOS() || canInstall()) && (
          <>
            <h3>Install</h3>
            {isIOS() ? (
              <p className="hint">
                In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. Plan then opens full screen like any app, works
                offline, and its icon shows how many things are due today.
              </p>
            ) : (
              <button className="btn" onClick={() => install().then(() => bump((n) => n + 1))}><Icon name="Download" size={14} /> Install Plan</button>
            )}
          </>
        )}

        <h3>Google accounts</h3>
        {g.accounts.map((a) => {
          const ok = g.live.some((l) => l.email === a.email)
          return (
            <div className="acct" key={a.email}>
              <span className="avatar">{a.email[0].toUpperCase()}</span>
              <div>
                <b>{a.email}</b>
                <small>{ok ? 'Gmail and Calendar connected' : 'Session ended'}</small>
              </div>
              {!ok && <button className="btn soft" disabled={busy} onClick={() => run(reconnect(a.email))}>Reconnect</button>}
              <button
                className="ghost" aria-label={`Remove ${a.email}`}
                onClick={() => (sync.account === a.email && setSyncAccount(''), disconnect(a.email))}
              >
                <Icon name="LogOut" />
              </button>
            </div>
          )
        })}
        {g.clientId ? (
          <button className="btn" disabled={busy} onClick={() => run(connect())}>
            {busy ? 'Waiting for Google…' : g.accounts.length ? 'Add another account' : 'Connect Google account'}
          </button>
        ) : (
          <p className="hint">
            Gmail, Calendar and sync need a one-time Google setup (free, about five minutes). It gives you a
            “client ID” to paste below; it stays on this device.
          </p>
        )}
        <div className="field">
          <input
            value={id} placeholder="Paste client ID" aria-label="Google client ID"
            autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => setId(e.target.value)}
          />
          <button className="btn soft" disabled={id.trim() === g.clientId} onClick={() => (setClientId(id), ui.toast('Client ID saved'))}>Save</button>
        </div>
        {err && <p className="err">{err}</p>}

        {g.accounts.length > 0 && (
          <>
            <h3>Sync between devices</h3>
            <p className="hint">
              Keeps this board the same on your phone, tablet and computer. It is stored in a private app folder in
              your own Google Drive; connect the same account on each device.
            </p>
            <label className="field">
              <select value={sync.account} aria-label="Sync account" onChange={(e) => setSyncAccount(e.target.value)}>
                <option value="">Off</option>
                {g.accounts.map((a) => <option key={a.email} value={a.email}>{a.email}</option>)}
              </select>
            </label>
            {sync.account && (
              <p className={sync.phase === 'error' ? 'err sync' : 'hint sync'} role="status">
                <Icon name={sync.phase === 'error' ? 'CloudOff' : sync.phase === 'syncing' ? 'RefreshCw' : 'CloudCheck'} size={14} />
                {sync.phase === 'error' ? sync.error : sync.phase === 'syncing' ? 'Syncing…' : sync.at ? `Synced ${ago(sync.at)}` : 'Waiting to sync'}
              </p>
            )}
          </>
        )}

        <h3>Your data</h3>
        <p className="hint">Everything is saved on this device. Download a backup to keep a copy or move it.</p>
        <div className="btns">
          <button className="btn soft" onClick={() => (saveFile('plan-backup.json', 'application/json', JSON.stringify(state)), ui.toast('Backup downloaded'))}>
            <Icon name="Download" size={14} /> Download backup
          </button>
          <button className="btn soft" onClick={() => file.current?.click()}><Icon name="Upload" size={14} /> Restore backup</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={(e) => importAll(e.target.files?.[0])} />
        </div>

        <h3 className="keys-only">Shortcuts</h3>
        <p className="hint keys keys-only"><kbd>/</kbd> search and capture <kbd>N</kbd> new card <kbd>⌘Z</kbd> undo <kbd>Esc</kbd> close</p>
      </div>
    </Sheet>
  )
}
