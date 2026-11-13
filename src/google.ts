// Google sign-in (browser-only OAuth token flow), Gmail and Calendar access.
// Tokens live in sessionStorage and last about an hour; Google renews them
// without a prompt while the person is still signed in to that account.
import { useEffect, useState, useSyncExternalStore } from 'react'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly', // see every calendar, not only the main one
  'https://www.googleapis.com/auth/drive.appdata', // a private app folder in Drive, used to sync the board between devices
].join(' ')

export interface Account {
  email: string
  token?: string
  exp?: number
}

const K_ID = 'plan.google.clientId'
const K_ACC = 'plan.google.accounts'
const K_TOK = 'plan.google.tokens'

const read = <T,>(store: Storage, k: string, d: T): T => {
  try {
    return JSON.parse(store.getItem(k) ?? '') as T
  } catch {
    return d
  }
}

let accounts: Account[] = (() => {
  const emails = read<string[]>(localStorage, K_ACC, [])
  const toks = read<Record<string, { token: string; exp: number }>>(sessionStorage, K_TOK, {})
  return emails.map((email) => ({ email, ...toks[email] }))
})()
let version = 0
const subs = new Set<() => void>()
function commit() {
  localStorage.setItem(K_ACC, JSON.stringify(accounts.map((a) => a.email)))
  const toks: Record<string, any> = {}
  for (const a of accounts) if (a.token) toks[a.email] = { token: a.token, exp: a.exp }
  sessionStorage.setItem(K_TOK, JSON.stringify(toks))
  version++
  subs.forEach((f) => f())
  watchExpiry()
}

// sessions end on a timer, not on an event: tell the screen when the next one runs out
let expiry = 0
function watchExpiry() {
  clearTimeout(expiry)
  const next = Math.min(...accounts.filter((a) => a.token && (a.exp ?? 0) > Date.now()).map((a) => a.exp!))
  if (Number.isFinite(next))
    expiry = window.setTimeout(() => {
      version++
      subs.forEach((f) => f())
      watchExpiry()
    }, Math.min(next - Date.now() + 500, 2 ** 31 - 1))
}
if (typeof window !== 'undefined') setTimeout(watchExpiry)

export const getClientId = (): string =>
  localStorage.getItem(K_ID) || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || ''
export function setClientId(id: string) {
  if (id.trim()) localStorage.setItem(K_ID, id.trim())
  else localStorage.removeItem(K_ID)
  version++
  subs.forEach((f) => f())
}

let gsi: Promise<void> | null = null
function loadGsi(): Promise<void> {
  gsi ??= new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.onload = () => res()
    s.onerror = () => {
      gsi = null
      rej(new Error('Could not reach Google sign-in'))
    }
    document.head.appendChild(s)
  })
  return gsi
}

async function requestToken(hint?: string): Promise<{ token: string; exp: number }> {
  const client_id = getClientId()
  if (!client_id) throw new Error('Add a Google client ID in Settings first')
  await loadGsi()
  return new Promise((res, rej) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id,
      scope: SCOPES,
      login_hint: hint,
      prompt: hint ? '' : 'select_account',
      callback: (r: any) =>
        r.error
          ? rej(new Error(r.error_description || r.error))
          : res({ token: r.access_token, exp: Date.now() + (Number(r.expires_in) - 60) * 1000 }),
      error_callback: (e: any) => rej(new Error(e?.message || 'Sign-in was closed')),
    })
    client.requestAccessToken()
  })
}

async function whoIs(token: string): Promise<string> {
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(await errText(r))
  return (await r.json()).emailAddress
}

/** Add a Google account (opens Google's account chooser). */
export async function connect(): Promise<void> {
  const t = await requestToken()
  const email = await whoIs(t.token)
  accounts = [...accounts.filter((a) => a.email !== email), { email, ...t }]
  commit()
}

/** Renew an expired session for an account already added. Call from a tap. */
export async function reconnect(email: string): Promise<void> {
  const t = await requestToken(email)
  // the hint is only a suggestion: make sure Google did not hand back a different account
  const who = await whoIs(t.token)
  if (who !== email) throw new Error(`That signed in as ${who}. Choose ${email} to reconnect it.`)
  accounts = accounts.map((a) => (a.email === email ? { email, ...t } : a))
  commit()
}

export function disconnect(email: string) {
  const a = accounts.find((x) => x.email === email)
  if (a?.token) (window as any).google?.accounts.oauth2.revoke(a.token, () => {})
  accounts = accounts.filter((x) => x.email !== email)
  commit()
}

const live = (a: Account) => !!a.token && (a.exp ?? 0) > Date.now()

async function errText(r: Response) {
  try {
    return (await r.json()).error?.message ?? `Google returned ${r.status}`
  } catch {
    return `Google returned ${r.status}`
  }
}

async function gfetch(a: Account, url: string, init?: RequestInit): Promise<any> {
  if (!live(a)) throw new Error('expired')
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  if (r.status === 401) {
    accounts = accounts.map((x) => (x.email === a.email ? { email: x.email } : x))
    commit()
    throw new Error('expired')
  }
  if (!r.ok) throw new Error(await errText(r))
  const body = await r.text()
  return body ? JSON.parse(body) : null
}

/** Call a Google API as one of the connected accounts. */
export function gapi(email: string, url: string, init?: RequestInit): Promise<any> {
  const a = accounts.find((x) => x.email === email)
  if (!a) return Promise.reject(new Error('That Google account is not connected.'))
  return gfetch(a, url, init)
}

export function useGoogle() {
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => version,
  )
  return { accounts, clientId: getClientId(), live: accounts.filter(live), stale: accounts.filter((a) => !live(a)) }
}

// ---------- Gmail ----------
export interface Mail {
  id: string
  account: string
  from: string
  subject: string
  snippet: string
  date: number
  url: string
}

async function inbox(a: Account): Promise<Mail[]> {
  const base = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'
  const list = await gfetch(a, `${base}?q=${encodeURIComponent('in:inbox is:unread')}&maxResults=8`)
  const msgs = await Promise.all(
    ((list.messages ?? []) as { id: string }[]).map((m) =>
      gfetch(a, `${base}/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`),
    ),
  )
  return msgs.map((m) => {
    const h = (n: string) => m.payload?.headers?.find((x: any) => x.name.toLowerCase() === n)?.value ?? ''
    return {
      id: m.id,
      account: a.email,
      from: h('from').replace(/\s*<.*>/, '').replace(/"/g, '') || h('from'),
      subject: h('subject') || '(no subject)',
      snippet: m.snippet ?? '',
      date: Number(m.internalDate),
      url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(a.email)}#inbox/${m.threadId}`,
    }
  })
}

// ---------- Calendar ----------
export interface Ev {
  id: string
  account: string
  title: string
  start: Date
  allDay: boolean
  url?: string
  color?: string
}

const calCache = new Map<string, { at: number; list: { id: string; color?: string }[] }>()
/** The calendars this person has ticked in Google Calendar. Falls back to the main one. */
async function calendars(a: Account): Promise<{ id: string; color?: string }[]> {
  const hit = calCache.get(a.email)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.list
  let list: { id: string; color?: string }[] = [{ id: 'primary' }]
  try {
    const r = await gfetch(a, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=50')
    const got = ((r.items ?? []) as any[]).filter((c) => c.selected && !c.hidden).slice(0, 10).map((c) => ({ id: c.id as string, color: c.backgroundColor as string }))
    if (got.length) list = got
  } catch (e: any) {
    if (e?.message === 'expired') throw e
    // connected before this permission existed: the main calendar still works
  }
  if (list[0].id !== 'primary') calCache.set(a.email, { at: Date.now(), list }) // a failed lookup is retried next time
  return list
}

async function events(a: Account, days: number): Promise<Ev[]> {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + days)
  const q = new URLSearchParams({
    timeMin: from.toISOString(), timeMax: to.toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '40',
  })
  const cals = await calendars(a)
  const per = await Promise.all(
    cals.map((c) =>
      gfetch(a, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?${q}`).then(
        (r) => ((r.items ?? []) as any[]).map((e) => ({ e, color: c.color })),
        (err) => {
          if (c.id === 'primary' || cals.length === 1 || err?.message === 'expired') throw err
          return [] // one unreadable shared calendar should not hide the rest
        },
      ),
    ),
  )
  const once = new Set<string>()
  return per
    .flat()
    // the same event can sit on two of someone's calendars
    .filter(({ e }) => e.status !== 'cancelled' && e.start && !once.has(e.id) && !!once.add(e.id))
    .map(({ e, color }) => ({
      id: e.id,
      account: a.email,
      title: e.summary || '(no title)',
      // all-day dates are plain YYYY-MM-DD: parse as local midnight, not UTC
      start: e.start.dateTime ? new Date(e.start.dateTime) : new Date(`${e.start.date}T00:00:00`),
      allDay: !e.start.dateTime,
      url: e.htmlLink,
      color,
    }))
    // an all-day event that started earlier is still returned by Google; show it under today
    .map((ev) => (ev.start < from ? { ...ev, start: new Date(from) } : ev))
    .filter((ev) => ev.start < to)
}

export async function createEvent(email: string, title: string, date: string, time: string): Promise<void> {
  const a = accounts.find((x) => x.email === email)
  if (!a) throw new Error('Account not connected')
  let body: any
  if (time) {
    const start = new Date(`${date}T${time}`)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    body = { summary: title, start: { dateTime: start.toISOString(), timeZone }, end: { dateTime: end.toISOString(), timeZone } }
  } else {
    const next = new Date(`${date}T00:00:00`)
    next.setDate(next.getDate() + 1)
    const p = (n: number) => String(n).padStart(2, '0')
    body = {
      summary: title,
      start: { date },
      end: { date: `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())}` },
    }
  }
  await gfetch(a, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST', body: JSON.stringify(body),
  })
  refreshAll()
}

// ---------- shared loader ----------
let tick = 0
const tickSubs = new Set<() => void>()
export function refreshAll() {
  tick++
  tickSubs.forEach((f) => f())
}

function useLoad<T>(fn: (a: Account) => Promise<T[]>, sort: (x: T, y: T) => number, dep: unknown) {
  const g = useGoogle()
  const t = useSyncExternalStore(
    (f) => (tickSubs.add(f), () => tickSubs.delete(f)),
    () => tick,
  )
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const key = g.live.map((a) => a.email + a.exp).join()
  useEffect(() => {
    if (!g.live.length) {
      setData([])
      return
    }
    let off = false
    const run = async () => {
      setLoading(true)
      const rs = await Promise.allSettled(g.live.map(fn))
      if (off) return
      setData(rs.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).sort(sort))
      const bad = rs.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
      setError(bad && bad.reason?.message !== 'expired' ? String(bad.reason?.message ?? bad.reason) : '')
      setLoading(false)
    }
    run()
    const iv = setInterval(run, 5 * 60 * 1000)
    return () => {
      off = true
      clearInterval(iv)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, t, dep])
  return { data, loading, error, ...g }
}

export const useInbox = () => useLoad(inbox, (a, b) => b.date - a.date, 0)
export const useEvents = (days: number) =>
  useLoad((a) => events(a, days), (a, b) => a.start.getTime() - b.start.getTime(), days)
