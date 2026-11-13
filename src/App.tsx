import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { CATALOG, GROUPS, typeOf } from './catalog'
import { chime, notify, saveFile, setBadge, shareCard } from './device'
import { connect, reconnect, useGoogle } from './google'
import { useCardDrag, useFlip } from './drag'
import { Palette, type Command } from './palette'
import { Icon, SectionView, shrink } from './sections'
import { Settings } from './settings'
import { Ctx, DispatchCtx, emptyHistory, loadState, reducer, saveState, starter, today, useApp, useDispatch, type Action, type Starter } from './store'
import { pull, setSyncAccount, useSync } from './sync'
import { uid, type Card, type Space, type State } from './types'
import { Guard, Sheet, UIProvider, useUI } from './ui'

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches

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
            <input
              autoFocus={matchMedia('(pointer: fine)').matches} value={q} placeholder={`Search ${CATALOG.length} cards`}
              aria-label="Search cards" enterKeyHint="go" onChange={(e) => setQ(e.target.value)}
            />
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

const STARTS: { id: Starter; name: string; text: string; icon: string }[] = [
  { id: 'life', name: 'My life', text: 'Today, habits, goals, meals, money', icon: 'Sun' },
  { id: 'work', name: 'Work', text: 'Projects, meetings, inbox, calendar', icon: 'Briefcase' },
  { id: 'home', name: 'Home and family', text: 'Meals, shopping, jobs, birthdays', icon: 'House' },
  { id: 'blank', name: 'Blank board', text: 'Start empty and add your own cards', icon: 'Plus' },
]
function Starts({ pick, setPick }: { pick: Starter; setPick: (s: Starter) => void }) {
  return (
    <div className="starts" role="radiogroup" aria-label="Starting point">
      {STARTS.map((s) => (
        <button type="button" key={s.id} role="radio" aria-checked={pick === s.id} onClick={() => setPick(s.id)}>
          <span><Icon name={s.icon} size={18} /></span>
          <b>{s.name}</b>
          <small>{s.text}</small>
        </button>
      ))}
    </div>
  )
}

function NewBoard({ onClose }: { onClose: () => void }) {
  const dispatch = useDispatch()
  const [name, setName] = useState('')
  const [pick, setPick] = useState<Starter>('blank')
  return (
    <Sheet title="New board" onClose={onClose}>
      {(close) => (
        <form
          className="sheet-body newboard"
          onSubmit={(e) => {
            e.preventDefault()
            dispatch({ t: 'addBoard', name: name.trim() || STARTS.find((s) => s.id === pick)!.name, kind: pick })
            scrollTo(0, 0)
            close()
          }}
        >
          <div className="field">
            <input autoFocus value={name} placeholder="Name, for example Wedding or Q3 launch" aria-label="Board name" onChange={(e) => setName(e.target.value)} />
          </div>
          <h3>Start from</h3>
          <Starts pick={pick} setPick={setPick} />
          <button className="btn big">Create board</button>
        </form>
      )}
    </Sheet>
  )
}

function Welcome({ onStart, onLoad }: { onStart: (k: Starter) => void; onLoad: (s: State) => void }) {
  const [pick, setPick] = useState<Starter>('life')
  const g = useGoogle()
  const ui = useUI()
  const [busy, setBusy] = useState(false)
  // someone who already uses Plan on another device: sign in and bring that board here
  const bring = async () => {
    setBusy(true)
    try {
      if (!g.live.length) await connect()
      const email = (JSON.parse(localStorage.getItem('plan.google.accounts') ?? '[]') as string[]).slice(-1)[0]
      const board = email ? await pull(email) : null
      if (board) {
        setSyncAccount(email)
        onLoad(board)
      } else ui.toast('No board is synced to that account yet')
    } catch (e: any) {
      ui.toast(e?.message || 'Could not reach Google')
    }
    setBusy(false)
  }
  return (
    <main className="welcome">
      <div>
        <img src="./logo.svg" alt="" width="56" height="56" />
        <h1>Everything you’re planning, on one board.</h1>
        <p>Tasks, notes, photos, money, mail and calendar side by side. Pick a starting point; you can change every card later.</p>
        <Starts pick={pick} setPick={setPick} />
        <button className="btn big" onClick={() => onStart(pick)}>Create my board</button>
        {g.clientId && (
          <button className="btn soft big" disabled={busy} onClick={bring}>
            {busy ? 'Looking for your board…' : 'I already have a board: sync it here'}
          </button>
        )}
        <small className="hint">Saved privately on this device. No account needed.</small>
      </div>
    </main>
  )
}

function CardBody({ card }: { card: Card }) {
  const dispatch = useDispatch()
  return (
    // if one card's contents cannot be shown, only that card says so; the board carries on
    <Guard resetKey={card.data} fallback={(retry) => (
      <div className="broken">
        <p className="hint">This card could not be shown.</p>
        <button className="btn soft" onClick={retry}>Try again</button>
      </div>
    )}>
      {typeOf(card.type).sections.map((s) => (
        <SectionView
          key={s.key} s={s} value={card.data[s.key]} title={card.title}
          onChange={(value) => dispatch({ t: 'setData', id: card.id, key: s.key, value })}
        />
      ))}
    </Guard>
  )
}
const openCount = (card: Card) =>
  typeOf(card.type).sections.reduce((n, s) => n + (s.kind === 'checklist' ? ((card.data[s.key] as any[]) ?? []).filter((i) => i.text && !i.done).length : 0), 0)
const hasDone = (card: Card) =>
  typeOf(card.type).sections.some((s) => s.kind === 'checklist' && (card.data[s.key] as any[] | undefined)?.some((i) => i.done))

interface CardProps {
  card: Card
  index: number
  spaces: Space[]
  onOpen: (id: string) => void
  onDelete: (card: Card) => void
  startDrag: (e: React.PointerEvent<HTMLElement>, id: string) => void
  /** today's date: changing it redraws the card, so "in 3 days" and today markers stay right overnight */
  day: string
}
const CardView = memo(function CardView({ card, index, spaces, onOpen, onDelete, startDrag, day }: CardProps) {
  const dispatch = useDispatch()
  const ui = useUI()
  const type = typeOf(card.type)
  const space = spaces.find((s) => s.id === card.spaceId)
  const [menu, setMenu] = useState(false)
  const ref = useDismiss(menu, () => setMenu(false))
  const act = (a: Action) => {
    dispatch(a)
    setMenu(false)
  }
  const share = async () => {
    setMenu(false)
    const r = await shareCard(card)
    if (r === 'copied') ui.toast('Copied as text')
    else if (r === 'failed') ui.toast('Could not share this card')
  }
  return (
    <article
      className={`card t-${card.type}${type.bare ? ' bare' : ''}${menu ? ' menu-open' : ''}`}
      data-card={card.id} data-day={day} data-color={card.data.color || undefined} style={{ '--i': Math.min(index, 14) } as React.CSSProperties}
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
              <button role="menuitem" onClick={share}><Icon name="Share" /> Share</button>
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
              {hasDone(card) && <button role="menuitem" onClick={() => act({ t: 'clearDone', id: card.id })}><Icon name="ListX" /> Clear finished</button>}
              {!type.bare && (
                <button role="menuitem" onClick={() => act({ t: 'setData', id: card.id, key: '_c', value: card.data._c ? undefined : true })}>
                  <Icon name={card.data._c ? 'ChevronsUpDown' : 'ChevronsDownUp'} /> {card.data._c ? 'Expand' : 'Collapse'}
                </button>
              )}
              <button role="menuitem" onClick={() => act({ t: 'moveCard', id: card.id, step: -1 })}><Icon name="ArrowUp" /> Move earlier</button>
              <button role="menuitem" onClick={() => act({ t: 'moveCard', id: card.id, step: 1 })}><Icon name="ArrowDown" /> Move later</button>
              <button role="menuitem" onClick={() => act({ t: 'dupCard', id: card.id })}><Icon name="Copy" /> Duplicate</button>
              <button role="menuitem" className="danger" onClick={() => (setMenu(false), onDelete(card))}><Icon name="Trash" /> Delete</button>
            </div>
          )}
        </div>
      </header>
      {space && <div className="spacename">{space.name}</div>}
      {card.data._c && !type.bare ? (
        <button className="folded" onClick={() => dispatch({ t: 'setData', id: card.id, key: '_c', value: undefined })}>
          {openCount(card) ? `${openCount(card)} to do` : 'Show'} <Icon name="ChevronDown" size={14} />
        </button>
      ) : (
        <CardBody card={card} />
      )}
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
      <div className={`sheet-body opened t-${card.type}`} data-color={card.data.color || undefined}>
        <CardBody card={card} />
      </div>
    </Sheet>
  )
}

function BoardMenu({ onNew }: { onNew: () => void }) {
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
            <button role="menuitem" key={b.id} onClick={() => (dispatch({ t: 'setBoard', id: b.id }), scrollTo(0, 0), setOpen(false))}>
              {b.id === state.boardId ? <Icon name="Check" /> : <span className="gap" />} {b.name}
              <em>{state.cards.filter((c) => c.boardId === b.id).length}</em>
            </button>
          ))}
          <hr />
          <button role="menuitem" onClick={() => (setOpen(false), onNew())}><Icon name="Plus" /> New board</button>
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
                body: n ? `Its ${n} card${n > 1 ? 's' : ''} will be deleted too.` : undefined,
              })) {
                const cards = state.cards.filter((c) => c.boardId === board.id)
                dispatch({ t: 'removeBoard' })
                ui.toast(`“${board.name}” deleted`, 'Undo', () => dispatch({ t: 'restoreBoard', board, cards }))
              }
            }}><Icon name="Trash" /> Delete board</button>
          )}
        </div>
      )}
    </div>
  )
}

type Overlay = null | 'picker' | 'settings' | 'palette' | 'newboard'

function Board({ state, dispatch, canUndo, canRedo }: { state: State; dispatch: (a: Action) => void; canUndo: boolean; canRedo: boolean }) {
  const ui = useUI()
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const [target, setTarget] = useState<{ id: string; fresh: boolean } | null>(null)
  const [dropping, setDropping] = useState(false)
  const boardRef = useRef<HTMLElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const startDrag = useCardDrag(dispatch)
  useSync(state, dispatch)

  useEffect(() => {
    const on = () => setScrolled(scrollY > 4)
    addEventListener('scroll', on, { passive: true })
    return () => removeEventListener('scroll', on)
  }, [])

  // keyboard: / or Cmd-K search, N new card, Cmd-Z undo
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = !!el.closest('input, textarea, select')
      const modal = !!el.closest('[role=dialog], [role=alertdialog]')
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') (e.preventDefault(), setOverlay('palette'))
      else if (modal || typing) return
      else if (e.key === '/') (e.preventDefault(), setOverlay('palette'))
      else if (e.key === 'n' && !mod) (e.preventDefault(), setOverlay('picker'))
      else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ t: e.shiftKey ? 'redo' : 'undo' })
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [dispatch])

  // a new day: Today and Day plan cards drop what was finished and keep the rest
  const [day, setDay] = useState(today)
  useEffect(() => {
    const tick = () => setDay(today())
    const iv = setInterval(tick, 30000)
    const wake = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', wake)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])
  useEffect(() => {
    const stale = state.cards.filter((c) => (c.type === 'today' || c.type === 'day') && c.data._day !== day)
    if (!stale.length) return
    const done = (c: Card) => typeOf(c.type).sections.reduce((m, s) => m + (s.kind === 'checklist' ? ((c.data[s.key] as any[]) ?? []).filter((i) => i.done).length : 0), 0)
    const had = stale.filter((c) => c.data._day && done(c))
    const cleared = had.reduce((n, c) => n + done(c), 0)
    dispatch({ t: 'rollover', day })
    // Undo puts back exactly the cards as they were (marked as already rolled over, so they are not cleared again)
    if (cleared)
      ui.toast(`New day. ${cleared} finished item${cleared > 1 ? 's' : ''} cleared.`, 'Undo', () =>
        dispatch({ t: 'putCards', cards: had.map((c) => ({ ...c, data: { ...c.data, _day: day } })) }),
      )
  }, [state.cards, day, dispatch, ui])

  // focus timers finish here rather than inside their card, so they still finish when the card is
  // collapsed, filtered out or on another board
  useEffect(() => {
    const running = state.cards.filter((c) => c.type === 'timer' && c.data.timer?.endsAt)
    if (!running.length) return
    const finish = () => {
      for (const c of running) {
        const t = c.data.timer
        if (t.endsAt > Date.now()) continue
        const e = new Date(t.endsAt)
        const on = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`
        dispatch({ t: 'setData', id: c.id, key: 'timer', value: { ...t, endsAt: undefined, left: undefined, done: { ...t.done, [on]: (t.done?.[on] ?? 0) + 1 } } })
        if (Date.now() - t.endsAt < 60000) {
          chime()
          notify(`${c.title || 'Focus'}: time is up`, `${t.mins ?? 25} minutes done. Take a break.`)
        }
      }
    }
    finish()
    const iv = setInterval(finish, 1000)
    return () => clearInterval(iv)
  }, [state.cards, dispatch])

  // home-screen badge: what is still open in Today's top list, plus anything dated today
  useEffect(() => {
    let n = 0
    for (const c of state.cards) {
      if (c.type === 'today') n += ((c.data.top as any[]) ?? []).filter((i) => i.text && !i.done).length
      for (const [k, v] of Object.entries(c.data)) if (!k.startsWith('_') && Array.isArray(v)) n += v.filter((r: any) => r?.date === day).length
    }
    setBadge(n)
  }, [state.cards, day])

  // bring a card into view and make it obvious which one it is
  useEffect(() => {
    if (!target) return
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-card="${target.id}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: calm() ? 'auto' : 'smooth' })
    el.dataset[target.fresh ? 'fresh' : 'flash'] = '1'
    if (target.fresh && matchMedia('(pointer: fine)').matches)
      el.querySelector<HTMLElement>('[data-row], .sec textarea, .sec input:not([type=file])')?.focus({ preventScroll: true })
    const t = setTimeout(() => {
      delete el.dataset.fresh
      delete el.dataset.flash
      setTarget(null)
    }, 1400)
    return () => clearTimeout(t)
  }, [target])

  const onOpen = useCallback((id: string) => setOpenId(id), [])
  const onDelete = useCallback(
    (card: Card) => {
      const index = stateRef.current.cards.findIndex((c) => c.id === card.id)
      dispatch({ t: 'removeCard', id: card.id })
      ui.toast(`“${card.title || 'Untitled'}” deleted`, 'Undo', () => dispatch({ t: 'restoreCard', card, index }))
    },
    [dispatch, ui],
  )
  const jumpTo = useCallback(
    (id: string) => {
      const card = stateRef.current.cards.find((c) => c.id === id)
      if (!card) return
      if (card.boardId !== stateRef.current.boardId) dispatch({ t: 'setBoard', id: card.boardId })
      setFilter(null)
      setTarget({ id, fresh: false })
    },
    [dispatch],
  )

  const g = useGoogle()
  const lapsed = g.stale[0] // Google sessions last about an hour; one tap renews
  const space = state.spaces.find((s) => s.id === filter)
  const onBoard = useMemo(() => state.cards.filter((c) => c.boardId === state.boardId), [state.cards, state.boardId])
  const cards = useMemo(() => (space ? onBoard.filter((c) => c.spaceId === space.id) : onBoard), [onBoard, space])
  useFlip(boardRef, cards.map((c) => c.id).join() + state.cols)

  const add = useCallback(
    (type: string, data?: Record<string, any>) => {
      const id = uid()
      dispatch({ t: 'addCard', id, type, spaceId: filter ?? undefined, data })
      setTarget({ id, fresh: true })
    },
    [dispatch, filter],
  )
  const capture = useCallback(
    (card: Card, key: string, text: string) => {
      const live = stateRef.current.cards.find((c) => c.id === card.id) ?? card
      dispatch({ t: 'setData', id: card.id, key, value: [...((live.data[key] as any[]) ?? []), { text, done: false }] })
      ui.toast(`Added to ${card.title || 'Untitled'}`)
    },
    [dispatch, ui],
  )

  // photos: paste one, or drop files anywhere on the board
  useEffect(() => {
    const addPhotos = async (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith('image/'))
      for (const f of imgs) add('photo', { photo: { src: await shrink(f) } })
      return imgs.length
    }
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea')) return
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.some((f) => f.type.startsWith('image/'))) (e.preventDefault(), addPhotos(files))
    }
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const over = (e: DragEvent) => hasFiles(e) && (e.preventDefault(), setDropping(true))
    const leave = (e: DragEvent) => !e.relatedTarget && setDropping(false)
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDropping(false)
      addPhotos([...(e.dataTransfer?.files ?? [])]).then((n) => !n && ui.toast('Only photos can be dropped here'))
    }
    document.addEventListener('paste', paste)
    addEventListener('dragover', over)
    addEventListener('dragleave', leave)
    addEventListener('drop', drop)
    return () => {
      document.removeEventListener('paste', paste)
      removeEventListener('dragover', over)
      removeEventListener('dragleave', leave)
      removeEventListener('drop', drop)
    }
  }, [add, ui])

  const commands = useMemo<Command[]>(
    () => [
      { name: 'New card', icon: 'Plus', hint: 'N', run: () => setOverlay('picker') },
      { name: 'New board', icon: 'LayoutGrid', run: () => setOverlay('newboard') },
      ...(canUndo ? [{ name: 'Undo', icon: 'Undo2', hint: '⌘Z', run: () => dispatch({ t: 'undo' }) } as Command] : []),
      ...(canRedo ? [{ name: 'Redo', icon: 'Redo2', hint: '⇧⌘Z', run: () => dispatch({ t: 'redo' }) } as Command] : []),
      { name: 'Settings', icon: 'Settings', run: () => setOverlay('settings') },
    ],
    [canUndo, canRedo, dispatch],
  )
  const ctx = useMemo(() => ({ state, dispatch, openSettings: () => setOverlay('settings'), jumpTo }), [state, dispatch, jumpTo])
  const opened = state.cards.find((c) => c.id === openId)
  const close = useCallback(() => setOverlay(null), [])
  const closeCard = useCallback(() => setOpenId(null), [])
  // commands chosen in the palette open another overlay, so they must not be closed again by the palette
  const closePalette = useCallback(() => setOverlay((o) => (o === 'palette' ? null : o)), [])

  return (
    <Ctx.Provider value={ctx}>
      <div className={`top${scrolled ? ' scrolled' : ''}`}>
        <div className="bar1">
          <div className="brand">
            <img src="./logo.svg" alt="" width="34" height="34" />
            <div>
              <small>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</small>
              <BoardMenu onNew={() => setOverlay('newboard')} />
            </div>
          </div>
          <div className="tools">
            <button className="ghost" aria-label="Search and capture" title="Search and capture (/)" onClick={() => setOverlay('palette')}>
              <Icon name="Search" size={18} />
            </button>
            <div className="zoom" role="group" aria-label="Columns">
              <button className="ghost" aria-label="Fewer columns" disabled={state.cols <= 1} onClick={() => dispatch({ t: 'setCols', cols: state.cols - 1 })}><Icon name="Minus" /></button>
              <b aria-live="polite">{state.cols}</b>
              <button className="ghost" aria-label="More columns" disabled={state.cols >= 8} onClick={() => dispatch({ t: 'setCols', cols: state.cols + 1 })}><Icon name="Plus" /></button>
            </div>
            <button className="ghost" aria-label="Settings" onClick={() => setOverlay('settings')}><Icon name="Settings" size={18} /></button>
          </div>
        </div>
        <nav className="chips" aria-label="Spaces">
          {lapsed && (
            <button className="alert" title={lapsed.email} onClick={() => reconnect(lapsed.email).catch((e) => ui.toast(e.message))}>
              <Icon name="RefreshCw" size={13} /> Reconnect Google
            </button>
          )}
          <button aria-pressed={!space} onClick={() => setFilter(null)}>All <em>{onBoard.length}</em></button>
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
          <CardView key={c.id} card={c} index={i} spaces={state.spaces} onOpen={onOpen} onDelete={onDelete} startDrag={startDrag} day={day} />
        ))}
      </main>
      {!cards.length && (
        <div className="empty">
          <span><Icon name="Plus" size={22} /></span>
          <h2>{space ? `Nothing in ${space.name} yet` : 'A fresh board'}</h2>
          <p>Add a card to get started. There are {CATALOG.length} to choose from.</p>
          <button className="btn" onClick={() => setOverlay('picker')}>Add a card</button>
        </div>
      )}
      {dropping && <div className="dropzone" aria-hidden><span><Icon name="ImagePlus" size={26} /> Drop photos to add them</span></div>}

      <button className="fab" aria-label="New card" title="New card (N)" onClick={() => setOverlay('picker')}><Icon name="Plus" size={24} /></button>
      {overlay === 'picker' && <Picker onClose={close} onAdd={add} />}
      {overlay === 'settings' && <Settings onClose={close} />}
      {overlay === 'newboard' && <NewBoard onClose={close} />}
      {overlay === 'palette' && <Palette cards={onBoard} commands={commands} onClose={closePalette} onJump={jumpTo} onNew={add} onCapture={capture} />}
      {opened && <CardSheet card={opened} space={state.spaces.find((s) => s.id === opened.spaceId)} onClose={closeCard} />}
    </Ctx.Provider>
  )
}

const tabs = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('plan')

export default function App() {
  const [h, dispatch] = useReducer(reducer, emptyHistory)
  const state = h.present
  const [ready, setReady] = useState<'loading' | 'ok' | 'failed'>('loading')
  const [saveErr, setSaveErr] = useState(false)

  useEffect(() => {
    loadState().then(
      (s) => {
        if (s) dispatch({ t: 'load', state: s })
        setReady('ok')
      },
      () => setReady('failed'), // never fall through to "new board": that would overwrite the real one
    )
  }, [])
  // save shortly after each change, and straight away when the app is put in the background
  useEffect(() => {
    if (!state) return
    const save = () => saveState(state).then(() => (setSaveErr(false), tabs?.postMessage('saved')), () => setSaveErr(true))
    const t = setTimeout(save, 300)
    const hide = () => document.visibilityState === 'hidden' && save()
    document.addEventListener('visibilitychange', hide)
    addEventListener('pagehide', save)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', hide)
      removeEventListener('pagehide', save)
    }
  }, [state])
  // the same board open in another tab or window: take in what it saved instead of overwriting it
  useEffect(() => {
    const take = () => loadState().then((s) => s && dispatch({ t: 'merge', state: s }), () => {})
    const wake = () => document.visibilityState === 'visible' && take()
    tabs?.addEventListener('message', take)
    document.addEventListener('visibilitychange', wake)
    return () => {
      tabs?.removeEventListener('message', take)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])
  // ask the browser not to clear this app's storage when the device runs low on space
  const kept = useRef(false)
  useEffect(() => {
    if (!state?.updatedAt || kept.current) return
    kept.current = true
    navigator.storage?.persist?.().catch(() => {})
  }, [state?.updatedAt])

  if (ready === 'loading') return null
  if (ready === 'failed')
    return (
      <main className="welcome">
        <div>
          <img src="./logo.svg" alt="" width="56" height="56" />
          <h1>Your board could not be opened.</h1>
          <p>This device’s storage did not respond. Nothing has been changed. Close other tabs with Plan open, then try again.</p>
          <button className="btn big" onClick={() => location.reload()}>Try again</button>
        </div>
      </main>
    )
  return (
    <UIProvider>
      {!state ? (
        <Welcome onStart={(k) => dispatch({ t: 'load', state: starter(k) })} onLoad={(state) => dispatch({ t: 'load', state })} />
      ) : (
        <Guard fallback={(retry) => (
          <main className="welcome">
            <div>
              <img src="./logo.svg" alt="" width="56" height="56" />
              <h1>Something went wrong.</h1>
              <p>Your board is still saved on this device. You can download a copy before trying again.</p>
              <button className="btn big" onClick={retry}>Try again</button>
              <button className="btn soft big" onClick={() => saveFile('plan-backup.json', 'application/json', JSON.stringify(state))}>Download my board</button>
            </div>
          </main>
        )}>
          <DispatchCtx.Provider value={dispatch}>
            <Board state={state} dispatch={dispatch} canUndo={h.past.length > 0} canRedo={h.future.length > 0} />
            {saveErr && <p className="err banner" role="alert">Could not save to this device. Download a backup from Settings.</p>}
          </DispatchCtx.Provider>
        </Guard>
      )}
    </UIProvider>
  )
}
