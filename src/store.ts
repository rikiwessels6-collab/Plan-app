import { createContext, useContext } from 'react'
import { typeOf } from './catalog'
import { SPACE_COLORS, uid, type Card, type State } from './types'

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
    boardId: b, cols: 4, spaces, cards,
  }
}

function reduce(s: State, a: Action): State {
  switch (a.t) {
    case 'load':
      return a.state
    case 'undo':
    case 'redo':
    case 'merge':
      return s // handled by the history reducer below
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
      return { ...s, spaces: [...s.spaces, { id: uid(), name: a.name, color: SPACE_COLORS[s.spaces.length % SPACE_COLORS.length] }] }
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

/** Mark what an action changed: touched cards get a timestamp, removed cards a tombstone. */
function stamp(prev: State, next: State): State {
  if (prev === next) return next
  const now = Date.now()
  const before = new Map(prev.cards.map((c) => [c.id, c]))
  const after = new Set(next.cards.map((c) => c.id))
  const deleted = { ...next.deleted }
  const cards = next.cards.map((c) => {
    if (before.get(c.id) === c) return c
    delete deleted[c.id]
    return { ...c, u: now }
  })
  for (const c of prev.cards) if (!after.has(c.id)) deleted[c.id] = now
  return { ...next, cards, deleted, updatedAt: now }
}

/**
 * Combine this device's board with another copy of it (from sync).
 * Cards are compared one by one and the most recently changed version wins;
 * a card deleted after its last change stays deleted.
 */
export function merge(local: State, remote: State): State {
  const deleted: Record<string, number> = { ...remote.deleted }
  for (const [id, at] of Object.entries(local.deleted ?? {})) deleted[id] = Math.max(at, deleted[id] ?? 0)
  const L = new Map(local.cards.map((c) => [c.id, c]))
  const R = new Map(remote.cards.map((c) => [c.id, c]))
  const pick = (id: string): Card | null => {
    const l = L.get(id), r = R.get(id)
    const c = !l ? r! : !r ? l : (r.u ?? 0) > (l.u ?? 0) ? r : l
    return id in deleted && deleted[id] >= (c.u ?? 0) ? null : c
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
  const cards = ids.map(pick).filter((c): c is Card => !!c)
  // boards and spaces follow the newer copy, plus any the other copy has that surviving cards still use
  const boards = [...lead.boards, ...other.boards.filter((b) => !lead.boards.some((x) => x.id === b.id) && cards.some((c) => c.boardId === b.id))]
  const spaces = [...lead.spaces, ...other.spaces.filter((p) => !lead.spaces.some((x) => x.id === p.id) && cards.some((c) => c.spaceId === p.id))]
  const same =
    cards.length === local.cards.length && cards.every((c, i) => c === local.cards[i]) &&
    boards.length === local.boards.length && boards.every((b, i) => b.id === local.boards[i].id && b.name === local.boards[i].name) &&
    spaces.length === local.spaces.length && spaces.every((p, i) => p.id === local.spaces[i].id && p.name === local.spaces[i].name)
  if (same) return local
  return {
    boards, spaces, cards, deleted,
    boardId: boards.some((b) => b.id === local.boardId) ? local.boardId : boards[0].id,
    cols: local.cols,
    updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0),
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
    // undoing past a merge would delete what the other device added, so history restarts here
    return m === cur ? h : { ...emptyHistory, present: m }
  }
  const next = reduce(cur, a)
  if (next === cur) return h
  if (DEVICE_ONLY.has(a.t)) return { ...h, present: next }
  // typing in one field is one undo step, not one per keystroke
  const key = a.t === 'setData' ? `${a.id}:${a.key}` : a.t === 'patchCard' && 'title' in a.patch ? `${a.id}:title` : ''
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
export async function loadState(): Promise<State | null> {
  try {
    const db = await open()
    return await new Promise((res, rej) => {
      const r = db.transaction('kv').objectStore('kv').get('state')
      r.onsuccess = () => res((r.result as State) ?? null)
      r.onerror = () => rej(r.error)
    })
  } catch {
    return null
  }
}
export async function saveState(s: State): Promise<void> {
  const db = await open()
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(s, 'state')
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
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
