import { createContext, useContext } from 'react'
import { typeOf } from './catalog'
import { SPACE_COLORS, uid, type Board, type Card, type State } from './types'

export type Action =
  | { t: 'load'; state: State }
  | { t: 'addCard'; id?: string; type: string; title?: string; data?: Record<string, any>; spaceId?: string }
  | { t: 'setData'; id: string; key: string; value: any }
  | { t: 'patchCard'; id: string; patch: Partial<Card> }
  | { t: 'removeCard'; id: string }
  | { t: 'dupCard'; id: string }
  | { t: 'moveCard'; id: string; beforeId?: string; afterId?: string; step?: number }
  | { t: 'restoreCard'; card: Card; index: number }
  | { t: 'addSpace'; name: string }
  | { t: 'removeSpace'; id: string }
  | { t: 'addBoard'; name: string; kind?: Starter }
  | { t: 'clearDone'; id: string }
  | { t: 'rollover'; day: string }
  | { t: 'merge'; state: State }
  | { t: 'putCards'; cards: Card[] }
  | { t: 'restoreBoard'; board: Board; cards: Card[] }
  | { t: 'restore'; state: State }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'renameBoard'; name: string }
  | { t: 'removeBoard' }
  | { t: 'setBoard'; id: string }
  | { t: 'setCols'; cols: number }

export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type Starter = 'life' | 'work' | 'home' | 'blank'

/** First-run boards: real structure, no fake content. */
export function starter(kind: Starter): State {
  const b = uid()
  const sp = (name: string, i: number) => ({ id: uid(), name, color: SPACE_COLORS[i] })
  const spaces =
    kind === 'work' ? [sp('Focus', 2), sp('Team', 0), sp('Clients', 1)]
    : kind === 'home' ? [sp('Home', 0), sp('Family', 3), sp('Money', 4)]
    : kind === 'life' ? [sp('Me', 3), sp('Home', 0), sp('Work', 2), sp('Money', 4)]
    : []
  const c = (type: string, space?: number, title?: string, data: Record<string, any> = {}): Card => ({
    id: uid(), boardId: b, type, title: title ?? typeOf(type).name, spaceId: space === undefined ? undefined : spaces[space]?.id,
    data: type === 'today' || type === 'day' ? { _day: today(), ...data } : data,
  })
  const hello = c('sticky', undefined, 'Welcome', { text: 'Tap + to add a card.\nHold a card to move it.\nTap the magnifier to find or jot anything.' })
  const cards =
    kind === 'work'
      ? [c('today', 0), c('agenda', 0), c('gmail', 0), c('project', 0), hello, c('roadmap', 1), c('meeting', 1), c('waiting', 1), c('client', 2), c('ideas'), c('note')]
    : kind === 'home'
      ? [c('meals', 0), c('shopping', 0), c('todo', 0, 'Around the house'), hello, c('week', 1), c('dates', 1), c('contacts', 1), c('budget', 2), c('trip', 1), c('photo')]
    : kind === 'life'
      ? [c('today', 0), c('agenda', 2), c('habit', 0, 'Daily habit'), hello, c('goal', 0), c('meals', 1), c('gmail', 2), c('shopping', 1), c('budget', 3), c('dates', 0), c('journal', 0), c('photo')]
      : [hello]
  return {
    boards: [{ id: b, name: kind === 'work' ? 'Work' : kind === 'home' ? 'Home' : 'My board' }],
    // phones show as many columns as fit; tablets start roomier than a desktop
    boardId: b, cols: typeof innerWidth === 'number' && innerWidth < 1000 ? 3 : 4, spaces, cards,
  }
}

function reduce(s: State, a: Action): State {
  switch (a.t) {
    case 'load':
      return a.state
    case 'undo':
    case 'redo':
    case 'merge':
    case 'restore':
      return s // handled by the history reducer below
    case 'putCards': {
      // put these exact cards back (used by Undo buttons): replace by id, or add at the top
      const put = new Map(a.cards.map((c) => [c.id, c]))
      const have = new Set(s.cards.map((c) => c.id))
      return { ...s, cards: [...a.cards.filter((c) => !have.has(c.id)), ...s.cards.map((c) => put.get(c.id) ?? c)] }
    }
    case 'restoreBoard':
      if (s.boards.some((b) => b.id === a.board.id)) return s
      return { ...s, boards: [...s.boards, a.board], boardId: a.board.id, cards: [...s.cards, ...a.cards] }
    case 'clearDone':
      return {
        ...s,
        cards: s.cards.map((c) => {
          if (c.id !== a.id) return c
          const data = { ...c.data }
          for (const sec of typeOf(c.type).sections)
            if (sec.kind === 'checklist' && Array.isArray(data[sec.key])) data[sec.key] = data[sec.key].filter((i: any) => !i.done)
          return { ...c, data }
        }),
      }
    case 'rollover': {
      // Today and Day plan cards start each day clean: finished items go, unfinished carry over
      let changed = false
      const cards = s.cards.map((c) => {
        if ((c.type !== 'today' && c.type !== 'day') || c.data._day === a.day) return c
        changed = true
        const data: Record<string, any> = { ...c.data, _day: a.day }
        if (c.data._day)
          for (const sec of typeOf(c.type).sections)
            if (sec.kind === 'checklist' && Array.isArray(data[sec.key])) data[sec.key] = data[sec.key].filter((i: any) => !i.done)
        return { ...c, data }
      })
      return changed ? { ...s, cards } : s
    }
    case 'addCard': {
      const card: Card = {
        id: a.id ?? uid(), boardId: s.boardId, type: a.type, title: a.title ?? typeOf(a.type).name,
        spaceId: a.spaceId, data: { ...(a.type === 'today' || a.type === 'day' ? { _day: today() } : null), ...a.data },
      }
      return { ...s, cards: [card, ...s.cards] }
    }
    case 'setData':
      return { ...s, cards: s.cards.map((c) => (c.id === a.id ? { ...c, data: { ...c.data, [a.key]: a.value } } : c)) }
    case 'patchCard':
      return { ...s, cards: s.cards.map((c) => (c.id === a.id ? { ...c, ...a.patch } : c)) }
    case 'removeCard':
      return { ...s, cards: s.cards.filter((c) => c.id !== a.id) }
    case 'dupCard': {
      const i = s.cards.findIndex((c) => c.id === a.id)
      if (i < 0) return s
      const copy = { ...s.cards[i], id: uid(), data: JSON.parse(JSON.stringify(s.cards[i].data)) }
      return { ...s, cards: [...s.cards.slice(0, i + 1), copy, ...s.cards.slice(i + 1)] }
    }
    case 'moveCard': {
      const from = s.cards.findIndex((c) => c.id === a.id)
      if (from < 0) return s
      const card = s.cards[from]
      const rest = s.cards.filter((c) => c.id !== a.id)
      let to: number
      if (a.step) {
        // step among cards of the same board so the move is visible
        const same = rest.map((c, i) => (c.boardId === card.boardId ? i : -1)).filter((i) => i >= 0)
        const pos = same.filter((i) => i < from).length + a.step
        if (pos < 0 || pos > same.length) return s
        to = pos === same.length ? rest.length : same[pos]
      } else {
        to = a.afterId
          ? rest.findIndex((c) => c.id === a.afterId) + 1 || -1
          : a.beforeId ? rest.findIndex((c) => c.id === a.beforeId) : rest.length
        if (to < 0) return s
      }
      return { ...s, cards: [...rest.slice(0, to), card, ...rest.slice(to)] }
    }
    case 'restoreCard':
      return { ...s, cards: [...s.cards.slice(0, a.index), a.card, ...s.cards.slice(a.index)] }
    case 'addSpace':
      return {
        ...s,
        // the first colour no other space is using, so two spaces are never indistinguishable
        spaces: [...s.spaces, { id: uid(), name: a.name, color: SPACE_COLORS.find((c) => !s.spaces.some((x) => x.color === c)) ?? SPACE_COLORS[s.spaces.length % SPACE_COLORS.length] }],
      }
    case 'removeSpace':
      return {
        ...s,
        spaces: s.spaces.filter((x) => x.id !== a.id),
        cards: s.cards.map((c) => (c.spaceId === a.id ? { ...c, spaceId: undefined } : c)),
      }
    case 'addBoard': {
      const id = uid()
      if (!a.kind || a.kind === 'blank') return { ...s, boards: [...s.boards, { id, name: a.name }], boardId: id }
      // build the starter, then reuse spaces this person already has (matched by name)
      const t = starter(a.kind)
      const spaces = [...s.spaces]
      const map = new Map<string, string>()
      for (const sp of t.spaces) {
        const have = spaces.find((x) => x.name.toLowerCase() === sp.name.toLowerCase())
        if (have) map.set(sp.id, have.id)
        else (spaces.push(sp), map.set(sp.id, sp.id))
      }
      const cards = t.cards
        .filter((c) => c.title !== 'Welcome')
        .map((c) => ({ ...c, boardId: id, spaceId: c.spaceId && map.get(c.spaceId) }))
      return { ...s, boards: [...s.boards, { id, name: a.name }], boardId: id, spaces, cards: [...cards, ...s.cards] }
    }
    case 'renameBoard':
      return { ...s, boards: s.boards.map((b) => (b.id === s.boardId ? { ...b, name: a.name } : b)) }
    case 'removeBoard': {
      if (s.boards.length < 2) return s
      const boards = s.boards.filter((b) => b.id !== s.boardId)
      return { ...s, boards, boardId: boards[0].id, cards: s.cards.filter((c) => c.boardId !== s.boardId) }
    }
    case 'setBoard':
      return { ...s, boardId: a.id }
    case 'setCols':
      return { ...s, cols: Math.max(1, Math.min(8, a.cols)) }
  }
}

// ---------- change tracking, undo history and merging ----------

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** Mark what an action changed: touched items get a timestamp, removed items a tombstone. */
function stamp(prev: State, next: State): State {
  if (prev === next) return next
  const now = Date.now()
  const deleted = { ...next.deleted }
  const track = <T extends { id: string }>(was: T[], is: T[], touch: (old: T | undefined, cur: T) => T): T[] => {
    if (was === is) return is
    const before = new Map(was.map((x) => [x.id, x]))
    const after = new Set(is.map((x) => x.id))
    for (const x of was) if (!after.has(x.id)) deleted[x.id] = now
    return is.map((x) => {
      const old = before.get(x.id)
      if (old === x) return x
      delete deleted[x.id]
      return touch(old, x)
    })
  }
  const cards = track(prev.cards, next.cards, (old, c) => {
    if (!old) return { ...c, u: now }
    // note which parts changed, so another device's edit to a different part is not lost
    const k = { ...c.k }
    for (const key of new Set([...Object.keys(old.data), ...Object.keys(c.data)])) if (old.data[key] !== c.data[key]) k[key] = now
    if (old.title !== c.title) k['#t'] = now
    if (old.spaceId !== c.spaceId) k['#s'] = now
    return { ...c, u: now, k }
  })
  const boards = track(prev.boards, next.boards, (_o, x) => ({ ...x, u: now }))
  const spaces = track(prev.spaces, next.spaces, (_o, x) => ({ ...x, u: now }))
  return { ...next, cards, boards, spaces, deleted, updatedAt: now }
}

/** Two versions of one card: take each part (title, space, each section) from whichever changed it last. */
function mergeCard(l: Card, r: Card): Card {
  const lu = l.u ?? 0, ru = r.u ?? 0
  if (lu === ru) return l
  const [newer, older] = ru > lu ? [r, l] : [l, r]
  if (!older.k) return newer
  const at = (c: Card, key: string) => c.k?.[key] ?? 0
  const wins = (key: string) => at(older, key) > at(newer, key)
  let mixed = false
  const data: Record<string, any> = { ...newer.data }
  for (const key of Object.keys(older.k)) {
    if (key[0] === '#' || !wins(key) || same(older.data[key], newer.data[key])) continue
    mixed = true
    if (older.data[key] === undefined) delete data[key]
    else data[key] = older.data[key]
  }
  const title = wins('#t') ? older.title : newer.title
  const spaceId = wins('#s') ? older.spaceId : newer.spaceId
  if (!mixed && title === newer.title && spaceId === newer.spaceId) return newer
  const k = { ...newer.k }
  for (const [key, t] of Object.entries(older.k)) k[key] = Math.max(t, k[key] ?? 0)
  // one tick later than both, so every device settles on this combined version
  return { ...newer, title, spaceId, data, k, u: Math.max(lu, ru) + 1 }
}

const TOMBSTONE_LIFE = 180 * 24 * 60 * 60 * 1000

/**
 * Combine this device's board with another copy of it (from sync or another tab).
 * Cards, boards and spaces are compared one by one and the most recent change wins;
 * anything deleted after its last change stays deleted. Returns `local` itself when nothing differs.
 */
export function merge(local: State, remote: State): State {
  const deleted: Record<string, number> = { ...remote.deleted }
  for (const [id, at] of Object.entries(local.deleted ?? {})) deleted[id] = Math.max(at, deleted[id] ?? 0)
  const cutoff = Date.now() - TOMBSTONE_LIFE
  for (const [id, at] of Object.entries(deleted)) if (at < cutoff) delete deleted[id]
  const gone = (x: { id: string; u?: number }) => x.id in deleted && deleted[x.id] >= (x.u ?? 0)

  const L = new Map(local.cards.map((c) => [c.id, c]))
  const R = new Map(remote.cards.map((c) => [c.id, c]))
  const pick = (id: string): Card | null => {
    const l = L.get(id), r = R.get(id)
    const c = !l ? r! : !r ? l : mergeCard(l, r)
    return gone(c) ? null : c
  }
  const localNewer = (local.updatedAt ?? 0) >= (remote.updatedAt ?? 0)
  const lead = localNewer ? local : remote
  const other = localNewer ? remote : local
  // order follows the most recently changed copy; cards only the other copy has slot in after their old neighbour
  const ids = lead.cards.map((c) => c.id)
  const seen = new Set(ids)
  let anchor = -1
  for (const c of other.cards) {
    const at = ids.indexOf(c.id)
    if (at >= 0) anchor = at
    else if (!seen.has(c.id)) {
      ids.splice(++anchor, 0, c.id)
      seen.add(c.id)
    }
  }
  let cards = ids.map(pick).filter((c): c is Card => !!c)

  // boards and spaces: newest version of each; one is only dropped if it was deleted after its last change,
  // and never while a surviving card still sits on it
  const list = <T extends { id: string; u?: number }>(a: T[], b: T[], used: (id: string) => boolean): T[] => {
    const B = new Map(b.map((x) => [x.id, x]))
    const out: T[] = []
    for (const x of a) {
      const o = B.get(x.id)
      const w = o && (o.u ?? 0) > (x.u ?? 0) ? o : x
      if (!gone(w) || used(w.id)) out.push(w)
    }
    for (const o of b) if (!a.some((x) => x.id === o.id) && (!gone(o) || used(o.id))) out.push(o)
    for (const x of out) if (gone(x)) delete deleted[x.id]
    return out
  }
  let boards = list(lead.boards, other.boards, (id) => cards.some((c) => c.boardId === id))
  if (!boards.length) boards = [local.boards[0]]
  const spaces = list(lead.spaces, other.spaces, (id) => cards.some((c) => c.spaceId === id))

  // keep the same arrays when nothing in them changed, so the screen does not redraw for nothing
  const keep = <T,>(mine: T[], out: T[]) => (out.length === mine.length && out.every((x, i) => x === mine[i]) ? mine : out)
  cards = keep(local.cards, cards)
  boards = keep(local.boards, boards)
  const sp = keep(local.spaces, spaces)
  const mineDeleted = local.deleted ?? {}
  const sameDeleted = Object.keys(deleted).length === Object.keys(mineDeleted).length && Object.entries(deleted).every(([id, at]) => mineDeleted[id] === at)
  if (cards === local.cards && boards === local.boards && sp === local.spaces && sameDeleted) return local
  return {
    boards, spaces: sp, cards, deleted,
    boardId: boards.some((b) => b.id === local.boardId) ? local.boardId : boards[0].id,
    cols: local.cols,
    updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0),
  }
}

/** Make sure data from a file or from sync has the shape the app expects. Returns null if it is not a board at all. */
export function normalize(x: any): State | null {
  if (!x || typeof x !== 'object' || !Array.isArray(x.boards) || !Array.isArray(x.cards)) return null
  const boards: Board[] = x.boards
    .filter((b: any) => b && typeof b.id === 'string')
    .map((b: any) => ({ ...b, name: typeof b.name === 'string' && b.name ? b.name : 'Board' }))
  if (!boards.length) return null
  const on = new Set(boards.map((b) => b.id))
  const spaces = (Array.isArray(x.spaces) ? x.spaces : [])
    .filter((p: any) => p && typeof p.id === 'string')
    .map((p: any) => ({ ...p, name: typeof p.name === 'string' ? p.name : '', color: typeof p.color === 'string' ? p.color : SPACE_COLORS[0] }))
  const cards: Card[] = x.cards
    .filter((c: any) => c && typeof c.id === 'string' && typeof c.type === 'string' && on.has(c.boardId))
    .map((c: any) => ({
      ...c,
      title: typeof c.title === 'string' ? c.title : '',
      data: c.data && typeof c.data === 'object' && !Array.isArray(c.data) ? c.data : {},
    }))
  const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  return {
    boards, spaces, cards,
    boardId: on.has(x.boardId) ? x.boardId : boards[0].id,
    cols: Math.max(1, Math.min(8, Math.round(num(x.cols) ?? 4))),
    deleted: x.deleted && typeof x.deleted === 'object' ? Object.fromEntries(Object.entries(x.deleted).filter(([, v]) => num(v) !== undefined)) as Record<string, number> : undefined,
    updatedAt: num(x.updatedAt),
  }
}

export interface History {
  past: State[]
  present: State | null
  future: State[]
  key: string
  at: number
}
export const emptyHistory: History = { past: [], present: null, future: [], key: '', at: 0 }
const DEVICE_ONLY = new Set(['setBoard', 'setCols'])

/** The app's reducer: applies an action, records it for undo, and stamps what changed. */
export function reducer(h: History, a: Action): History {
  if (a.t === 'load') return { ...emptyHistory, present: a.state }
  const cur = h.present
  if (!cur) return h
  const view = (s: State): State => ({ ...s, cols: cur.cols, boardId: s.boards.some((b) => b.id === cur.boardId) ? cur.boardId : s.boardId })
  if (a.t === 'undo') {
    if (!h.past.length) return h
    return { past: h.past.slice(0, -1), present: stamp(cur, view(h.past[h.past.length - 1])), future: [cur, ...h.future], key: '', at: 0 }
  }
  if (a.t === 'redo') {
    if (!h.future.length) return h
    return { past: [...h.past, cur], present: stamp(cur, view(h.future[0])), future: h.future.slice(1), key: '', at: 0 }
  }
  if (a.t === 'merge') {
    const m = merge(cur, a.state)
    if (m === cur) return h
    // undoing past a merge would delete what the other device added, so history restarts when content arrived
    const arrived = m.cards !== cur.cards || m.boards !== cur.boards || m.spaces !== cur.spaces
    return arrived ? { ...emptyHistory, present: m } : { ...h, present: m }
  }
  if (a.t === 'restore') {
    // a backup replaces everything, on every synced device: it is stamped as the newest version of each item,
    // and whatever it does not contain is marked deleted
    const now = Date.now()
    const deleted = { ...cur.deleted }
    for (const x of [...cur.cards, ...cur.boards, ...cur.spaces]) deleted[x.id] = now
    const fresh = <T extends { id: string }>(xs: T[]) => xs.map((x) => (delete deleted[x.id], { ...x, u: now, k: undefined }))
    return {
      ...emptyHistory,
      present: { ...a.state, cards: fresh(a.state.cards), boards: fresh(a.state.boards), spaces: fresh(a.state.spaces), deleted, cols: cur.cols, updatedAt: now },
    }
  }
  const next = reduce(cur, a)
  if (next === cur) return h
  if (DEVICE_ONLY.has(a.t)) return { ...h, present: next }
  // Each device clears its own finished Today items at the start of a day. That is not an edit: stamping it
  // would let a device that was closed overnight overwrite newer work from another device.
  if (a.t === 'rollover') return { ...h, present: next }
  // typing in one field, or dragging one card, is one undo step
  const key =
    a.t === 'setData' ? `${a.id}:${a.key}`
    : a.t === 'patchCard' && 'title' in a.patch ? `${a.id}:title`
    : a.t === 'moveCard' && !a.step ? `${a.id}:move`
    : ''
  const now = Date.now()
  const joined = key !== '' && key === h.key && now - h.at < 1500
  return { past: joined ? h.past : [...h.past, cur].slice(-60), present: stamp(cur, next), future: [], key, at: now }
}

// --- persistence: one IndexedDB record (photos make localStorage too small) ---
const DB = 'plan-app'
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
/** The saved board, or null on a device with none. Throws if storage could not be read (so we never overwrite it with a blank). */
export async function loadState(): Promise<State | null> {
  const db = await open()
  const raw = await new Promise<unknown>((res, rej) => {
    const r = db.transaction('kv').objectStore('kv').get('state')
    r.onsuccess = () => res(r.result ?? null)
    r.onerror = () => rej(r.error)
  })
  return raw ? normalize(raw) : null
}
export async function saveState(s: State): Promise<void> {
  const db = await open()
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(s, 'state')
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error ?? new Error('Storage is full')) // running out of space ends as an abort
  })
}

export const Ctx = createContext<{
  state: State
  dispatch: (a: Action) => void
  openSettings: () => void
  /** scroll to a card and flash it */
  jumpTo: (cardId: string) => void
}>(null as any)
export const useApp = () => useContext(Ctx)
/** Stable across renders, so memoised cards do not re-render on every keystroke elsewhere. */
export const DispatchCtx = createContext<(a: Action) => void>(() => {})
export const useDispatch = () => useContext(DispatchCtx)
