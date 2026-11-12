import { useState } from 'react'
import { createEvent, reconnect, refreshAll, useEvents, useGoogle, useInbox, type Account, type Ev } from './google'
import { Icon } from './sections'
import { useApp } from './store'

function Gate({ stale }: { stale: Account[] }) {
  const { openSettings } = useApp()
  const g = useGoogle()
  const [err, setErr] = useState('')
  if (!g.accounts.length)
    return (
      <div className="gate">
        <p className="hint">Connect a Google account to see this here.</p>
        <button className="btn" onClick={openSettings}>Connect Google</button>
      </div>
    )
  if (!stale.length) return null
  return (
    <div className="gate">
      {stale.map((a) => (
        <button
          key={a.email} className="btn soft"
          onClick={() => reconnect(a.email).then(() => setErr(''), (e) => setErr(e.message))}
        >
          Reconnect {a.email}
        </button>
      ))}
      {err && <p className="err">{err}</p>}
    </div>
  )
}

function Bar({ loading, label }: { loading: boolean; label: string }) {
  return (
    <div className="gbar">
      <span className="hint">{label}</span>
      <button className={`ghost${loading ? ' spin' : ''}`} aria-label="Refresh" onClick={refreshAll}>
        <Icon name="RefreshCw" size={14} />
      </button>
    </div>
  )
}

export function GoogleInbox() {
  const { data, loading, error, live, stale } = useInbox()
  const { state, dispatch } = useApp()
  const [kept, setKept] = useState<string[]>([])

  const keep = (subject: string, id: string) => {
    const home = state.cards.find((c) => c.boardId === state.boardId && c.type === 'todo' && c.title === 'From email')
    const row = { text: subject, done: false }
    if (home) dispatch({ t: 'setData', id: home.id, key: 'items', value: [...(home.data.items ?? []), row] })
    else dispatch({ t: 'addCard', type: 'todo', title: 'From email', data: { items: [row] } })
    setKept((k) => [...k, id])
  }

  return (
    <div>
      <Gate stale={stale} />
      {live.length > 0 && (
        <>
          <Bar loading={loading} label={data.length ? `${data.length} unread` : loading ? 'Checking…' : 'Nothing unread'} />
          {error && <p className="err">{error}</p>}
          <ul className="mails">
            {data.map((m) => (
              <li key={m.account + m.id}>
                <a href={m.url} target="_blank" rel="noreferrer">
                  <b>{m.from}</b>
                  <span>{m.subject}</span>
                  {live.length > 1 && <small>{m.account}</small>}
                </a>
                <button
                  className="ghost" disabled={kept.includes(m.id)} onClick={() => keep(m.subject, m.id)}
                  aria-label="Add to a to-do card" title="Add to a to-do card"
                >
                  <Icon name={kept.includes(m.id) ? 'Check' : 'ListPlus'} size={15} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function NewEvent({ accounts }: { accounts: Account[] }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const today = new Date()
  const [date, setDate] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
  )
  const [at, setAt] = useState('')
  const [acc, setAcc] = useState(accounts[0].email)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!open)
    return (
      <button className="btn soft add-ev" onClick={() => setOpen(true)}>
        <Icon name="Plus" size={14} /> New event
      </button>
    )
  const save = async () => {
    setBusy(true)
    try {
      await createEvent(acc, title.trim(), date, at)
      setTitle('')
      setOpen(false)
      setErr('')
    } catch (e: any) {
      setErr(e.message === 'expired' ? 'Reconnect this account first.' : e.message)
    }
    setBusy(false)
  }
  return (
    <form className="evform" onSubmit={(e) => (e.preventDefault(), title.trim() && save())}>
      <input autoFocus value={title} placeholder="Event title" aria-label="Event title" onChange={(e) => setTitle(e.target.value)} />
      <div>
        <input type="date" aria-label="Date" value={date} required onChange={(e) => setDate(e.target.value)} />
        <input type="time" aria-label="Start time (empty for all day)" value={at} onChange={(e) => setAt(e.target.value)} />
      </div>
      {accounts.length > 1 && (
        <select aria-label="Calendar account" value={acc} onChange={(e) => setAcc(e.target.value)}>
          {accounts.map((a) => <option key={a.email}>{a.email}</option>)}
        </select>
      )}
      {err && <p className="err">{err}</p>}
      <div>
        <button className="btn" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Add to Google Calendar'}</button>
        <button type="button" className="btn soft" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}

export function GoogleAgenda({ days, quiet }: { days: number; quiet?: boolean }) {
  const { data, loading, error, live, stale, accounts } = useEvents(days)
  // "quiet" agendas sit inside Today/Day cards: invisible until Google is connected
  if (quiet && !live.length) return null
  const groups: { day: Date; evs: Ev[] }[] = []
  for (const e of data) {
    const g = groups.find((x) => sameDay(x.day, e.start))
    if (g) g.evs.push(e)
    else groups.push({ day: e.start, evs: [e] })
  }
  const now = new Date()
  return (
    <div>
      {!quiet && <Gate stale={stale} />}
      {live.length > 0 && (
        <>
          {!quiet && <Bar loading={loading} label={days === 1 ? 'Today' : `Next ${days} days`} />}
          {error && <p className="err">{error}</p>}
          {!data.length && !loading && !quiet && <p className="hint">Nothing scheduled.</p>}
          {groups.map((g) => (
            <div className="evday" key={g.day.toDateString()}>
              {days > 1 && (
                <h4>{sameDay(g.day, now) ? 'Today' : g.day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</h4>
              )}
              {g.evs.map((e) => (
                <a className="ev" key={e.account + e.id} href={e.url} target="_blank" rel="noreferrer" style={e.color ? ({ '--ev': e.color } as React.CSSProperties) : undefined}>
                  <time>{e.allDay ? 'All day' : time(e.start)}</time>
                  <span>{e.title}</span>
                </a>
              ))}
            </div>
          ))}
          {!quiet && <NewEvent accounts={accounts.filter((a) => live.some((l) => l.email === a.email))} />}
        </>
      )}
    </div>
  )
}
