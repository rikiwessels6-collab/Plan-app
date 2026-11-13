// Card sections that use the device or the whole board: place, weather, focus timer, upcoming, colour.
import { useEffect, useState } from 'react'
import { askNotify, locate, mapsUrl } from './device'
import { useEvents } from './google'
import { Icon } from './sections'
import { nextYearly } from './sections'
import { today, useApp } from './store'

type P<T = any> = { value: T | undefined; onChange: (v: T) => void }

export const STICKY = ['', 'rose', 'sky', 'mint', 'lilac'] as const
export function Swatch({ value, onChange }: P<string>) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Colour">
      {STICKY.map((c) => (
        <button key={c} role="radio" aria-checked={(value ?? '') === c} aria-label={c || 'yellow'} data-c={c} onClick={() => onChange(c)} />
      ))}
    </div>
  )
}

function useLocate(set: (p: { lat: number; lon: number }) => void) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = () => {
    setBusy(true)
    setErr('')
    locate().then(set, (e) => setErr(e.message)).finally(() => setBusy(false))
  }
  return { busy, err, go }
}

export function Place({ value, onChange, title }: P<{ lat?: number; lon?: number }> & { title: string }) {
  const { busy, err, go } = useLocate((p) => onChange(p))
  const has = value?.lat !== undefined
  return (
    <div className="place">
      {has && (
        <a className="pin" href={mapsUrl(value!.lat!, value!.lon!, title)} target="_blank" rel="noreferrer">
          <Icon name="MapPin" />
          <span>
            <b>Open in Maps</b>
            <small>{value!.lat!.toFixed(4)}, {value!.lon!.toFixed(4)}</small>
          </span>
          <Icon name="ExternalLink" size={14} />
        </a>
      )}
      <div className="btns">
        <button className="btn soft" disabled={busy} onClick={go}>
          <Icon name="Navigation" size={14} /> {busy ? 'Finding you…' : has ? 'Update to where I am' : 'Pin where I am now'}
        </button>
        {has && <button className="btn soft" onClick={() => onChange({})}>Remove pin</button>}
      </div>
      {err && <p className="err">{err}</p>}
    </div>
  )
}

// ---------- weather (open-meteo.com: free, no account, no key) ----------
interface Wx { now: number; code: number; days: { date: string; code: number; hi: number; lo: number }[] }
const wxCache = new Map<string, { at: number; data: Wx }>()
const usesF = () => /^en-(US|BS|BZ|KY|PW)/.test(navigator.language)

async function forecast(lat: number, lon: number): Promise<Wx> {
  const key = `${lat},${lon}`
  const hit = wxCache.get(key)
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.data
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: '5',
    ...(usesF() ? { temperature_unit: 'fahrenheit' } : null),
  })
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`)
  if (!r.ok) throw new Error('The forecast is unavailable right now.')
  const j = await r.json()
  const data: Wx = {
    now: Math.round(j.current.temperature_2m),
    code: j.current.weather_code,
    days: (j.daily.time as string[]).map((date, i) => ({
      date, code: j.daily.weather_code[i], hi: Math.round(j.daily.temperature_2m_max[i]), lo: Math.round(j.daily.temperature_2m_min[i]),
    })),
  }
  wxCache.set(key, { at: Date.now(), data })
  return data
}
async function findCity(name: string): Promise<{ lat: number; lon: number; name: string }> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`)
  const hit = r.ok ? (await r.json()).results?.[0] : null
  if (!hit) throw new Error(`Could not find “${name}”.`)
  return { lat: +hit.latitude.toFixed(3), lon: +hit.longitude.toFixed(3), name: [hit.name, hit.country_code].filter(Boolean).join(', ') }
}
/** WMO weather codes to an icon and a word. */
export function sky(code: number): [icon: string, label: string] {
  if (code === 0) return ['Sun', 'Clear']
  if (code <= 2) return ['CloudSun', 'Partly cloudy']
  if (code === 3) return ['Cloud', 'Cloudy']
  if (code <= 48) return ['CloudFog', 'Fog']
  if (code <= 57) return ['CloudDrizzle', 'Drizzle']
  if (code <= 67) return ['CloudRain', 'Rain']
  if (code <= 77) return ['CloudSnow', 'Snow']
  if (code <= 82) return ['CloudRain', 'Showers']
  if (code <= 86) return ['CloudSnow', 'Snow showers']
  return ['CloudLightning', 'Thunderstorm']
}

export function Weather({ value, onChange }: P<{ lat?: number; lon?: number; name?: string }>) {
  const [wx, setWx] = useState<Wx | null>(null)
  const [err, setErr] = useState('')
  const [city, setCity] = useState('')
  const [busy, setBusy] = useState(false)
  const loc = useLocate((p) => onChange({ ...p, name: 'My location' }))
  const has = value?.lat !== undefined
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const wake = () => document.visibilityState === 'visible' && setTick((n) => n + 1)
    document.addEventListener('visibilitychange', wake)
    addEventListener('online', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      removeEventListener('online', wake)
    }
  }, [])
  useEffect(() => {
    if (!has) return setWx(null)
    let off = false
    setErr('')
    forecast(value!.lat!, value!.lon!).then((d) => !off && setWx(d), (e) => !off && setErr(/fetch|network|load failed/i.test(e.message ?? '') ? 'Offline. The forecast will load when you are back online.' : e.message || 'The forecast is unavailable right now.'))
    return () => {
      off = true
    }
  }, [has, value?.lat, value?.lon, tick])

  if (!has)
    return (
      <form
        className="wx-setup"
        onSubmit={(e) => {
          e.preventDefault()
          if (!city.trim()) return
          setBusy(true)
          setErr('')
          findCity(city.trim()).then(onChange, (x) => setErr(x.message)).finally(() => setBusy(false))
        }}
      >
        <div className="field">
          <input value={city} placeholder="City" aria-label="City" enterKeyHint="search" onChange={(e) => setCity(e.target.value)} />
          <button className="btn soft" disabled={busy || !city.trim()}>{busy ? '…' : 'Show'}</button>
        </div>
        <button type="button" className="btn soft" disabled={loc.busy} onClick={loc.go}>
          <Icon name="Navigation" size={14} /> {loc.busy ? 'Finding you…' : 'Use where I am'}
        </button>
        {(err || loc.err) && <p className="err">{err || loc.err}</p>}
        <p className="hint">Forecast by Open-Meteo. Only the location is sent.</p>
      </form>
    )
  const [icon, label] = sky(wx?.code ?? 3)
  return (
    <div className="wx">
      <div className="wx-now">
        <Icon name={wx ? icon : 'Cloud'} size={34} />
        <div>
          <div className="bigno">{wx ? `${wx.now}°` : '–'}</div>
          <div className="hint">{wx ? label : err || 'Loading…'}</div>
        </div>
      </div>
      {wx && (
        <div className="wx-days">
          {wx.days.map((d, i) => (
            <div key={d.date} title={sky(d.code)[1]}>
              <small>{i === 0 ? 'Today' : new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</small>
              <Icon name={sky(d.code)[0]} size={17} />
              <b>{d.hi}°</b>
              <span>{d.lo}°</span>
            </div>
          ))}
        </div>
      )}
      <button className="wx-where" onClick={() => onChange({})}>
        <Icon name="MapPin" size={12} /> {value!.name || 'Location'} · Change
      </button>
    </div>
  )
}

// ---------- focus timer ----------
interface Timer { mins?: number; endsAt?: number; left?: number; done?: Record<string, number> }
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export function FocusTimer({ value, onChange, title }: P<Timer> & { title: string }) {
  const v = value ?? {}
  const mins = v.mins ?? 25
  const total = mins * 60000
  const [now, setNow] = useState(Date.now())
  const running = !!v.endsAt
  const left = running ? v.endsAt! - now : v.left ?? total
  const day = today()

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(iv)
  }, [running])
  const R = 54, C = 2 * Math.PI * R
  const frac = Math.max(0, Math.min(1, left / total))
  return (
    <div className="timer">
      <div className="ring" role="timer" aria-label={`${mmss(left)} left`}>
        <svg viewBox="0 0 120 120" aria-hidden>
          <circle cx="60" cy="60" r={R} className="track" />
          <circle cx="60" cy="60" r={R} className="arc" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
        </svg>
        <b>{mmss(left)}</b>
      </div>
      <div className="btns">
        {running ? (
          <button className="btn" onClick={() => onChange({ ...v, endsAt: undefined, left: Math.max(1000, v.endsAt! - Date.now()) })}>
            <Icon name="Pause" size={14} /> Pause
          </button>
        ) : (
          <button className="btn" onClick={() => (askNotify(), setNow(Date.now()), onChange({ ...v, endsAt: Date.now() + (v.left ?? total), left: undefined }))}>
            <Icon name="Play" size={14} /> {v.left ? 'Resume' : 'Start'}
          </button>
        )}
        {(running || v.left) && (
          <button className="btn soft" onClick={() => onChange({ ...v, endsAt: undefined, left: undefined })}>
            <Icon name="RotateCcw" size={14} /> Reset
          </button>
        )}
      </div>
      {!running && !v.left && (
        <div className="moods" role="radiogroup" aria-label="Length">
          {[5, 15, 25, 50].map((m) => (
            <button key={m} role="radio" aria-checked={mins === m} className={mins === m ? 'on' : ''} onClick={() => onChange({ ...v, mins: m })}>{m} min</button>
          ))}
        </div>
      )}
      <p className="hint">{v.done?.[day] ? `${v.done[day]} session${v.done[day] > 1 ? 's' : ''} today` : 'No sessions yet today'}</p>
    </div>
  )
}

// ---------- upcoming: every dated thing on the board, plus Google Calendar ----------
interface Up { key: string; when: Date; label: string; cardId?: string; url?: string; time?: string }
const dayOf = (s: string) => new Date(`${s}T00:00:00`)
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

export function Upcoming() {
  const { state, jumpTo } = useApp()
  const g = useEvents(14)
  const start = dayOf(today())
  const end = new Date(start)
  end.setDate(end.getDate() + 30)
  const items: Up[] = []
  for (const c of state.cards) {
    if (c.boardId !== state.boardId) continue
    for (const [k, v] of Object.entries(c.data)) {
      if (k.startsWith('_')) continue
      if (Array.isArray(v)) {
        // birthdays and anniversaries come round every year
        v.forEach((r: any, i) => isDate(r?.date) && items.push({ key: `${c.id}${k}${i}`, when: dayOf(c.type === 'dates' ? nextYearly(r.date) : r.date), label: r.label || c.title, cardId: c.id }))
      } else if (isDate(v)) items.push({ key: c.id + k, when: dayOf(v), label: c.title, cardId: c.id })
      else if (c.type === 'month' && v && typeof v === 'object')
        for (const [d, note] of Object.entries(v)) if (isDate(d) && note) items.push({ key: c.id + d, when: dayOf(d), label: String(note), cardId: c.id })
    }
  }
  for (const e of g.data)
    items.push({
      key: e.account + e.id, when: e.start, label: e.title, url: e.url,
      time: e.allDay ? undefined : e.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    })
  const list = items.filter((i) => i.when >= start && i.when < end).sort((a, b) => a.when.getTime() - b.when.getTime()).slice(0, 12)
  if (!list.length) return <p className="hint">Nothing dated in the next 30 days. Dates from Birthdays, Reminders, Countdown and Month cards, and your Google Calendar, appear here.</p>
  const rel = (d: Date) => {
    const n = Math.round((dayOf(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).getTime() - start.getTime()) / 86400000)
    return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  }
  return (
    <ul className="upcoming">
      {list.map((i) => {
        const body = (
          <>
            <time className={rel(i.when) === 'Today' ? 'now' : ''}>{rel(i.when)}{i.time ? ` · ${i.time}` : ''}</time>
            <span>{i.label}</span>
          </>
        )
        return (
          <li key={i.key}>
            {i.url ? <a href={i.url} target="_blank" rel="noreferrer">{body}</a> : <button onClick={() => i.cardId && jumpTo(i.cardId)}>{body}</button>}
          </li>
        )
      })}
    </ul>
  )
}
