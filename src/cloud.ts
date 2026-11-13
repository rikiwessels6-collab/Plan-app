// The Plan account: sync between devices and shared boards, through the app's own backend (worker/index.ts).
// There are no passwords. A device creates an account silently and holds a secret; another device joins
// with a short code; another person joins one board with an invitation link.
// Each board is stored as its own document, so sharing one board shares nothing else.
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { merge, normalize, slice, type Action } from './store'
import type { State } from './types'

interface Account { userId: string; key: string; name?: string }
export interface CloudStatus {
  available: boolean | null // null while we find out whether this copy of the app has a backend
  account: Account | null
  phase: 'idle' | 'syncing' | 'error'
  at?: number
  error?: string
  /** how many people can open each board (by board id) */
  people: Record<string, number>
  /** bumped to ask for a sync right now */
  nudge: number
}

const K = 'plan.cloud'
const K_REV = 'plan.cloud.revs'
const read = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '') as T
  } catch {
    return d
  }
}
let status: CloudStatus = { available: null, account: read<Account | null>(K, null), phase: 'idle', people: {}, nudge: 0 }
const subs = new Set<() => void>()
const set = (p: Partial<CloudStatus>) => {
  status = { ...status, ...p }
  subs.forEach((f) => f())
}
export const useCloud = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => status)
export const cloud = () => status
export const syncSoon = () => set({ nudge: status.nudge + 1 })

// what the server had when this device last looked: revision and a fingerprint of what we last sent or received
let seen: Record<string, { rev: number; sig: string }> = read(K_REV, {})
const remember = () => localStorage.setItem(K_REV, JSON.stringify(seen))
const fingerprint = (s: string) => {
  let a = 0x811c9dc5, b = 0x1b873593
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x85ebca6b) + a
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36) + s.length.toString(36)
}

class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) {
    super(message)
  }
}
async function call(path: string, init: RequestInit & { raw?: boolean } = {}, acc: Account | null = status.account): Promise<any> {
  const r = await fetch(`./api/${path}`, {
    ...init,
    headers: { ...(acc ? { authorization: `Bearer ${acc.userId}.${acc.key}` } : null), ...init.headers },
  })
  if (init.raw && r.ok) return r.text()
  const data = await r.json().catch(() => null)
  if (!r.ok) {
    if (r.status === 401 && acc && acc === status.account) signOut(true) // this device was signed out elsewhere
    throw new ApiError(r.status, data?.error ?? `The server answered ${r.status}`, data)
  }
  return data
}

/** Find out once whether this copy of the app is served with its backend. */
export function detect() {
  if (status.available !== null) return
  fetch('./api/health').then((r) => r.json()).then((j) => set({ available: j?.ok === true }), () => set({ available: false }))
}

function adopt(acc: Account) {
  localStorage.setItem(K, JSON.stringify(acc))
  set({ account: acc, error: undefined })
}
export async function createAccount(name = ''): Promise<void> {
  adopt({ ...(await call('account', { method: 'POST', body: JSON.stringify({ name }) }, null)), name })
}
export const ensureAccount = () => (status.account ? Promise.resolve() : createAccount())
export async function setName(name: string) {
  await call('me', { method: 'PUT', body: JSON.stringify({ name }) })
  adopt({ ...status.account!, name })
}
/** A code to type on another device, valid for ten minutes. */
export const linkCode = async (): Promise<string> => (await call('link/code', { method: 'POST' })).code
export async function redeem(code: string): Promise<void> {
  const acc = await call('link/redeem', { method: 'POST', body: JSON.stringify({ code }) }, null)
  seen = {}
  remember()
  adopt(acc)
  call('me').then((me) => me?.name && adopt({ ...acc, name: me.name }), () => {})
}
export function signOut(silent = false) {
  if (!silent && status.account) call('signout', { method: 'POST' }).catch(() => {})
  localStorage.removeItem(K)
  localStorage.removeItem(K_REV)
  seen = {}
  lastRemote.clear()
  onServer.clear()
  set({ account: null, people: {}, phase: 'idle', at: undefined })
}
/** A link that lets someone else open and edit this one board. Valid for a week. */
export async function invite(boardId: string): Promise<string> {
  await ensureAccount()
  for (let i = 0; ; i++) {
    try {
      return `${location.origin}${location.pathname}#join=${(await call(`docs/${boardId}/invite`, { method: 'POST' })).token}`
    } catch (e) {
      // the board may not have reached the server yet: ask for a sync and try again shortly
      if (!(e instanceof ApiError) || e.status !== 404 || i >= 8) throw e
      syncSoon()
      await new Promise((r) => setTimeout(r, 700))
    }
  }
}
export async function join(token: string): Promise<string> {
  await ensureAccount()
  return (await call('join', { method: 'POST', body: JSON.stringify({ token }) })).id
}
export const members = (boardId: string): Promise<{ members: { id: string; name: string; role: string }[]; me: string }> => call(`docs/${boardId}/members`)
export async function leave(boardId: string) {
  await call(`docs/${boardId}`, { method: 'DELETE' })
  delete seen[boardId]
  remember()
}

// ---------- photos travel separately from the board text ----------
const shaOf = new Map<string, string>() // photo data -> hash
const dataOf = new Map<string, string>() // hash -> photo data
const onServer = new Map<string, Set<string>>() // board id -> hashes stored
const lastRemote = new Map<string, State>() // board id -> what the server holds, as far as this device knows
async function hash(data: string): Promise<string> {
  let h = shaOf.get(data)
  if (!h) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)))
    h = btoa(String.fromCharCode(...d)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    shaOf.set(data, h)
    dataOf.set(h, data)
  }
  return h
}
const isPhoto = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:image/')
const isRef = (v: unknown): v is string => typeof v === 'string' && v.startsWith('photo:')
function walk(x: any, visit: (v: string) => void) {
  if (typeof x === 'string') visit(x)
  else if (x && typeof x === 'object') for (const v of Object.values(x)) walk(v, visit)
}
/** Board text with each photo replaced by a short reference; uploads any photo the server lacks. */
async function pack(id: string, s: State): Promise<string> {
  const photos = new Set<string>()
  walk(s.cards, (v) => isPhoto(v) && photos.add(v))
  for (const p of photos) await hash(p)
  if (photos.size) {
    if (!onServer.has(id)) onServer.set(id, new Set((await call(`docs/${id}/blobs`).catch(() => ({ hashes: [] }))).hashes))
    const have = onServer.get(id)!
    for (const p of photos) {
      const h = shaOf.get(p)!
      if (have.has(h)) continue
      await call(`docs/${id}/blobs/${h}`, { method: 'PUT', body: p })
      have.add(h)
    }
  }
  return JSON.stringify(s, (_k, v) => (isPhoto(v) ? `photo:${shaOf.get(v)}` : v))
}
/** The reverse: put the photos back, fetching any this device has not seen. */
async function unpack(id: string, body: string): Promise<State | null> {
  const raw = JSON.parse(body)
  const need = new Set<string>()
  walk(raw, (v) => isRef(v) && !dataOf.has(v.slice(6)) && need.add(v.slice(6)))
  await Promise.all([...need].map(async (h) => {
    const data: string = await call(`docs/${id}/blobs/${h}`, { raw: true })
    dataOf.set(h, data)
    shaOf.set(data, h)
  }))
  const fill = (x: any): any =>
    isRef(x) ? dataOf.get(x.slice(6)) ?? x : Array.isArray(x) ? x.map(fill) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fill(v)])) : x
  return normalize(fill(raw))
}

/** Everything this account can open, as one State. Used when a new device signs in. */
export async function fetchAll(): Promise<State | null> {
  const { docs } = await call('docs')
  let all: State | null = null
  const people: Record<string, number> = {}
  for (const d of docs as { id: string; rev: number; people: number }[]) {
    const got = await call(`docs/${d.id}`)
    const part = got && (await unpack(d.id, got.body))
    if (!part) continue
    people[d.id] = d.people
    all = all ? merge(all, part) : part
  }
  set({ people })
  return all
}

const friendly = (e: any) => (/Failed to fetch|NetworkError|Load failed/i.test(String(e?.message)) ? 'Offline. Changes are saved here and will sync when you are back online.' : String(e?.message ?? e))

/** Keeps every board in step with the server while this device has an account. */
export function useCloudSync(state: State, dispatch: (a: Action) => void) {
  const { account, available, nudge } = useCloud()
  const on = !!account && available === true
  const cur = useRef(state)
  cur.current = state
  const busy = useRef(false)
  const again = useRef(false)

  const run = useCallback(async () => {
    if (!status.account) return
    if (busy.current) return void (again.current = true)
    busy.current = true
    set({ phase: 'syncing', error: undefined })
    try {
      const { docs } = (await call('docs')) as { docs: { id: string; rev: number; people: number }[] }
      const people: Record<string, number> = {}
      let mine = cur.current
      const take = (remote: State | null) => {
        if (!remote) return
        dispatch({ t: 'merge', state: remote })
        mine = merge(mine, remote)
      }
      // 1. bring in what changed on the server
      for (const d of docs) {
        const here = mine.boards.some((b) => b.id === d.id)
        if (!here && d.id in (mine.deleted ?? {})) {
          await leave(d.id) // deleted on this device: leave it (the others keep it; it is removed when nobody is left)
          continue
        }
        people[d.id] = d.people
        if (here && seen[d.id]?.rev === d.rev) continue
        const got = await call(`docs/${d.id}`)
        const remote = await unpack(d.id, got.body)
        take(remote)
        if (remote) lastRemote.set(d.id, remote)
        seen[d.id] = { rev: got.rev, sig: fingerprint(got.body) }
      }
      set({ people })
      // 2. send what changed here; if someone else wrote first, combine and send again
      for (const b of mine.boards) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const part = slice(mine, b.id, (people[b.id] ?? 1) > 1)!
          const body = await pack(b.id, part)
          const sig = fingerprint(body)
          if (seen[b.id]?.sig === sig) break
          // Send only if this device knows something the server does not. Two devices can hold harmlessly
          // different copies (for example before and after their own new-day clear-out); without this
          // check they would overwrite each other back and forth for ever.
          if (seen[b.id] && !lastRemote.has(b.id)) {
            const got = await call(`docs/${b.id}`).catch(() => null)
            const remote = got && (await unpack(b.id, got.body))
            if (remote) (lastRemote.set(b.id, remote), (seen[b.id] = { rev: got.rev, sig: fingerprint(got.body) }))
          }
          const known = lastRemote.get(b.id)
          if (known && merge(known, part) === known) {
            seen[b.id] = { ...seen[b.id], sig }
            break
          }
          try {
            const { rev } = await call(`docs/${b.id}`, { method: 'PUT', body: JSON.stringify({ body, baseRev: seen[b.id]?.rev ?? 0 }) })
            seen[b.id] = { rev, sig }
            lastRemote.set(b.id, part)
            people[b.id] ??= 1
            break
          } catch (e) {
            if (!(e instanceof ApiError) || e.status !== 409 || !e.data?.body) throw e
            const remote = await unpack(b.id, e.data.body)
            take(remote)
            if (remote) lastRemote.set(b.id, remote)
            seen[b.id] = { rev: e.data.rev, sig: '' }
          }
        }
      }
      remember()
      set({ phase: 'idle', at: Date.now(), people })
    } catch (e) {
      remember()
      if (status.account) set({ phase: 'error', error: friendly(e) })
    }
    busy.current = false
    if (again.current) {
      again.current = false
      run()
    }
  }, [dispatch])

  useEffect(() => {
    if (!on) return
    run()
    // shared boards feel live: look for other people's changes every few seconds while the app is on screen
    const iv = setInterval(() => document.visibilityState === 'visible' && run(), 12000)
    const wake = () => document.visibilityState === 'visible' && run()
    document.addEventListener('visibilitychange', wake)
    addEventListener('online', run)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', wake)
      removeEventListener('online', run)
    }
  }, [on, account?.userId, nudge, run])

  // shortly after a local change, send it
  useEffect(() => {
    if (!on) return
    const t = setTimeout(run, 1500)
    return () => clearTimeout(t)
  }, [on, state.cards, state.boards, state.spaces, run])

  return run
}
