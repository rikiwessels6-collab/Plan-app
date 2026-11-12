// One box for everything: jump to a card, capture a thought into a list, make a new card, run a command.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CATALOG, typeOf } from './catalog'
import { Icon } from './sections'
import type { Card } from './types'

export interface Command { name: string; icon: string; run: () => void; hint?: string }
interface Item { key: string; icon: string; label: string; hint?: string; group: string; run: () => void; stay?: boolean }

const text = (c: Card) =>
  (c.title + ' ' + JSON.stringify(c.data, (k, v) => (k.startsWith('_') || (typeof v === 'string' && v.startsWith('data:')) ? undefined : v))).toLowerCase()
export const listKey = (c: Card) => typeOf(c.type).sections.find((s) => s.kind === 'checklist')?.key
const CAPTURE = ['today', 'inbox', 'todo', 'next', 'shopping']

export function Palette({ cards, commands, onClose, onJump, onNew, onCapture }: {
  cards: Card[]
  commands: Command[]
  onClose: () => void
  onJump: (id: string) => void
  onNew: (type: string) => void
  onCapture: (card: Card, key: string, text: string) => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const items = useMemo<Item[]>(() => {
    const n = q.trim().toLowerCase()
    const out: Item[] = []
    const jump = (c: Card): Item => ({
      key: 'j' + c.id, icon: typeOf(c.type).icon, label: c.title || 'Untitled', group: 'Cards', hint: typeOf(c.type).name === c.title ? undefined : typeOf(c.type).name,
      run: () => onJump(c.id),
    })
    if (!n) {
      cards.slice(0, 6).forEach((c) => out.push(jump(c)))
      commands.forEach((c) => out.push({ key: 'c' + c.name, icon: c.icon, label: c.name, hint: c.hint, group: 'Actions', run: c.run }))
      return out
    }
    const lists = cards
      .filter((c) => listKey(c))
      .sort((a, b) => (CAPTURE.indexOf(a.type) + 1 || 99) - (CAPTURE.indexOf(b.type) + 1 || 99))
      .slice(0, 3)
    lists.forEach((c) =>
      out.push({
        key: 'a' + c.id, icon: 'Plus', label: `Add “${q.trim()}”`, hint: `to ${c.title || 'Untitled'}`, group: 'Capture', stay: true,
        run: () => onCapture(c, listKey(c)!, q.trim()),
      }),
    )
    cards.filter((c) => text(c).includes(n)).slice(0, 6).forEach((c) => out.push(jump(c)))
    CATALOG.filter((t) => t.name.toLowerCase().includes(n)).slice(0, 5).forEach((t) =>
      out.push({ key: 't' + t.id, icon: t.icon, label: t.name, hint: 'New card', group: 'Create', run: () => onNew(t.id) }),
    )
    commands.filter((c) => c.name.toLowerCase().includes(n)).forEach((c) => out.push({ key: 'c' + c.name, icon: c.icon, label: c.name, hint: c.hint, group: 'Actions', run: c.run }))
    return out
  }, [q, cards, commands, onJump, onNew, onCapture])

  // with text typed, the best match is the first card or command, not "capture" (unless nothing else matches)
  useEffect(() => {
    const first = items.findIndex((i) => i.group !== 'Capture')
    setSel(q.trim() && first > 0 && items[first].label.toLowerCase().startsWith(q.trim().toLowerCase()) ? first : 0)
  }, [q, items])
  useEffect(() => {
    list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  useEffect(() => {
    document.documentElement.classList.add('locked')
    return () => document.documentElement.classList.remove('locked')
  }, [])

  const go = (i: Item) => {
    i.run()
    if (i.stay) {
      setQ('')
      input.current?.focus()
    } else onClose()
  }
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)))
    else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)))
    else if (e.key === 'Enter' && items[sel]) (e.preventDefault(), go(items[sel]))
    else if (e.key === 'Escape') (e.preventDefault(), onClose())
  }

  let group = ''
  return (
    <div className="scrim top" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal aria-label="Search and capture" onKeyDown={key}>
        <div className="palette-in">
          <Icon name="Search" size={18} />
          <input
            ref={input} autoFocus value={q} placeholder="Search, or type something to add" aria-label="Search or add"
            role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={items[sel] ? `p-${items[sel].key}` : undefined}
            enterKeyHint="go" autoCapitalize="sentences" onChange={(e) => setQ(e.target.value)}
          />
          <button className="ghost" aria-label="Close" onClick={onClose}><Icon name="X" size={16} /></button>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {items.map((i, n) => {
            const head = i.group !== group ? (group = i.group) : ''
            return (
              <div key={i.key}>
                {head && <h3>{head}</h3>}
                <button
                  id={`p-${i.key}`} role="option" aria-selected={n === sel} tabIndex={-1}
                  onPointerMove={() => n !== sel && setSel(n)} onClick={() => go(i)}
                >
                  <span><Icon name={i.icon} size={16} /></span>
                  <b>{i.label}</b>
                  {i.hint && <small>{i.hint}</small>}
                  {n === sel && <kbd>↵</kbd>}
                </button>
              </div>
            )
          })}
          {!items.length && <p className="hint none">Nothing matches “{q.trim()}”.</p>}
        </div>
      </div>
    </div>
  )
}
