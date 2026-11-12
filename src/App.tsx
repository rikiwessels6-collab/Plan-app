import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { CATALOG, GROUPS, typeOf } from './catalog'
import { connect, disconnect, reconnect, setClientId, useGoogle } from './google'
import { Icon, SectionView } from './sections'
import { Ctx, loadState, reducer, saveState, seed, useApp } from './store'
import type { Card, State } from './types'

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open, close])
  return ref
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="ghost" aria-label="Close" onClick={onClose}><Icon name="X" size={18} /></button>
        </header>
        {children}
      </div>
    </div>
  )
}

function Picker({ onClose, spaceId }: { onClose: () => void; spaceId?: string }) {
  const { dispatch } = useApp()
  const [q, setQ] = useState('')
  const hits = CATALOG.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Sheet title="New card" onClose={onClose}>
      <div className="search">
        <Icon name="Search" />
        <input autoFocus value={q} placeholder="Search cards" aria-label="Search cards" onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="sheet-body">
        {GROUPS.map((g) => {
          const types = hits.filter((t) => t.group === g)
          if (!types.length) return null
          return (
            <div key={g}>
              <h3>{g}</h3>
              <div className="tiles">
                {types.map((t) => (
                  <button
                    key={t.id} className="tile"
                    onClick={() => {
                      dispatch({ t: 'addCard', type: t.id, spaceId })
                      onClose()
                    }}
                  >
                    <span><Icon name={t.icon} size={20} /></span>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        {!hits.length && <p className="hint">No card called that.</p>}
      </div>
    </Sheet>
  )
}

function Settings({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp()
  const g = useGoogle()
  const [id, setId] = useState(g.clientId)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const run = (p: Promise<void>) => {
    setBusy(true)
    setErr('')
    p.catch((e) => setErr(e.message)).finally(() => setBusy(false))
  }
  const exportAll = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' }))
    a.download = 'plan-backup.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importAll = async (f?: File) => {
    if (!f) return
    try {
      const s = JSON.parse(await f.text()) as State
      if (!Array.isArray(s.cards) || !Array.isArray(s.boards) || !s.boards.length) throw new Error()
      if (confirm('Replace everything on this device with the backup?')) dispatch({ t: 'load', state: s })
    } catch {
      setErr('That file is not a Plan backup.')
    }
  }

  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="sheet-body settings">
        <h3>Google accounts</h3>
        {!g.clientId && (
          <p className="hint">
            Gmail and Calendar need a Google OAuth client ID (free, one-time setup, steps in the README). Paste it
            here; it is stored only on this device.
          </p>
        )}
        <div className="row link">
          <input
            value={id} placeholder="xxxxxxxx.apps.googleusercontent.com" aria-label="Google client ID"
            onChange={(e) => setId(e.target.value)}
          />
          <button className="btn soft" disabled={id.trim() === g.clientId} onClick={() => setClientId(id)}>Save</button>
        </div>
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
              <button className="ghost" aria-label={`Remove ${a.email}`} onClick={() => disconnect(a.email)}><Icon name="LogOut" /></button>
            </div>
          )
        })}
        <button className="btn" disabled={busy || !g.clientId} onClick={() => run(connect())}>
          {g.accounts.length ? 'Add another Google account' : 'Connect Google account'}
        </button>
        {err && <p className="err">{err}</p>}

        <h3>Your data</h3>
        <p className="hint">Everything is saved on this device, in this browser. Download a backup to move it.</p>
        <div className="btns">
          <button className="btn soft" onClick={exportAll}><Icon name="Download" size={14} /> Download backup</button>
          <button className="btn soft" onClick={() => file.current?.click()}><Icon name="Upload" size={14} /> Restore backup</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={(e) => importAll(e.target.files?.[0])} />
        </div>
      </div>
    </Sheet>
  )
}

function CardView({ card, drag }: { card: Card; drag: React.MutableRefObject<string | null> }) {
  const { state, dispatch } = useApp()
  const type = typeOf(card.type)
  const space = state.spaces.find((s) => s.id === card.spaceId)
  const [menu, setMenu] = useState(false)
  const [over, setOver] = useState(false)
  const ref = useDismiss(menu, () => setMenu(false))
  const act = (a: Parameters<typeof dispatch>[0]) => {
    dispatch(a)
    setMenu(false)
  }
  return (
    <article
      className={`card t-${card.type}${type.bare ? ' bare' : ''}${over ? ' dragover' : ''}`}
      onDragOver={(e) => {
        if (drag.current && drag.current !== card.id) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (drag.current) dispatch({ t: 'moveCard', id: drag.current, beforeId: card.id })
        drag.current = null
      }}
    >
      <header
        draggable
        onDragStart={(e) => {
          drag.current = card.id
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', card.title)
        }}
        onDragEnd={() => (drag.current = null)}
      >
        <span className="badge" style={space ? { background: space.color, color: '#fff' } : undefined}>
          <Icon name={type.icon} size={14} />
        </span>
        <input
          className="title" value={card.title} aria-label="Card title"
          onChange={(e) => dispatch({ t: 'patchCard', id: card.id, patch: { title: e.target.value } })}
        />
        <div className="menuwrap" ref={ref}>
          <button className="ghost" aria-label="Card options" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Icon name="Ellipsis" />
          </button>
          {menu && (
            <div className="menu" role="menu">
              <div className="spacepick">
                <button
                  className={!card.spaceId ? 'on' : ''} aria-label="No space" title="No space"
                  onClick={() => act({ t: 'patchCard', id: card.id, patch: { spaceId: undefined } })}
                />
                {state.spaces.map((s) => (
                  <button
                    key={s.id} className={card.spaceId === s.id ? 'on' : ''} style={{ background: s.color }}
                    aria-label={`Space: ${s.name}`} title={s.name}
                    onClick={() => act({ t: 'patchCard', id: card.id, patch: { spaceId: s.id } })}
                  />
                ))}
              </div>
              <button role="menuitem" onClick={() => act({ t: 'moveCard', id: card.id, step: -1 })}><Icon name="ArrowUp" /> Move earlier</button>
              <button role="menuitem" onClick={() => act({ t: 'moveCard', id: card.id, step: 1 })}><Icon name="ArrowDown" /> Move later</button>
              <button role="menuitem" onClick={() => act({ t: 'dupCard', id: card.id })}><Icon name="Copy" /> Duplicate</button>
              <button
                role="menuitem" className="danger"
                onClick={() => confirm(`Delete "${card.title}"?`) && act({ t: 'removeCard', id: card.id })}
              >
                <Icon name="Trash" /> Delete
              </button>
            </div>
          )}
        </div>
      </header>
      {space && <div className="spacename">{space.name}</div>}
      {type.sections.map((s) => (
        <SectionView
          key={s.key} s={s} value={card.data[s.key]}
          onChange={(value) => dispatch({ t: 'setData', id: card.id, key: s.key, value })}
        />
      ))}
    </article>
  )
}

function BoardMenu() {
  const { state, dispatch } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const board = state.boards.find((b) => b.id === state.boardId)!
  return (
    <div className="menuwrap boardmenu" ref={ref}>
      <button className="boardname" aria-expanded={open} onClick={() => setOpen(!open)}>
        <img src="./logo.svg" alt="" width="28" height="28" />
        <span>{board.name}</span>
        <Icon name="ChevronDown" />
      </button>
      {open && (
        <div className="menu left" role="menu">
          {state.boards.map((b) => (
            <button
              role="menuitem" key={b.id} className={b.id === state.boardId ? 'on' : ''}
              onClick={() => (dispatch({ t: 'setBoard', id: b.id }), setOpen(false))}
            >
              {b.id === state.boardId ? <Icon name="Check" /> : <span className="gap" />} {b.name}
            </button>
          ))}
          <hr />
          <button role="menuitem" onClick={() => {
            const name = prompt('Name the new board')?.trim()
            if (name) dispatch({ t: 'addBoard', name })
            setOpen(false)
          }}><Icon name="Plus" /> New board</button>
          <button role="menuitem" onClick={() => {
            const name = prompt('Rename this board', board.name)?.trim()
            if (name) dispatch({ t: 'renameBoard', name })
            setOpen(false)
          }}><Icon name="Pencil" /> Rename</button>
          {state.boards.length > 1 && (
            <button role="menuitem" className="danger" onClick={() => {
              if (confirm(`Delete "${board.name}" and all its cards?`)) dispatch({ t: 'removeBoard' })
              setOpen(false)
            }}><Icon name="Trash" /> Delete board</button>
          )}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, null as unknown as State)
  const [picker, setPicker] = useState(false)
  const [settings, setSettings] = useState(false)
  const [filter, setFilter] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const [saveErr, setSaveErr] = useState(false)
  const drag = useRef<string | null>(null)

  useEffect(() => {
    loadState().then((s) => dispatch({ t: 'load', state: s ?? seed() }))
  }, [])
  useEffect(() => {
    if (!state) return
    const t = setTimeout(() => saveState(state).then(() => setSaveErr(false), () => setSaveErr(true)), 300)
    return () => clearTimeout(t)
  }, [state])

  const ctx = useMemo(() => ({ state, dispatch, openSettings: () => setSettings(true) }), [state])
  if (!state) return null

  const space = state.spaces.find((s) => s.id === filter)
  const needle = q.trim().toLowerCase()
  const cards = state.cards.filter(
    (c) =>
      c.boardId === state.boardId &&
      (!space || c.spaceId === space.id) &&
      (!needle ||
        c.title.toLowerCase().includes(needle) ||
        // search what people typed, not embedded photo data
        JSON.stringify(c.data, (_, v) => (typeof v === 'string' && v.startsWith('data:') ? '' : v)).toLowerCase().includes(needle)),
  )

  return (
    <Ctx.Provider value={ctx}>
      <div className="top">
        <div className="bar1">
          <BoardMenu />
          <div className="tools">
            <button className="ghost" aria-label="Search" aria-pressed={searching} onClick={() => (setSearching(!searching), setQ(''))}>
              <Icon name="Search" size={18} />
            </button>
            <div className="zoom" role="group" aria-label="Columns">
              <button className="ghost" aria-label="Fewer columns" onClick={() => dispatch({ t: 'setCols', cols: state.cols - 1 })}><Icon name="Minus" /></button>
              <b>{state.cols}</b>
              <button className="ghost" aria-label="More columns" onClick={() => dispatch({ t: 'setCols', cols: state.cols + 1 })}><Icon name="Plus" /></button>
            </div>
            <button className="ghost" aria-label="Settings" onClick={() => setSettings(true)}><Icon name="Settings" size={18} /></button>
          </div>
        </div>
        {searching && (
          <div className="search">
            <Icon name="Search" />
            <input autoFocus value={q} placeholder="Search this board" aria-label="Search this board" onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
        <nav className="chips" aria-label="Spaces">
          <button className={!space ? 'on' : ''} onClick={() => setFilter(null)}>All</button>
          {state.spaces.map((s) => (
            <button key={s.id} className={space?.id === s.id ? 'on' : ''} onClick={() => setFilter(s.id)}>
              <i style={{ background: s.color }} /> {s.name}
            </button>
          ))}
          <button className="quiet" onClick={() => {
            const name = prompt('Name the new space (for example: Home, Work)')?.trim()
            if (name) dispatch({ t: 'addSpace', name })
          }}><Icon name="Plus" size={14} /> Space</button>
          {space && (
            <button className="quiet" onClick={() => {
              if (confirm(`Remove the space "${space.name}"? Its cards stay on the board.`)) {
                dispatch({ t: 'removeSpace', id: space.id })
                setFilter(null)
              }
            }}><Icon name="Trash" size={14} /> Remove “{space.name}”</button>
          )}
        </nav>
        {saveErr && <p className="err banner">Could not save to this device. Download a backup from Settings.</p>}
      </div>

      <main className="board" style={{ columns: `150px ${state.cols}` }}>
        {cards.map((c) => <CardView key={c.id} card={c} drag={drag} />)}
      </main>
      {!cards.length && (
        <div className="empty">
          <p>{needle ? 'No cards match that search.' : space ? `Nothing in ${space.name} yet.` : 'This board is empty.'}</p>
          {!needle && <button className="btn" onClick={() => setPicker(true)}>Add a card</button>}
        </div>
      )}

      <button className="fab" aria-label="New card" onClick={() => setPicker(true)}><Icon name="Plus" size={24} /></button>
      {picker && <Picker onClose={() => setPicker(false)} spaceId={space?.id} />}
      {settings && <Settings onClose={() => setSettings(false)} />}
    </Ctx.Provider>
  )
}
