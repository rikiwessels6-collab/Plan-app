import { describe, expect, it } from 'vitest'
import { emptyHistory, merge, reducer, starter, type Action, type History } from '../src/store'
import type { State } from '../src/types'

const run = (h: History, ...as: Action[]) => as.reduce(reducer, h)
const boot = () => run(emptyHistory, { t: 'load', state: starter('blank') })
const titles = (h: History) => h.present!.cards.map((c) => c.title)

describe('history', () => {
  it('undoes and redoes adding a card', () => {
    let h = run(boot(), { t: 'addCard', id: 'a', type: 'todo', title: 'A' })
    expect(titles(h)).toEqual(['A', 'Welcome'])
    h = run(h, { t: 'undo' })
    expect(titles(h)).toEqual(['Welcome'])
    h = run(h, { t: 'redo' })
    expect(titles(h)).toEqual(['A', 'Welcome'])
  })
  it('treats continuous typing in one field as one step', () => {
    let h = run(boot(), { t: 'addCard', id: 'a', type: 'note' })
    for (const v of ['h', 'he', 'hey']) h = run(h, { t: 'setData', id: 'a', key: 'text', value: v })
    h = run(h, { t: 'undo' })
    expect(h.present!.cards[0].data.text).toBeUndefined()
  })
  it('does not record view changes', () => {
    const h = run(boot(), { t: 'setCols', cols: 2 })
    expect(h.past).toHaveLength(0)
    expect(h.present!.cols).toBe(2)
  })
  it('tombstones deleted cards and clears the tombstone on restore', () => {
    let h = run(boot(), { t: 'addCard', id: 'a', type: 'todo' })
    const card = h.present!.cards[0]
    h = run(h, { t: 'removeCard', id: 'a' })
    expect(h.present!.deleted!.a).toBeGreaterThan(0)
    h = run(h, { t: 'restoreCard', card, index: 0 })
    expect(h.present!.deleted!.a).toBeUndefined()
  })
})

describe('cards', () => {
  it('clears finished items and rolls Today over to a new day', () => {
    let h = run(boot(), { t: 'addCard', id: 't', type: 'today' }, {
      t: 'setData', id: 't', key: 'top', value: [{ text: 'done', done: true }, { text: 'open', done: false }],
    })
    h = run(h, { t: 'rollover', day: '2999-01-01' })
    expect(h.present!.cards[0].data.top).toEqual([{ text: 'open', done: false }])
    expect(h.present!.cards[0].data._day).toBe('2999-01-01')
    const again = run(h, { t: 'rollover', day: '2999-01-01' })
    expect(again).toBe(h)
  })
  it('moves a card after another', () => {
    const h = run(boot(), { t: 'addCard', id: 'a', type: 'todo', title: 'A' }, { t: 'addCard', id: 'b', type: 'todo', title: 'B' }, { t: 'moveCard', id: 'b', afterId: 'a' })
    expect(titles(h)).toEqual(['A', 'B', 'Welcome'])
  })
  it('creates a board from a starter and reuses spaces by name', () => {
    let h = run(emptyHistory, { t: 'load', state: starter('life') })
    const before = h.present!.spaces.length
    h = run(h, { t: 'addBoard', name: 'Second', kind: 'home' })
    const s = h.present!
    expect(s.boards).toHaveLength(2)
    expect(s.spaces.length).toBe(before + 1) // Home and Money reused, Family added
    expect(s.cards.filter((c) => c.boardId === s.boardId).length).toBeGreaterThan(5)
  })
})

describe('merge', () => {
  const base = (): State => run(boot(), { t: 'addCard', id: 'a', type: 'note', title: 'A' }, { t: 'addCard', id: 'b', type: 'note', title: 'B' }).present!
  const at = (s: State, n: number, id?: string): State => ({ ...s, updatedAt: n, cards: s.cards.map((c) => (!id || c.id === id ? { ...c, u: n } : c)) })

  it('returns the same object when nothing differs', () => {
    const s = base()
    expect(merge(s, s)).toBe(s)
  })
  it('keeps the newer version of each card', () => {
    const s = base()
    const mine = at({ ...s, cards: s.cards.map((c) => (c.id === 'a' ? { ...c, title: 'A mine' } : c)) }, 9e15, 'a')
    const theirs = at({ ...s, cards: s.cards.map((c) => (c.id === 'b' ? { ...c, title: 'B theirs' } : c)) }, 8e15, 'b')
    const m = merge(mine, theirs)
    expect(m.cards.find((c) => c.id === 'a')!.title).toBe('A mine')
    expect(m.cards.find((c) => c.id === 'b')!.title).toBe('B theirs')
  })
  it('keeps a card added on the other device, next to its neighbour', () => {
    const s = base()
    const theirs: State = { ...s, updatedAt: 1, cards: [s.cards[0], { ...s.cards[0], id: 'n', title: 'New', u: 5 }, ...s.cards.slice(1)] }
    expect(merge(s, theirs).cards.map((c) => c.title)).toEqual(['B', 'New', 'A', 'Welcome'])
  })
  it('does not resurrect a card deleted here after its last change', () => {
    const s = base()
    const mine: State = { ...s, cards: s.cards.filter((c) => c.id !== 'a'), deleted: { a: 9e15 }, updatedAt: 9e15 }
    expect(merge(mine, s).cards.some((c) => c.id === 'a')).toBe(false)
    // but an edit made elsewhere after the delete wins
    const theirs = at(s, 9.5e15, 'a')
    expect(merge(mine, theirs).cards.some((c) => c.id === 'a')).toBe(true)
  })
  it('keeps a board created on the other device when its cards survive', () => {
    const s = base()
    const theirs: State = { ...s, updatedAt: 1, boards: [...s.boards, { id: 'x', name: 'Other' }], cards: [...s.cards, { id: 'z', boardId: 'x', type: 'note', title: 'Z', data: {}, u: 3 }] }
    const m = merge({ ...s, updatedAt: 9e15 }, theirs)
    expect(m.boards.map((b) => b.name)).toContain('Other')
    expect(m.boardId).toBe(s.boardId)
  })
})
