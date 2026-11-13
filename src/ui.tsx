// Shared interface pieces: sheets, dialogs and toasts.
import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './sections'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Keep Tab inside a panel: wraps at the ends and pulls focus back in if it has escaped. */
export function trap(panel: HTMLElement, e: KeyboardEvent | React.KeyboardEvent) {
  const f = [...panel.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href]')].filter(
    (el) => !(el as HTMLButtonElement).disabled && el.tabIndex !== -1 && el.getClientRects().length > 0,
  )
  if (!f.length) return e.preventDefault()
  const first = f[0], last = f[f.length - 1], cur = document.activeElement
  if (!panel.contains(cur) || cur === panel) (e.preventDefault(), (e.shiftKey ? last : first).focus())
  else if (e.shiftKey && cur === first) (e.preventDefault(), last.focus())
  else if (!e.shiftKey && cur === last) (e.preventDefault(), first.focus())
}

/**
 * A menu attached to a button. It is drawn above everything else and kept inside the screen
 * (flipping above the button when there is no room below); on phones it is a bottom sheet.
 */
export function Popover({ anchor, onClose, children, align = 'right' }: {
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  align?: 'left' | 'right'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const phone = matchMedia('(max-width: 520px)').matches
  const [pos, setPos] = useState<CSSProperties>(phone ? {} : { visibility: 'hidden' })
  useLayoutEffect(() => {
    if (phone || !anchor.current || !ref.current) return
    const a = anchor.current.getBoundingClientRect(), m = ref.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(align === 'right' ? a.right - m.width + 4 : a.left - 4, innerWidth - m.width - 8))
    const below = a.bottom + 6
    const up = below + m.height > innerHeight - 8 && a.top - m.height - 6 > 8
    setPos({ left, top: up ? a.top - m.height - 6 : Math.min(below, Math.max(8, innerHeight - m.height - 8)), transformOrigin: `${align} ${up ? 'bottom' : 'top'}` })
  }, [phone, anchor, align])
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (e.stopPropagation(), onClose(), anchor.current?.focus())
      if (e.key === 'Tab' && ref.current) trap(ref.current, e)
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && ref.current) {
        e.preventDefault()
        const items = [...ref.current.querySelectorAll<HTMLElement>('button')]
        const i = items.indexOf(document.activeElement as HTMLElement)
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }
    }
    const away = () => !phone && onClose()
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key, true)
    addEventListener('scroll', away, { passive: true })
    addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key, true)
      removeEventListener('scroll', away)
      removeEventListener('resize', onClose)
    }
  }, [onClose, anchor, phone])
  return createPortal(
    <>
      {phone && <div className="scrim menu-scrim" />}
      <div ref={ref} className={`menu ${phone ? 'as-sheet' : 'floating'}`} role="menu" style={pos}>
        {phone && <i className="grabber" aria-hidden />}
        {children}
      </div>
    </>,
    document.body,
  )
}

/** Bottom sheet on phones (swipe down to close), centred panel on larger screens. */
export function Sheet({ title, onClose, children, wide, head, tall }: {
  title: string
  onClose: () => void
  children: ReactNode | ((close: () => void) => ReactNode)
  wide?: boolean
  head?: ReactNode
  tall?: boolean
}) {
  const [closing, setClosing] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  // the latest onClose without re-running the effects below (callers often pass a new function each render)
  const done = useRef(onClose)
  done.current = onClose
  const close = useCallback(() => {
    if (reduced()) return done.current()
    setClosing(true)
    setTimeout(() => done.current(), 190)
  }, [])

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true })
    const key = (e: KeyboardEvent) => {
      // a dialog or photo on top of this sheet handles its own keys
      if (document.querySelector('.scrim.mid, .lightbox, .menu')) return
      if (e.key === 'Escape') close()
      if (e.key === 'Tab' && panel.current) trap(panel.current, e)
    }
    document.addEventListener('keydown', key)
    document.documentElement.classList.add('locked')
    return () => {
      document.removeEventListener('keydown', key)
      document.documentElement.classList.remove('locked')
      // give focus back only if it was still inside the sheet (a new card may have taken it on purpose)
      if (!document.activeElement || document.activeElement === document.body || panel.current?.contains(document.activeElement))
        before?.focus?.({ preventScroll: true })
    }
  }, [close])

  // swipe down on the header to dismiss
  const drag = useRef<{ y: number; dy: number } | null>(null)
  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button, input')) return
    drag.current = { y: e.clientY, dy: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !panel.current) return
    drag.current.dy = Math.max(0, e.clientY - drag.current.y)
    panel.current.style.transition = 'none'
    panel.current.style.transform = `translateY(${drag.current.dy}px)`
  }
  const up = () => {
    if (!drag.current || !panel.current) return
    const far = drag.current.dy > 90
    drag.current = null
    panel.current.style.transition = ''
    if (far) {
      panel.current.style.transform = 'translateY(100%)'
      setTimeout(() => done.current(), 180)
    } else panel.current.style.transform = ''
  }

  return (
    <div className={`scrim${closing ? ' out' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`sheet${wide ? ' wide' : ''}${tall ? ' tall' : ''}`} ref={panel} tabIndex={-1} role="dialog" aria-modal aria-label={title}>
        <header onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <i className="grabber" aria-hidden />
          {head ?? <h2>{title}</h2>}
          <button className="ghost" aria-label="Close" onClick={close}><Icon name="X" size={18} /></button>
        </header>
        {typeof children === 'function' ? children(close) : children}
      </div>
    </div>
  )
}

interface AskOpts { title: string; body?: string; initial?: string; placeholder?: string; cta?: string }
interface ConfirmOpts { title: string; body?: string; cta: string; danger?: boolean }
interface Toast { id: number; text: string; action?: string; run?: () => void }
interface UI {
  ask: (o: AskOpts) => Promise<string | null>
  confirm: (o: ConfirmOpts) => Promise<boolean>
  toast: (text: string, action?: string, run?: () => void) => void
  /** show a photo full screen */
  view: (src: string, caption?: string) => void
}
const UICtx = createContext<UI>(null as any)
export const useUI = () => useContext(UICtx)

type Dlg = { kind: 'ask'; o: AskOpts; done: (v: string | null) => void } | { kind: 'confirm'; o: ConfirmOpts; done: (v: boolean) => void }

function Dialog({ d, close }: { d: Dlg; close: () => void }) {
  const [v, setV] = useState(d.kind === 'ask' ? d.o.initial ?? '' : '')
  const cancel = () => (d.kind === 'ask' ? d.done(null) : d.done(false), close())
  const ok = () => {
    if (d.kind === 'ask') {
      if (!v.trim()) return
      d.done(v.trim())
    } else d.done(true)
    close()
  }
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
      if (e.key === 'Tab' && form.current) trap(form.current, e)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })
  return (
    <div className="scrim mid" onPointerDown={(e) => e.target === e.currentTarget && cancel()}>
      <form ref={form} className="dialog" role="alertdialog" aria-modal aria-label={d.o.title} onSubmit={(e) => (e.preventDefault(), ok())}>
        <h2>{d.o.title}</h2>
        {d.o.body && <p>{d.o.body}</p>}
        {d.kind === 'ask' && (
          <input
            autoFocus value={v} placeholder={d.o.placeholder} aria-label={d.o.title}
            onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)}
          />
        )}
        <div className="dialog-btns">
          <button type="button" className="btn soft" onClick={cancel}>Cancel</button>
          <button
            className={`btn${d.kind === 'confirm' && d.o.danger ? ' danger' : ''}`} autoFocus={d.kind === 'confirm'}
            disabled={d.kind === 'ask' && !v.trim()}
          >
            {d.o.cta ?? 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [dlg, setDlg] = useState<Dlg | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [photo, setPhoto] = useState<{ src: string; caption?: string } | null>(null)
  const timer = useRef(0)
  useEffect(() => {
    if (!photo) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPhoto(null)
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [photo])
  const ui = useMemo<UI>(
    () => ({
      ask: (o) => new Promise((done) => setDlg({ kind: 'ask', o, done })),
      confirm: (o) => new Promise((done) => setDlg({ kind: 'confirm', o, done })),
      toast: (text, action, run) => {
        clearTimeout(timer.current)
        setToast({ id: Date.now(), text, action, run })
        timer.current = window.setTimeout(() => setToast(null), action ? 6000 : 2600)
      },
      view: (src, caption) => setPhoto({ src, caption }),
    }),
    [],
  )
  return (
    <UICtx.Provider value={ui}>
      {children}
      {dlg && <Dialog d={dlg} close={() => setDlg(null)} />}
      {photo && (
        <div className="lightbox" role="dialog" aria-modal aria-label={photo.caption || 'Photo'} onClick={() => setPhoto(null)}>
          <img src={photo.src} alt={photo.caption || ''} />
          {photo.caption && <p>{photo.caption}</p>}
          <button className="ghost" aria-label="Close photo" autoFocus><Icon name="X" size={18} /></button>
        </div>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <span>{toast.text}</span>
            {toast.action && (
              <button onClick={() => (toast.run?.(), setToast(null))}>{toast.action}</button>
            )}
          </div>
        )}
      </div>
    </UICtx.Provider>
  )
}

/** Catches a crash in one part of the screen so the rest keeps working. */
export class Guard extends Component<{ children: ReactNode; fallback: (retry: () => void, error: unknown) => ReactNode; resetKey?: unknown }, { error: unknown }> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('Unknown error') }
  }
  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }
  render() {
    return this.state.error ? this.props.fallback(() => this.setState({ error: null }), this.state.error) : this.props.children
  }
}
