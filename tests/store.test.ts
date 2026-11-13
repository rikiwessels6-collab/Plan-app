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

describe('review fixes', () => {
  const base = (): State => run(boot(), { t: 'addCard', id: 'a', type: 'today', title: 'A' }).present!
  const edit = (s: State, a: Action) => reducer({ ...emptyHistory, present: s }, a).present!

  it('keeps edits made to different parts of one card on two devices', async () => {
    const s = base()
    const phone = edit(s, { t: 'setData', id: 'a', key: 'top', value: [{ text: 'milk', done: true }] })
    await new Promise((r) => setTimeout(r, 3))
    const laptop = edit(edit(s, { t: 'setData', id: 'a', key: 'rest', value: [{ text: 'eggs', done: false }] }), { t: 'patchCard', id: 'a', patch: { title: 'Renamed' } })
    for (const m of [merge(phone, laptop), merge(laptop, phone)]) {
      const c = m.cards.find((x) => x.id === 'a')!
      expect(c.data.top).toEqual([{ text: 'milk', done: true }])
      expect(c.data.rest).toEqual([{ text: 'eggs', done: false }])
      expect(c.title).toBe('Renamed')
    }
    // and once combined, both sides agree and stop changing
    const m = merge(phone, laptop)
    expect(merge(m, laptop)).toBe(m)
    expect(merge(laptop, m).cards.find((x) => x.id === 'a')).toEqual(m.cards.find((x) => x.id === 'a'))
  })
  it('does not let a new-day clear-out overwrite newer work from another device', async () => {
    const s = edit(base(), { t: 'setData', id: 'a', key: 'top', value: [{ text: 'old', done: true }] })
    const stale = { ...s, cards: s.cards.map((c) => (c.id === 'a' ? { ...c, data: { ...c.data, _day: '2000-01-01' } } : c)) }
    await new Promise((r) => setTimeout(r, 3))
    const phone = edit(stale, { t: 'setData', id: 'a', key: 'top', value: [{ text: 'old', done: true }, { text: 'added at night', done: false }] })
    const laptop = edit(stale, { t: 'rollover', day: '2999-01-01' })
    expect(laptop.cards.find((c) => c.id === 'a')!.u).toBe(stale.cards.find((c) => c.id === 'a')!.u)
    expect(merge(laptop, phone).cards.find((c) => c.id === 'a')!.data.top).toHaveLength(2)
  })
  it('keeps a blank board and a rename made on the other device', async () => {
    const s = base()
    const a = edit(edit(s, { t: 'addBoard', name: 'Blank one' }), { t: 'setBoard', id: s.boardId })
    const a2 = edit(a, { t: 'renameBoard', name: 'Renamed board' })
    await new Promise((r) => setTimeout(r, 3))
    const b = edit(s, { t: 'setData', id: 'a', key: 'top', value: [] }) // newer overall
    const names = merge(b, a2).boards.map((x) => x.name).sort()
    expect(names).toEqual(['Blank one', 'Renamed board'])
  })
  it('keeps a deleted board deleted, and spreads a deletion the other side has not seen', async () => {
    const two = edit(base(), { t: 'addBoard', name: 'Temp' })
    const removed = edit(two, { t: 'removeBoard' })
    expect(merge(removed, two).boards).toHaveLength(1)
    expect(merge(two, removed).boards).toHaveLength(1)
    const s = base()
    const gone = edit(s, { t: 'removeCard', id: 'a' })
    const third: State = { ...gone, cards: gone.cards, deleted: {} } // a copy that never heard about the delete
    expect(merge(third, gone)).not.toBe(third)
    expect(merge(third, gone).deleted!.a).toBeGreaterThan(0)
  })
  it('restoring a backup wins over what is there and marks the rest deleted', () => {
    const s = edit(base(), { t: 'addCard', id: 'extra', type: 'note' })
    const backup: State = { ...s, cards: s.cards.filter((c) => c.id !== 'extra').map((c) => ({ ...c, u: 1 })) }
    const h = reducer({ ...emptyHistory, present: s }, { t: 'restore', state: backup })
    expect(h.present!.cards.some((c) => c.id === 'extra')).toBe(false)
    expect(h.present!.deleted!.extra).toBeGreaterThan(0)
    expect(merge(h.present!, s).cards.some((c) => c.id === 'extra')).toBe(false)
  })
  it('repairs or rejects data that is not a valid board', async () => {
    const { normalize } = await import('../src/store')
    expect(normalize(null)).toBeNull()
    expect(normalize({ cards: [], boards: [] })).toBeNull()
    const fixed = normalize({ boards: [{ id: 'b' }], boardId: 'nope', cards: [{ id: 'c', type: 'note', boardId: 'b' }, { id: 'd', type: 'note', boardId: 'missing' }, 7] })!
    expect(fixed.boardId).toBe('b')
    expect(fixed.spaces).toEqual([])
    expect(fixed.cols).toBe(4)
    expect(fixed.cards).toEqual([{ id: 'c', type: 'note', boardId: 'b', title: '', data: {} }])
  })
  it('makes one undo step of a whole drag', () => {
    let h = run(boot(), { t: 'addCard', id: 'a', type: 'todo', title: 'A' }, { t: 'addCard', id: 'b', type: 'todo', title: 'B' }, { t: 'addCard', id: 'c', type: 'todo', title: 'C' })
    const before = titles(h)
    h = run(h, { t: 'moveCard', id: 'c', afterId: 'b' }, { t: 'moveCard', id: 'c', afterId: 'a' })
    h = run(h, { t: 'undo' })
    expect(titles(h)).toEqual(before)
  })
})
