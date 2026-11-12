import { icons } from './icons'
import { useRef, useState, type KeyboardEvent } from 'react'
import { addToCalendar, hasContactPicker, parseVcards, pickContacts, type Person as Contact } from './device'
import { FocusTimer, Place, Swatch, Upcoming, Weather } from './extras'
import { GoogleAgenda, GoogleInbox } from './GoogleSections'
import type { Section } from './types'

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const C = icons[name] ?? icons.Circle
  return <C size={size} strokeWidth={1.9} aria-hidden />
}

type P<T = any> = { value: T | undefined; onChange: (v: T) => void }

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const day = (s: string) => new Date(`${s}T00:00:00`)
const daysUntil = (s: string) => Math.round((day(s).getTime() - day(iso(new Date())).getTime()) / 86400000)
const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

/** Rows that always end in one empty row; Enter and Backspace move between rows. */
function useRows<T>(value: T[] | undefined, empty: (r: T) => boolean, blank: () => T, min: number, onChange: (v: T[]) => void) {
  const rows = [...(value ?? [])]
  while (rows.length < min || !empty(rows[rows.length - 1])) rows.push(blank())
  const ref = useRef<HTMLDivElement>(null)
  const commit = (next: T[]) => {
    const out = [...next]
    while (out.length && empty(out[out.length - 1])) out.pop()
    onChange(out)
  }
  const set = (i: number, patch: Partial<T>) => commit(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const at = (i: number) => ref.current?.querySelectorAll<HTMLElement>('[data-row]')[i]
  // focus straight away when the row exists, so fast typing after Enter lands in the new row
  const focus = (i: number, wait = false) => (wait ? requestAnimationFrame(() => at(i)?.focus()) : at(i)?.focus())
  const onKey = (i: number) => (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      focus(i + 1)
    } else if (e.key === 'Backspace' && e.currentTarget.value === '' && i > 0 && i < (value?.length ?? 0)) {
      e.preventDefault()
      commit(rows.filter((_, j) => j !== i))
      focus(i - 1, true)
    }
  }
  return { rows, ref, set, onKey }
}

interface Item { text: string; done: boolean }
function Checklist({ value, onChange, rows: min = 3, placeholder }: P<Item[]> & { rows?: number; placeholder?: string }) {
  const { rows, ref, set, onKey } = useRows<Item>(value, (r) => !r.text, () => ({ text: '', done: false }), min, onChange)
  // pasting several lines makes several items (and understands "- [x] done" style lists)
  const paste = (i: number) => (e: React.ClipboardEvent) => {
    const lines = e.clipboardData.getData('text').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) return
    e.preventDefault()
    const items = lines.map((l) => {
      const m = l.match(/^(?:[-*•]\s*)?(?:\[( |x|X)\]\s*)?(?:\d+[.)]\s+)?(.*)$/)!
      return { text: m[2] || l, done: !!m[1]?.trim() }
    })
    const cur = (value ?? []).slice()
    cur.splice(rows[i].text ? i + 1 : i, rows[i].text ? 0 : 1, ...items)
    onChange(cur.filter((r) => r.text))
  }
  return (
    <div className="rows" ref={ref}>
      {rows.map((r, i) => (
        <div className={`row${r.done ? ' done' : ''}`} key={i}>
          <button
            className="check" aria-label={r.done ? 'Mark not done' : 'Mark done'} aria-pressed={r.done}
            disabled={!r.text} onClick={() => set(i, { done: !r.done })}
          >
            <Icon name="Check" size={12} />
          </button>
          <Grow
            data-row value={r.text} placeholder={i === 0 ? placeholder : undefined} aria-label="Item"
            onChange={(e) => set(i, { text: e.target.value.replace(/\n/g, ' ') })} onKeyDown={onKey(i)} onPaste={paste(i)}
          />
        </div>
      ))}
    </div>
  )
}

/** Textarea that grows with its content: a hidden mirror in the same grid cell sets the height. */
function Grow({ value, className = '', ...rest }: { value: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className={`grow ${className}`} data-v={value || rest.placeholder || ''}>
      <textarea rows={1} value={value} {...rest} />
    </div>
  )
}

function Text({ value, onChange, placeholder, look }: P<string> & { placeholder?: string; look?: string }) {
  return <Grow className={`text ${look ?? ''}`} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
}

export async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file)
  const k = Math.min(1, 1400 / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.82)
}

function Photo({ value, onChange }: P<{ src?: string; caption?: string }>) {
  const v = value ?? {}
  const pick = async (f?: File) => f && onChange({ ...v, src: await shrink(f) })
  if (!v.src)
    return (
      <label className="drop">
        <Icon name="ImagePlus" size={20} />
        <span>Add a photo</span>
        <input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </label>
    )
  return (
    <figure className="photo">
      <img src={v.src} alt={v.caption || 'Photo'} />
      <button className="ghost over" aria-label="Remove photo" onClick={() => onChange({ ...v, src: undefined })}>
        <Icon name="X" size={14} />
      </button>
      <input
        className="caption" value={v.caption ?? ''} placeholder="Caption"
        onChange={(e) => onChange({ ...v, caption: e.target.value })}
      />
    </figure>
  )
}

function Photos({ value, onChange }: P<string[]>) {
  const v = value ?? []
  const add = async (files: FileList | null) => {
    if (!files) return
    onChange([...v, ...(await Promise.all([...files].map(shrink)))])
  }
  return (
    <div className="grid">
      {v.map((src, i) => (
        <div className="cell" key={i}>
          <img src={src} alt="" />
          <button className="ghost over" aria-label="Remove photo" onClick={() => onChange(v.filter((_, j) => j !== i))}>
            <Icon name="X" size={12} />
          </button>
        </div>
      ))}
      <label className="cell add">
        <Icon name="Plus" size={18} />
        <input type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      </label>
    </div>
  )
}

function MonthNav({ ym, set }: { ym: Date; set: (d: Date) => void }) {
  const go = (n: number) => set(new Date(ym.getFullYear(), ym.getMonth() + n, 1))
  return (
    <div className="monthnav">
      <button className="ghost" aria-label="Previous month" onClick={() => go(-1)}><Icon name="ChevronLeft" /></button>
      <span className="long">{ym.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
      <span className="short">{ym.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
      <button className="ghost" aria-label="Next month" onClick={() => go(1)}><Icon name="ChevronRight" /></button>
    </div>
  )
}

function Habit({ value, onChange }: P<Record<string, boolean>>) {
  const v = value ?? {}
  const [ym, setYm] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const n = new Date(ym.getFullYear(), ym.getMonth() + 1, 0).getDate()
  const today = iso(new Date())
  let streak = 0
  for (const d = new Date(); v[iso(d)]; d.setDate(d.getDate() - 1)) streak++
  return (
    <div>
      <MonthNav ym={ym} set={setYm} />
      <div className="dots">
        {Array.from({ length: n }, (_, i) => {
          const k = iso(new Date(ym.getFullYear(), ym.getMonth(), i + 1))
          return (
            <button
              key={k} className={`dot${v[k] ? ' on' : ''}${k === today ? ' today' : ''}`} aria-pressed={!!v[k]}
              aria-label={`Day ${i + 1}`} onClick={() => onChange({ ...v, [k]: !v[k] })}
            >
              {i + 1}
            </button>
          )
        })}
      </div>
      <p className="hint">{streak ? `${streak} day${streak > 1 ? 's' : ''} in a row` : 'Tap a day when you did it.'}</p>
    </div>
  )
}

interface Amt { label: string; amount: number | '' }
function Amounts({ value, onChange, budget }: P<{ budget?: number | ''; rows?: Amt[] }> & { budget?: boolean }) {
  const v = value ?? {}
  const { rows, ref, set, onKey } = useRows<Amt>(
    v.rows, (r) => !r.label && r.amount === '', () => ({ label: '', amount: '' }), 3,
    (r) => onChange({ ...v, rows: r }),
  )
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const cap = Number(v.budget) || 0
  return (
    <div>
      {budget && (
        <div className="budget">
          <div className="bigno">{money(cap - total)}</div>
          <div className="hint">
            left of{' '}
            <input
              className="inline" type="number" inputMode="decimal" value={v.budget ?? ''} placeholder="budget"
              aria-label="Budget" onChange={(e) => onChange({ ...v, budget: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          </div>
          <div className="bar"><i style={{ width: `${cap ? Math.min(100, (total / cap) * 100) : 0}%` }} className={total > cap ? 'over' : ''} /></div>
        </div>
      )}
      <div className="rows" ref={ref}>
        {rows.map((r, i) => (
          <div className="row two" key={i}>
            <input data-row value={r.label} placeholder={i === 0 ? 'What' : undefined} onChange={(e) => set(i, { label: e.target.value })} onKeyDown={onKey(i)} />
            <input
              className="num" type="number" inputMode="decimal" value={r.amount} placeholder={i === 0 ? '0' : undefined}
              aria-label="Amount" onChange={(e) => set(i, { amount: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          </div>
        ))}
      </div>
      <div className="total"><span>Total</span><b>{money(total)}</b></div>
    </div>
  )
}

function Fields({ value, onChange, fields }: P<Record<string, string>> & { fields: string[] }) {
  const v = value ?? {}
  return (
    <div className="rows">
      {fields.map((f) => (
        <label className="row slot" key={f}>
          <span>{f}</span>
          <input value={v[f] ?? ''} onChange={(e) => onChange({ ...v, [f]: e.target.value })} />
        </label>
      ))}
    </div>
  )
}

function Slots({ value, onChange, labels }: P<Record<string, string>> & { labels: string[] }) {
  return <Fields value={value} onChange={onChange} fields={labels} />
}

interface DateRow { label: string; date: string }
function Dates({ value, onChange }: P<DateRow[]>) {
  const { rows, ref, set, onKey } = useRows<DateRow>(value, (r) => !r.label && !r.date, () => ({ label: '', date: '' }), 2, onChange)
  return (
    <div className="rows" ref={ref}>
      {rows.map((r, i) => {
        const n = r.date ? daysUntil(r.date) : null
        return (
          <div className="row dated" key={i}>
            <input data-row value={r.label} placeholder={i === 0 ? 'What' : undefined} onChange={(e) => set(i, { label: e.target.value })} onKeyDown={onKey(i)} />
            <input type="date" aria-label="Date" value={r.date} onChange={(e) => set(i, { date: e.target.value })} />
            {n !== null && <em className={n < 0 ? 'past' : ''}>{n === 0 ? 'today' : n > 0 ? `in ${n}d` : `${-n}d ago`}</em>}
            {r.date && (
              <button className="ghost mini" aria-label="Add to calendar" title="Add to calendar" onClick={() => addToCalendar(r.label, r.date)}>
                <Icon name="CalendarPlus" size={14} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Countdown({ value, onChange, title }: P<string> & { title: string }) {
  const n = value ? daysUntil(value) : null
  return (
    <div className="count">
      <div className="bigno">{n === null ? '–' : Math.abs(n)}</div>
      <div className="hint">{n === null ? 'Pick a date' : n === 0 ? 'It is today' : n > 0 ? `day${n > 1 ? 's' : ''} to go` : `day${n < -1 ? 's' : ''} ago`}</div>
      <input type="date" aria-label="Date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button className="ghost mini" aria-label="Add to calendar" title="Add to calendar" onClick={() => addToCalendar(title, value)}>
          <Icon name="CalendarPlus" size={14} />
        </button>
      )}
    </div>
  )
}

function LinkBox({ value, onChange }: P<string>) {
  const ok = /^https?:\/\/\S+\.\S+/.test(value ?? '')
  return (
    <div className="row link">
      <input type="url" inputMode="url" value={value ?? ''} placeholder="https://" onChange={(e) => onChange(e.target.value)} />
      {ok && (
        <a className="ghost" href={value} target="_blank" rel="noreferrer" aria-label="Open link"><Icon name="ExternalLink" /></a>
      )}
    </div>
  )
}

function NumberBox({ value, onChange }: P<{ value?: number | ''; target?: number | ''; unit?: string }>) {
  const v = value ?? {}
  const cur = Number(v.value) || 0
  const tgt = Number(v.target) || 0
  const num = (k: 'value' | 'target') => (e: any) => onChange({ ...v, [k]: e.target.value === '' ? '' : Number(e.target.value) })
  return (
    <div className="number">
      <div className="numline">
        <button className="ghost" aria-label="Decrease" onClick={() => onChange({ ...v, value: cur - 1 })}><Icon name="Minus" /></button>
        <input className="bigno" type="number" inputMode="decimal" aria-label="Value" value={v.value ?? ''} placeholder="0" onChange={num('value')} />
        <button className="ghost" aria-label="Increase" onClick={() => onChange({ ...v, value: cur + 1 })}><Icon name="Plus" /></button>
      </div>
      <div className="hint">
        of <input className="inline" type="number" inputMode="decimal" aria-label="Target" value={v.target ?? ''} placeholder="target" onChange={num('target')} />{' '}
        <input className="inline" aria-label="Unit" value={v.unit ?? ''} placeholder="unit" onChange={(e) => onChange({ ...v, unit: e.target.value })} />
      </div>
      {tgt > 0 && <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, (cur / tgt) * 100))}%` }} /></div>}
    </div>
  )
}

function Month({ value, onChange }: P<Record<string, string>>) {
  const v = value ?? {}
  const [ym, setYm] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [sel, setSel] = useState(iso(new Date()))
  const n = new Date(ym.getFullYear(), ym.getMonth() + 1, 0).getDate()
  const lead = (ym.getDay() + 6) % 7 // Monday first
  const today = iso(new Date())
  return (
    <div>
      <MonthNav ym={ym} set={setYm} />
      <div className="cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span className="dow" key={i}>{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
        {Array.from({ length: n }, (_, i) => {
          const k = iso(new Date(ym.getFullYear(), ym.getMonth(), i + 1))
          return (
            <button
              key={k} aria-pressed={k === sel} aria-label={day(k).toDateString()}
              className={`${k === sel ? 'sel' : ''} ${k === today ? 'today' : ''} ${v[k] ? 'has' : ''}`} onClick={() => setSel(k)}
            >
              {i + 1}
            </button>
          )
        })}
      </div>
      <label className="row slot">
        <span>{day(sel).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        <input value={v[sel] ?? ''} placeholder="Add a note" onChange={(e) => onChange({ ...v, [sel]: e.target.value })} />
      </label>
    </div>
  )
}

interface Person { name: string; note: string }
function People({ value, onChange }: P<Person[]>) {
  const { rows, ref, set, onKey } = useRows<Person>(value, (r) => !r.name && !r.note, () => ({ name: '', note: '' }), 3, onChange)
  const file = useRef<HTMLInputElement>(null)
  const add = (got: Contact[]) => got.length && onChange([...(value ?? []), ...got])
  const bring = async () => {
    const got = await pickContacts() // the system contact picker, where the device offers one
    if (got) add(got)
    else file.current?.click() // otherwise a contact card (.vcf) shared from Contacts
  }
  return (
    <>
    <div className="rows" ref={ref}>
      {rows.map((r, i) => (
        <div className="row person" key={i}>
          <span className="avatar">{r.name.trim()[0]?.toUpperCase() ?? ''}</span>
          <div>
            <input data-row value={r.name} placeholder={i === 0 ? 'Name' : undefined} onChange={(e) => set(i, { name: e.target.value })} onKeyDown={onKey(i)} />
            <input className="sub" value={r.note} placeholder={i === 0 ? 'Phone, role, note' : undefined} aria-label="Details" onChange={(e) => set(i, { note: e.target.value })} />
          </div>
        </div>
      ))}
    </div>
    <button className="btn soft bring" onClick={bring} title={hasContactPicker() ? undefined : 'Choose a contact card (.vcf) shared from your Contacts app'}>
      <Icon name="UserPlus" size={14} /> {hasContactPicker() ? 'Add from Contacts' : 'Import contact cards'}
    </button>
    <input
      ref={file} type="file" accept=".vcf,text/vcard,text/x-vcard" multiple hidden
      onChange={async (e) => {
        const texts = await Promise.all([...(e.target.files ?? [])].map((f) => f.text()))
        add(texts.flatMap(parseVcards))
        e.target.value = ''
      }}
    />
    </>
  )
}

interface Rate { label: string; score: number }
function Rating({ value, onChange }: P<Rate[]>) {
  const { rows, ref, set, onKey } = useRows<Rate>(value, (r) => !r.label, () => ({ label: '', score: 0 }), 3, onChange)
  const filled = rows.filter((r) => r.label)
  const avg = filled.length ? filled.reduce((s, r) => s + r.score, 0) / filled.length : 0
  return (
    <div>
      <div className="rows" ref={ref}>
        {rows.map((r, i) => (
          <div className="row rate" key={i}>
            <input data-row value={r.label} placeholder={i === 0 ? 'Area, e.g. Health' : undefined} onChange={(e) => set(i, { label: e.target.value })} onKeyDown={onKey(i)} />
            <span className="pips">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n} className={n <= r.score ? 'on' : ''} disabled={!r.label} aria-label={`${n} of 5`}
                  onClick={() => set(i, { score: r.score === n ? n - 1 : n })}
                />
              ))}
            </span>
          </div>
        ))}
      </div>
      {filled.length > 0 && <div className="total"><span>Average</span><b>{avg.toFixed(1)} / 5</b></div>}
    </div>
  )
}

const MOODS = ['Rough', 'Low', 'Okay', 'Good', 'Great']
function Mood({ value, onChange }: P<Record<string, number>>) {
  const v = value ?? {}
  const today = iso(new Date())
  const last = Array.from({ length: 14 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (13 - i))
    return iso(d)
  })
  return (
    <div>
      <div className="moods">
        {MOODS.map((m, i) => (
          <button key={m} className={v[today] === i + 1 ? 'on' : ''} aria-pressed={v[today] === i + 1} onClick={() => onChange({ ...v, [today]: i + 1 })}>
            {m}
          </button>
        ))}
      </div>
      <div className="moodline" aria-label="Last two weeks">
        {last.map((k) => <i key={k} data-m={v[k] ?? 0} title={`${k}: ${MOODS[(v[k] ?? 0) - 1] ?? 'not set'}`} />)}
      </div>
      <p className="hint">Last two weeks</p>
    </div>
  )
}

export function SectionView({ s, value, onChange, title = '' }: { s: Section; title?: string } & P) {
  const body = (() => {
    switch (s.kind) {
      case 'checklist': return <Checklist value={value} onChange={onChange} rows={s.rows} placeholder={s.placeholder} />
      case 'text': return <Text value={value} onChange={onChange} placeholder={s.placeholder} look={s.look} />
      case 'photo': return <Photo value={value} onChange={onChange} />
      case 'photos': return <Photos value={value} onChange={onChange} />
      case 'habit': return <Habit value={value} onChange={onChange} />
      case 'amounts': return <Amounts value={value} onChange={onChange} budget={s.budget} />
      case 'fields': return <Fields value={value} onChange={onChange} fields={s.fields} />
      case 'slots': return <Slots value={value} onChange={onChange} labels={s.labels} />
      case 'dates': return <Dates value={value} onChange={onChange} />
      case 'countdown': return <Countdown value={value} onChange={onChange} title={title} />
      case 'link': return <LinkBox value={value} onChange={onChange} />
      case 'number': return <NumberBox value={value} onChange={onChange} />
      case 'month': return <Month value={value} onChange={onChange} />
      case 'people': return <People value={value} onChange={onChange} />
      case 'rating': return <Rating value={value} onChange={onChange} />
      case 'mood': return <Mood value={value} onChange={onChange} />
      case 'gmail': return <GoogleInbox />
      case 'agenda': return <GoogleAgenda days={s.days} quiet={s.quiet} />
      case 'swatch': return <Swatch value={value} onChange={onChange} />
      case 'place': return <Place value={value} onChange={onChange} title={title} />
      case 'weather': return <Weather value={value} onChange={onChange} />
      case 'timer': return <FocusTimer value={value} onChange={onChange} title={title} />
      case 'upcoming': return <Upcoming />
    }
  })()
  if (body === null) return null
  const label = 'label' in s ? s.label : undefined
  const items: Item[] = s.kind === 'checklist' && Array.isArray(value) ? value.filter((r: Item) => r.text) : []
  return (
    <section className={`sec sec-${s.kind}`}>
      {label && (
        <h4>
          {label}
          {items.length > 0 && <span className={items.every((r) => r.done) ? 'all' : ''}>{items.filter((r) => r.done).length}/{items.length}</span>}
        </h4>
      )}
      {body}
    </section>
  )
}
