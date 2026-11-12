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
  | { t: 'addBoard'; name: string }
  | { t: 'renameBoard'; name: string }
  | { t: 'removeBoard' }
  | { t: 'setBoard'; id: string }
  | { t: 'setCols'; cols: number }

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
    id: uid(), boardId: b, type, title: title ?? typeOf(type).name, spaceId: space === undefined ? undefined : spaces[space]?.id, data,
  })
  const hello = c('sticky', undefined, 'Welcome', { text: 'Tap + to add anything.\nHold a card to move it.' })
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

export function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'load':
      return a.state
    case 'addCard': {
      const card: Card = {
        id: a.id ?? uid(), boardId: s.boardId, type: a.type, title: a.title ?? typeOf(a.type).name,
        spaceId: a.spaceId, data: a.data ?? {},
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
      return { ...s, boards: [...s.boards, { id, name: a.name }], boardId: id }
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

export const Ctx = createContext<{ state: State; dispatch: (a: Action) => void; openSettings: () => void }>(null as any)
export const useApp = () => useContext(Ctx)
/** Stable across renders, so memoised cards do not re-render on every keystroke elsewhere. */
export const DispatchCtx = createContext<(a: Action) => void>(() => {})
export const useDispatch = () => useContext(DispatchCtx)
