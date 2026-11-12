// What the phone, tablet or computer itself can give the app:
// calendar files, contacts, the share sheet, location, notifications, the home-screen badge.
import { typeOf } from './catalog'
import type { Card } from './types'

// ---------- calendar files (.ics): opens "Add to Calendar" on iPhone, iPad and Mac ----------
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n')
const compact = (d: string) => d.replace(/-/g, '')
const nextDay = (d: string) => {
  const n = new Date(`${d}T00:00:00`)
  n.setDate(n.getDate() + 1)
  return `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`
}

export function ics(items: { title: string; date: string }[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const events = items.map((e, i) =>
    [
      'BEGIN:VEVENT',
      `UID:${stamp}-${i}-${Math.random().toString(36).slice(2)}@plan`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${nextDay(e.date)}`,
      `SUMMARY:${esc(e.title || 'Untitled')}`,
      'END:VEVENT',
    ].join('\r\n'),
  )
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Plan//Board//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n'
}

export function saveFile(name: string, type: string, body: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export const addToCalendar = (title: string, date: string) =>
  saveFile(`${(title || 'event').replace(/[^\w -]+/g, '').trim() || 'event'}.ics`, 'text/calendar', ics([{ title, date }]))

// ---------- contacts ----------
export interface Person { name: string; note: string }

/** Parse contact cards (.vcf), the format iPhone and iPad share contacts in. */
export function parseVcards(text: string): Person[] {
  const out: Person[] = []
  for (const block of text.replace(/\r?\n[ \t]/g, '').split(/BEGIN:VCARD/i).slice(1)) {
    const get = (key: string) =>
      block.split(/\r?\n/).filter((l) => new RegExp(`^(item\\d+\\.)?${key}([;:])`, 'i').test(l)).map((l) => l.slice(l.indexOf(':') + 1).trim())
    const un = (s: string) => s.replace(/\\([,;])/g, '$1').replace(/\\n/gi, ' ')
    let name = un(get('FN')[0] ?? '')
    if (!name) {
      const [family = '', given = ''] = (get('N')[0] ?? '').split(';')
      name = un(`${given} ${family}`.trim())
    }
    if (!name) name = un(get('ORG')[0] ?? '').replace(/;+$/, '')
    const note = [get('TEL')[0], get('EMAIL')[0]].filter(Boolean).map((s) => un(s!)).join(' · ')
    if (name || note) out.push({ name, note })
  }
  return out
}

/** The system contact picker, where the browser has one. Returns null when it does not. */
export async function pickContacts(): Promise<Person[] | null> {
  const api = (navigator as any).contacts
  if (!api?.select) return null
  try {
    const got: any[] = await api.select(['name', 'tel', 'email'], { multiple: true })
    return got.map((c) => ({ name: c.name?.[0] ?? '', note: [c.tel?.[0], c.email?.[0]].filter(Boolean).join(' · ') })).filter((p) => p.name || p.note)
  } catch {
    return []
  }
}
export const hasContactPicker = () => !!(navigator as any).contacts?.select

// ---------- sharing ----------
/** A card as plain text, for the share sheet, messages or email. */
export function cardText(card: Card): string {
  const lines: string[] = [card.title || 'Untitled']
  const d = card.data
  for (const s of typeOf(card.type).sections) {
    const v = d[s.key]
    if (v === undefined || v === null || v === '') continue
    const part: string[] = []
    switch (s.kind) {
      case 'checklist':
        for (const r of v as any[]) if (r.text) part.push(`${r.done ? '☑' : '☐'} ${r.text}`)
        break
      case 'text':
        part.push(String(v))
        break
      case 'fields':
      case 'slots':
        for (const [k, x] of Object.entries(v as Record<string, string>)) if (x) part.push(`${k}: ${x}`)
        break
      case 'amounts': {
        const rows = ((v.rows ?? []) as any[]).filter((r) => r.label || r.amount !== '')
        for (const r of rows) part.push(`${r.label || '—'}: ${r.amount === '' ? 0 : r.amount}`)
        if (rows.length) part.push(`Total: ${rows.reduce((t, r) => t + (Number(r.amount) || 0), 0)}`)
        if (s.budget && v.budget) part.push(`Budget: ${v.budget}`)
        break
      }
      case 'dates':
        for (const r of v as any[]) if (r.label || r.date) part.push([r.label, r.date].filter(Boolean).join(' — '))
        break
      case 'countdown':
      case 'link':
        part.push(String(v))
        break
      case 'number':
        if (v.value !== undefined && v.value !== '') part.push(`${v.value}${v.target ? ` / ${v.target}` : ''}${v.unit ? ` ${v.unit}` : ''}`)
        break
      case 'people':
        for (const r of v as any[]) if (r.name || r.note) part.push([r.name, r.note].filter(Boolean).join(' — '))
        break
      case 'rating':
        for (const r of v as any[]) if (r.label) part.push(`${r.label}: ${r.score}/5`)
        break
      case 'month':
        for (const [k, x] of Object.entries(v as Record<string, string>).sort()) if (x) part.push(`${k}: ${x}`)
        break
      case 'place':
        if (v.lat !== undefined) part.push(mapsUrl(v.lat, v.lon, card.title))
        break
    }
    if (!part.length) continue
    const label = 'label' in s ? s.label : undefined
    lines.push('', ...(label ? [label.toUpperCase()] : []), ...part)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function shareCard(card: Card): Promise<'shared' | 'copied' | 'failed' | 'cancelled'> {
  const text = cardText(card)
  if (navigator.share) {
    try {
      await navigator.share({ title: card.title, text })
      return 'shared'
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}

// ---------- location ----------
export const locate = (): Promise<{ lat: number; lon: number }> =>
  new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('This device does not share its location with web apps.'))
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5) }),
      (e) => rej(new Error(e.code === 1 ? 'Location is switched off for this app. Allow it in your browser or device settings.' : 'Could not find your location. Try again.')),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 },
    )
  })
export const mapsUrl = (lat: number, lon: number, label = '') =>
  `https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(label || 'Pinned place')}`

// ---------- notifications and the home-screen badge ----------
export async function notify(title: string, body: string) {
  try {
    if (!('Notification' in window)) return
    if (Notification.permission === 'default') await Notification.requestPermission()
    if (Notification.permission !== 'granted') return
    // installed iPhone/iPad apps can only notify through the service worker
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) await reg.showNotification(title, { body, tag: 'plan', icon: './icon-192.png' })
    else new Notification(title, { body, tag: 'plan' })
  } catch {
    /* notifications are a nicety; never let them break the app */
  }
}
export const askNotify = () => {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
  } catch {}
}
export function setBadge(n: number) {
  const nav = navigator as any
  try {
    if (n > 0) nav.setAppBadge?.(n)?.catch?.(() => {})
    else nav.clearAppBadge?.()?.catch?.(() => {})
  } catch {}
}
export function chime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    ;[660, 880].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = f
      o.connect(g)
      g.connect(ctx.destination)
      const t = ctx.currentTime + i * 0.18
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      o.start(t)
      o.stop(t + 0.55)
    })
    setTimeout(() => ctx.close(), 1200)
  } catch {}
}

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// Chrome, Edge and Android offer an install prompt; keep it until the person asks for it
let installEvent: any = null
if (typeof window !== 'undefined')
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installEvent = e
  })
export const canInstall = () => !!installEvent
export async function install() {
  await installEvent?.prompt()
  installEvent = null
}
