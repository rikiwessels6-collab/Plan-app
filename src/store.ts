import { createContext, useContext } from 'react'
import { typeOf } from './catalog'
import { SPACE_COLORS, uid, type Card, type State } from './types'

export type Action =
  | { t: 'load'; state: State }
  | { t: 'addCard'; type: string; title?: string; data?: Record<string, any>; spaceId?: string }
  | { t: 'setData'; id: string; key: string; value: any }
  | { t: 'patchCard'; id: string; patch: Partial<Card> }
  | { t: 'removeCard'; id: string }
  | { t: 'dupCard'; id: string }
  | { t: 'moveCard'; id: string; beforeId?: string; step?: number }
  | { t: 'addSpace'; name: string }
  | { t: 'removeSpace'; id: string }
  | { t: 'addBoard'; name: string }
  | { t: 'renameBoard'; name: string }
  | { t: 'removeBoard' }
  | { t: 'setBoard'; id: string }
  | { t: 'setCols'; cols: number }

const item = (text: string, done = false) => ({ text, done })
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function seed(): State {
  const b = uid()
  const [me, home, work, money] = [uid(), uid(), uid(), uid()]
  const now = new Date()
  const habit: Record<string, boolean> = {}
  for (let i = 1; i < now.getDate(); i++) if (i % 3 !== 0) habit[iso(new Date(now.getFullYear(), now.getMonth(), i))] = true
  const soon = (n: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))
  const c = (type: string, title: string, spaceId: string | undefined, data: Record<string, any>): Card => ({
    id: uid(), boardId: b, type, title, spaceId, data,
  })
  return {
    boards: [{ id: b, name: 'My board' }],
    boardId: b,
    cols: 4,
    spaces: [
      { id: me, name: 'Me', color: SPACE_COLORS[3] },
      { id: home, name: 'Home', color: SPACE_COLORS[0] },
      { id: work, name: 'Work', color: SPACE_COLORS[2] },
      { id: money, name: 'Money', color: SPACE_COLORS[4] },
    ],
    cards: [
      c('today', 'Today', me, {
        top: [item('Book the dentist', true), item('Pay the car insurance'), item('Call Mum')],
        rest: [item('Return the parcel'), item('Water the plants')],
      }),
      c('agenda', 'Calendar', work, {}),
      c('habit', 'Walk 30 minutes', me, { habit }),
      c('sticky', 'Sticky', undefined, { text: 'What if it were easy?' }),
      c('goal', 'Run 5 km by summer', me, {
        n: { value: 2, target: 5, unit: 'km' },
        why: 'More energy, and time outside.',
        miles: [item('2 km', true), item('3 km'), item('5 km')],
      }),
      c('gmail', 'Gmail inbox', work, {}),
      c('budget', 'Budget', money, {
        rows: { budget: 3200, rows: [{ label: 'Rent', amount: 1250 }, { label: 'Groceries', amount: 620 }, { label: 'Car', amount: 310 }] },
      }),
      c('meals', 'Meals', home, { days: { Mon: 'Salmon and greens', Tue: 'Pasta with pesto', Wed: 'Soup and bread', Fri: 'Out with friends' } }),
      c('dates', 'Birthdays', me, { dates: [{ label: "Anna's birthday", date: soon(12) }, { label: 'Mum and Dad, 40 years', date: soon(33) }] }),
      c('shopping', 'Shopping', home, { items: [item('Oat milk'), item('Coffee beans'), item('Lemons', true)] }),
      c('note', 'Note', work, { text: 'Supplier visit\nBring the old samples. Ask about lead times.' }),
      c('photo', 'Photo', undefined, {}),
    ],
  }
}

export function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'load':
      return a.state
    case 'addCard': {
      const card: Card = {
        id: uid(), boardId: s.boardId, type: a.type, title: a.title ?? typeOf(a.type).name,
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
        to = a.beforeId ? rest.findIndex((c) => c.id === a.beforeId) : rest.length
        if (to < 0) return s
      }
      return { ...s, cards: [...rest.slice(0, to), card, ...rest.slice(to)] }
    }
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
