// Sync between devices, with no server of our own: the board is kept as one file in the
// person's own Google Drive, in the hidden per-app folder only this app can read.
// Every device merges what it finds there with what it has (see merge() in store.ts).
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { gapi, useGoogle } from './google'
import { merge, type Action } from './store'
import type { State } from './types'

const FILE = 'plan-board.json'
const K = 'plan.sync.account'
const API = 'https://www.googleapis.com/drive/v3/files'

export interface SyncStatus { account: string; phase: 'off' | 'idle' | 'syncing' | 'error'; at?: number; error?: string }
let status: SyncStatus = { account: localStorage.getItem(K) ?? '', phase: 'off' }
const subs = new Set<() => void>()
const set = (p: Partial<SyncStatus>) => {
  status = { ...status, ...p }
  subs.forEach((f) => f())
}
export const useSyncStatus = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => status)
export function setSyncAccount(email: string) {
  if (email) localStorage.setItem(K, email)
  else localStorage.removeItem(K)
  ids.clear()
  set({ account: email, phase: email ? 'idle' : 'off', error: undefined, at: undefined })
}

const ids = new Map<string, string>()
async function fileId(email: string): Promise<string | null> {
  if (ids.has(email)) return ids.get(email)!
  const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'files(id)', q: `name='${FILE}'` })
  const id = (await gapi(email, `${API}?${q}`)).files?.[0]?.id ?? null
  if (id) ids.set(email, id)
  return id
}
export async function pull(email: string): Promise<State | null> {
  const id = await fileId(email)
  if (!id) return null
  const s = await gapi(email, `${API}/${id}?alt=media`)
  return Array.isArray(s?.cards) && Array.isArray(s?.boards) && s.boards.length ? (s as State) : null
}
export async function push(email: string, state: State): Promise<void> {
  let id = await fileId(email)
  if (!id) {
    id = (await gapi(email, API, { method: 'POST', body: JSON.stringify({ name: FILE, parents: ['appDataFolder'] }) })).id as string
    ids.set(email, id)
  }
  await gapi(email, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', body: JSON.stringify(state) })
}

const friendly = (e: any) => {
  const m = String(e?.message ?? e)
  if (m === 'expired') return 'Reconnect this Google account to keep syncing.'
  if (/insufficient|scope|permission/i.test(m)) return 'Reconnect this Google account to allow sync.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Offline. Changes are saved here and will sync later.'
  return m
}

/** Keeps the board in step with the copy in Drive while a sync account is connected. */
export function useSync(state: State, dispatch: (a: Action) => void) {
  const g = useGoogle()
  const { account } = useSyncStatus()
  const live = !!account && g.live.some((a) => a.email === account)
  const cur = useRef(state)
  cur.current = state
  const busy = useRef(false)
  const again = useRef(false)
  const pushed = useRef<number | undefined>(undefined)

  const run = useCallback(async () => {
    if (busy.current) return void (again.current = true)
    busy.current = true
    set({ phase: 'syncing', error: undefined })
    try {
      const remote = await pull(account)
      let mine = cur.current
      if (remote && !mine.updatedAt) {
        // a device that has never been edited simply takes the board that already exists
        mine = { ...remote, cols: mine.cols }
        dispatch({ t: 'load', state: mine })
      } else if (remote) {
        dispatch({ t: 'merge', state: remote })
        mine = merge(mine, remote)
      }
      // upload only when this device knows something the copy in Drive does not
      if (!remote || merge(remote, mine) !== remote) await push(account, mine)
      pushed.current = mine.updatedAt
      set({ phase: 'idle', at: Date.now() })
    } catch (e) {
      set({ phase: 'error', error: friendly(e) })
    }
    busy.current = false
    if (again.current) {
      again.current = false
      run()
    }
  }, [account, dispatch])

  useEffect(() => {
    if (!live) return void (account && set({ phase: 'error', error: 'Reconnect this Google account to keep syncing.' }))
    run()
    const iv = setInterval(run, 2 * 60 * 1000)
    const wake = () => document.visibilityState === 'visible' && run()
    document.addEventListener('visibilitychange', wake)
    addEventListener('online', run)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', wake)
      removeEventListener('online', run)
    }
  }, [live, account, run])

  // a few seconds after the last local change, send it
  useEffect(() => {
    if (!live || state.updatedAt === pushed.current) return
    const t = setTimeout(run, 4000)
    return () => clearTimeout(t)
  }, [live, state.updatedAt, run])
}
