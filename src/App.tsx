import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { CATALOG, GROUPS, typeOf } from './catalog'
import { useCardDrag, useFlip } from './drag'
import { connect, disconnect, reconnect, setClientId, useGoogle } from './google'
import { Icon, SectionView } from './sections'
import { Ctx, DispatchCtx, loadState, reducer, saveState, starter, useApp, useDispatch, type Starter } from './store'
import { uid, type Card, type Space, type State } from './types'
import { Sheet, UIProvider, useUI } from './ui'

export type Theme = 'system' | 'light' | 'dark'
export function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#151412' : '#f3f0e8')
}
const savedTheme = () => (localStorage.getItem('plan.theme') as Theme | null) ?? 'system'

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

function Picker({ onClose, onAdd }: { onClose: () => void; onAdd: (type: string) => void }) {
  const [q, setQ] = useState('')
  const hits = CATALOG.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Sheet title="New card" onClose={onClose}>
      {(close) => (
        <>
          <form
            className="search" role="search"
            onSubmit={(e) => {
              e.preventDefault()
              if (hits.length) (onAdd(hits[0].id), close())
            }}
          >
            <Icon name="Search" />
            <input autoFocus={matchMedia('(pointer: fine)').matches} value={q} placeholder="Search 57 cards" aria-label="Search cards" enterKeyHint="go" onChange={(e) => setQ(e.target.value)} />
          </form>
          <div className="sheet-body">
            {GROUPS.map((g) => {
              const types = hits.filter((t) => t.group === g)
              if (!types.length) return null
              return (
                <div key={g}>
                  <h3>{g}</h3>
                  <div className="tiles">
                    {types.map((t) => (
                      <button key={t.id} className="tile" onClick={() => (onAdd(t.id), close())}>
                        <span><Icon name={t.icon} size={20} /></span>
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
            {!hits.length && <p className="hint none">No card called “{q.trim()}”.</p>}
          </div>
        </>
      )}
    </Sheet>
  )
}

function Settings({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp()
  const ui = useUI()
  const g = useGoogle()
  const [id, setId] = useState(g.clientId)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [theme, setTheme] = useState<Theme>(savedTheme)
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
  const exportAll = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' }))
    a.download = 'plan-backup.json'
    a.click()
    URL.revokeObjectURL(a.href)
    ui.toast('Backup downloaded')
  }
  const importAll = async (f?: File) => {
    if (!f) return
    try {
      const s = JSON.parse(await f.text()) as State
      if (!Array.isArray(s.cards) || !Array.isArray(s.boards) || !s.boards.length) throw new Error()
      if (await ui.confirm({ title: 'Restore this backup?', body: 'It replaces everything currently on this device.', cta: 'Restore', danger: true })) {
        dispatch({ t: 'load', state: s })
        ui.toast('Backup restored')
      }
    } catch {
      setErr('That file is not a Plan backup.')
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
              <button className="ghost" aria-label={`Remove ${a.email}`} onClick={() => disconnect(a.email)}><Icon name="LogOut" /></button>
            </div>
          )
        })}
        {g.clientId ? (
          <button className="btn" disabled={busy} onClick={() => run(connect())}>
            {busy ? 'Waiting for Google…' : g.accounts.length ? 'Add another account' : 'Connect Google account'}
          </button>
        ) : (
          <p className="hint">
            Gmail and Calendar need a Google client ID: a free, one-time setup described in the README. Paste it
            below. It stays on this device.
          </p>
        )}
        <div className="field">
          <input
            value={id} placeholder="Client ID ending .apps.googleusercontent.com" aria-label="Google client ID"
            autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => setId(e.target.value)}
          />
          <button className="btn soft" disabled={id.trim() === g.clientId} onClick={() => (setClientId(id), ui.toast('Client ID saved'))}>Save</button>
        </div>
        {err && <p className="err">{err}</p>}

        <h3>Your data</h3>
        <p className="hint">Everything is saved on this device. Download a backup to keep a copy or move it.</p>
        <div className="btns">
          <button className="btn soft" onClick={exportAll}><Icon name="Download" size={14} /> Download backup</button>
          <button className="btn soft" onClick={() => file.current?.click()}><Icon name="Upload" size={14} /> Restore backup</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={(e) => importAll(e.target.files?.[0])} />
        </div>

        <h3>Shortcuts</h3>
        <p className="hint keys"><kbd>N</kbd> new card <kbd>/</kbd> search <kbd>Esc</kbd> close</p>
      </div>
    </Sheet>
  )
}

function CardBody({ card }: { card: Card }) {
  const dispatch = useDispatch()
  return (
    <>
      {typeOf(card.type).sections.map((s) => (
        <SectionView
          key={s.key} s={s} value={card.data[s.key]}
          onChange={(value) => dispatch({ t: 'setData', id: card.id, key: s.key, value })}
        />
      ))}
    </>
  )
}

interface CardProps {
  card: Card
  index: number
  spaces: Space[]
  onOpen: (id: string) => void
  onDelete: (card: Card) => void
  startDrag: (e: React.PointerEvent<HTMLElement>, id: string) => void
}
const CardView = memo(function CardView({ card, index, spaces, onOpen, onDelete, startDrag }: CardProps) {
  const dispatch = useDispatch()
  const type = typeOf(card.type)
  const space = spaces.find((s) => s.id === card.spaceId)
  const [menu, setMenu] = useState(false)
  const ref = useDismiss(menu, () => setMenu(false))
  const act = (a: Parameters<typeof dispatch>[0]) => {
    dispatch(a)
    setMenu(false)
  }
  return (
    <article
      className={`card t-${card.type}${type.bare ? ' bare' : ''}${menu ? ' menu-open' : ''}`}
      data-card={card.id} style={{ '--i': Math.min(index, 14) } as React.CSSProperties}
    >
      <header onPointerDown={(e) => startDrag(e, card.id)}>
        <button
          className="badge" style={space ? { background: space.color, color: '#fff' } : undefined}
          aria-label={`Open ${card.title}`} title="Open" onClick={() => onOpen(card.id)}
        >
          <Icon name={type.icon} size={14} />
        </button>
        <input
          className="title" value={card.title} aria-label="Card title" placeholder="Untitled"
          onChange={(e) => dispatch({ t: 'patchCard', id: card.id, patch: { title: e.target.value } })}
        />
        <div className="menuwrap" ref={ref}>
          <button className="ghost" aria-label="Card options" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Icon name="Ellipsis" />
          </button>
          {menu && (
            <div className="menu" role="menu">
              <button role="menuitem" onClick={() => (setMenu(false), onOpen(card.id))}><Icon name="Maximize2" /> Open</button>
              <hr />
              <div className="spacepick" role="group" aria-label="Space">
                <button
                  className={!card.spaceId ? 'on' : ''} aria-label="No space" title="No space"
                  onClick={() => act({ t: 'patchCard', id: card.id, patch: { spaceId: undefined } })}
                />
                {spaces.map((s) => (
                  <button
                    key={s.id} className={card.spaceId === s.id ? 'on' : ''} style={{ background: s.color }}
                    aria-label={`Space: ${s.name}`} title={s.name}
                    onClick={() => act({ t: 'patchCard', id: card.id, patch: { spaceId: s.id } })}
                  />
                ))}
              </div>
              <hr />
              <button role="menuitem" onClick={() => act({ t: 'moveCard', id: card.id, step: -1 })}><Icon name="ArrowUp" /> Move earlier</button>
              <button role="menuitem" onClick={() => act({ t: 'moveCard', id: card.id, step: 1 })}><Icon name="ArrowDown" /> Move later</button>
              <button role="menuitem" onClick={() => act({ t: 'dupCard', id: card.id })}><Icon name="Copy" /> Duplicate</button>
              <button role="menuitem" className="danger" onClick={() => (setMenu(false), onDelete(card))}><Icon name="Trash" /> Delete</button>
            </div>
          )}
        </div>
      </header>
      {space && <div className="spacename">{space.name}</div>}
      <CardBody card={card} />
    </article>
  )
})

function CardSheet({ card, space, onClose }: { card: Card; space?: Space; onClose: () => void }) {
  const dispatch = useDispatch()
  const type = typeOf(card.type)
  return (
    <Sheet
      title={card.title} onClose={onClose} wide
      head={
        <div className="sheet-title">
          <span className="badge" style={space ? { background: space.color, color: '#fff' } : undefined}><Icon name={type.icon} size={15} /></span>
          <input
            className="title" value={card.title} aria-label="Card title" placeholder="Untitled"
            onChange={(e) => dispatch({ t: 'patchCard', id: card.id, patch: { title: e.target.value } })}
          />
        </div>
      }
    >
      <div className={`sheet-body opened t-${card.type}`}>
        <CardBody card={card} />
      </div>
    </Sheet>
  )
}

function BoardMenu() {
  const { state, dispatch } = useApp()
  const ui = useUI()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const board = state.boards.find((b) => b.id === state.boardId)!
  return (
    <div className="menuwrap boardmenu" ref={ref}>
      <button className="boardname" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <span>{board.name}</span>
        <Icon name="ChevronDown" size={18} />
      </button>
      {open && (
        <div className="menu left" role="menu">
          {state.boards.map((b) => (
            <button role="menuitem" key={b.id} onClick={() => (dispatch({ t: 'setBoard', id: b.id }), setOpen(false))}>
              {b.id === state.boardId ? <Icon name="Check" /> : <span className="gap" />} {b.name}
            </button>
          ))}
          <hr />
          <button role="menuitem" onClick={async () => {
            setOpen(false)
            const name = await ui.ask({ title: 'New board', placeholder: 'Name, for example Work', cta: 'Create' })
            if (name) dispatch({ t: 'addBoard', name })
          }}><Icon name="Plus" /> New board</button>
          <button role="menuitem" onClick={async () => {
            setOpen(false)
            const name = await ui.ask({ title: 'Rename board', initial: board.name, cta: 'Rename' })
            if (name) dispatch({ t: 'renameBoard', name })
          }}><Icon name="Pencil" /> Rename</button>
          {state.boards.length > 1 && (
            <button role="menuitem" className="danger" onClick={async () => {
              setOpen(false)
              const n = state.cards.filter((c) => c.boardId === board.id).length
              if (await ui.confirm({
                title: `Delete “${board.name}”?`, cta: 'Delete board', danger: true,
                body: n ? `Its ${n} card${n > 1 ? 's' : ''} will be deleted too. This cannot be undone.` : 'This cannot be undone.',
              })) dispatch({ t: 'removeBoard' })
            }}><Icon name="Trash" /> Delete board</button>
          )}
        </div>
      )}
    </div>
  )
}

const STARTS: { id: Starter; name: string; text: string; icon: string }[] = [
  { id: 'life', name: 'My life', text: 'Today, habits, goals, meals, money', icon: 'Sun' },
  { id: 'work', name: 'Work', text: 'Projects, meetings, inbox, calendar', icon: 'Briefcase' },
  { id: 'home', name: 'Home and family', text: 'Meals, shopping, jobs, birthdays', icon: 'House' },
  { id: 'blank', name: 'Blank board', text: 'Start empty and add your own cards', icon: 'Plus' },
]
function Welcome({ onStart }: { onStart: (k: Starter) => void }) {
  const [pick, setPick] = useState<Starter>('life')
  return (
    <main className="welcome">
      <div>
        <img src="./logo.svg" alt="" width="56" height="56" />
        <h1>Everything you’re planning, on one board.</h1>
        <p>Tasks, notes, photos, money, mail and calendar side by side. Pick a starting point; you can change every card later.</p>
        <div className="starts" role="radiogroup" aria-label="Starting point">
          {STARTS.map((s) => (
            <button key={s.id} role="radio" aria-checked={pick === s.id} onClick={() => setPick(s.id)}>
              <span><Icon name={s.icon} size={18} /></span>
              <b>{s.name}</b>
              <small>{s.text}</small>
            </button>
          ))}
        </div>
        <button className="btn big" onClick={() => onStart(pick)}>Create my board</button>
        <small className="hint">Saved privately on this device. No account needed.</small>
      </div>
    </main>
  )
}

function Board() {
  const { state, dispatch } = useApp()
  const ui = useUI()
  const [picker, setPicker] = useState(false)
  const [settings, setSettings] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const [scrolled, setScrolled] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)
  const boardRef = useRef<HTMLElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const startDrag = useCardDrag(dispatch)

  useEffect(() => {
    const on = () => setScrolled(scrollY > 4)
    addEventListener('scroll', on, { passive: true })
    return () => removeEventListener('scroll', on)
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [role=dialog], [role=alertdialog]')
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === 'n' && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        setPicker(true)
      } else if (e.key === '/' && !typing) {
        e.preventDefault()
        setSearching(true)
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  // bring a newly added card into view and make it obvious which one it is
  useEffect(() => {
    if (!fresh) return
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-card="${fresh}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    el.dataset.fresh = '1'
    if (matchMedia('(pointer: fine)').matches)
      el.querySelector<HTMLElement>('[data-row], .sec textarea, .sec input:not([type=file])')?.focus({ preventScroll: true })
    const t = setTimeout(() => (delete el.dataset.fresh, setFresh(null)), 1400)
    return () => clearTimeout(t)
  }, [fresh])

  const onOpen = useCallback((id: string) => setOpenId(id), [])
  const onDelete = useCallback(
    (card: Card) => {
      const index = stateRef.current.cards.findIndex((c) => c.id === card.id)
      dispatch({ t: 'removeCard', id: card.id })
      ui.toast(`“${card.title || 'Untitled'}” deleted`, 'Undo', () => dispatch({ t: 'restoreCard', card, index }))
    },
    [dispatch, ui],
  )

  const space = state.spaces.find((s) => s.id === filter)
  const needle = q.trim().toLowerCase()
  const cards = useMemo(
    () =>
      state.cards.filter(
        (c) =>
          c.boardId === state.boardId &&
          (!space || c.spaceId === space.id) &&
          (!needle ||
            c.title.toLowerCase().includes(needle) ||
            // search what people typed, not embedded photo data
            JSON.stringify(c.data, (_k, v) => (typeof v === 'string' && v.startsWith('data:') ? '' : v)).toLowerCase().includes(needle)),
      ),
    [state.cards, state.boardId, space, needle],
  )
  useFlip(boardRef, cards.map((c) => c.id).join() + state.cols)

  const add = (type: string) => {
    const id = uid()
    dispatch({ t: 'addCard', id, type, spaceId: space?.id })
    setQ('')
    setFresh(id)
  }
  const opened = state.cards.find((c) => c.id === openId)
  const total = state.cards.filter((c) => c.boardId === state.boardId).length

  return (
    <>
      <div className={`top${scrolled ? ' scrolled' : ''}`}>
        <div className="bar1">
          <div className="brand">
            <img src="./logo.svg" alt="" width="34" height="34" />
            <div>
              <small>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</small>
              <BoardMenu />
            </div>
          </div>
          <div className="tools">
            <button className="ghost" aria-label="Search" aria-pressed={searching} onClick={() => (setSearching(!searching), setQ(''))}>
              <Icon name="Search" size={18} />
            </button>
            <div className="zoom" role="group" aria-label="Columns">
              <button className="ghost" aria-label="Fewer columns" disabled={state.cols <= 1} onClick={() => dispatch({ t: 'setCols', cols: state.cols - 1 })}><Icon name="Minus" /></button>
              <b aria-live="polite">{state.cols}</b>
              <button className="ghost" aria-label="More columns" disabled={state.cols >= 8} onClick={() => dispatch({ t: 'setCols', cols: state.cols + 1 })}><Icon name="Plus" /></button>
            </div>
            <button className="ghost" aria-label="Settings" onClick={() => setSettings(true)}><Icon name="Settings" size={18} /></button>
          </div>
        </div>
        {searching && (
          <div className="search">
            <Icon name="Search" />
            <input
              autoFocus value={q} placeholder="Search this board" aria-label="Search this board"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (setSearching(false), setQ(''))}
            />
            {q && <button className="ghost" aria-label="Clear search" onClick={() => setQ('')}><Icon name="X" size={15} /></button>}
          </div>
        )}
        <nav className="chips" aria-label="Spaces">
          <button aria-pressed={!space} onClick={() => setFilter(null)}>All <em>{total}</em></button>
          {state.spaces.map((s) => (
            <button key={s.id} aria-pressed={space?.id === s.id} onClick={() => setFilter(space?.id === s.id ? null : s.id)}>
              <i style={{ background: s.color }} /> {s.name}
            </button>
          ))}
          <button className="quiet" onClick={async () => {
            const name = await ui.ask({ title: 'New space', body: 'Spaces group cards by area of life and colour them.', placeholder: 'For example Home', cta: 'Add' })
            if (name) dispatch({ t: 'addSpace', name })
          }}><Icon name="Plus" size={14} /> Space</button>
          {space && (
            <button className="quiet" onClick={async () => {
              if (await ui.confirm({ title: `Remove “${space.name}”?`, body: 'Its cards stay on the board.', cta: 'Remove space', danger: true })) {
                dispatch({ t: 'removeSpace', id: space.id })
                setFilter(null)
              }
            }}><Icon name="Trash" size={14} /> Remove</button>
          )}
        </nav>
      </div>

      <main className="board" ref={boardRef} style={{ columns: `150px ${state.cols}` }}>
        {cards.map((c, i) => (
          <CardView key={c.id} card={c} index={i} spaces={state.spaces} onOpen={onOpen} onDelete={onDelete} startDrag={startDrag} />
        ))}
      </main>
      {!cards.length && (
        <div className="empty">
          <span><Icon name={needle ? 'Search' : 'Plus'} size={22} /></span>
          <h2>{needle ? 'Nothing matches' : space ? `Nothing in ${space.name} yet` : 'A fresh board'}</h2>
          <p>{needle ? `No card mentions “${q.trim()}”.` : 'Add a card to get started. There are 57 to choose from.'}</p>
          {!needle && <button className="btn" onClick={() => setPicker(true)}>Add a card</button>}
        </div>
      )}

      <button className="fab" aria-label="New card" title="New card (N)" onClick={() => setPicker(true)}><Icon name="Plus" size={24} /></button>
      {picker && <Picker onClose={() => setPicker(false)} onAdd={add} />}
      {settings && <Settings onClose={() => setSettings(false)} />}
      {opened && <CardSheet card={opened} space={state.spaces.find((s) => s.id === opened.spaceId)} onClose={() => setOpenId(null)} />}
      <SettingsBridge open={() => setSettings(true)} />
    </>
  )
}

// lets cards deep in the tree (the "Connect Google" prompt) open Settings
let openSettingsFn = () => {}
function SettingsBridge({ open }: { open: () => void }) {
  openSettingsFn = open
  return null
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, null as unknown as State)
  const [ready, setReady] = useState(false)
  const [saveErr, setSaveErr] = useState(false)

  useEffect(() => {
    loadState().then((s) => {
      if (s) dispatch({ t: 'load', state: s })
      setReady(true)
    })
  }, [])
  useEffect(() => {
    if (!state) return
    const t = setTimeout(() => saveState(state).then(() => setSaveErr(false), () => setSaveErr(true)), 300)
    return () => clearTimeout(t)
  }, [state])

  const ctx = useMemo(() => ({ state, dispatch, openSettings: () => openSettingsFn() }), [state])
  if (!ready) return null
  return (
    <UIProvider>
      {!state ? (
        <Welcome onStart={(k) => dispatch({ t: 'load', state: starter(k) })} />
      ) : (
        <DispatchCtx.Provider value={dispatch}>
          <Ctx.Provider value={ctx}>
            <Board />
            {saveErr && <p className="err banner" role="alert">Could not save to this device. Download a backup from Settings.</p>}
          </Ctx.Provider>
        </DispatchCtx.Provider>
      )}
    </UIProvider>
  )
}
