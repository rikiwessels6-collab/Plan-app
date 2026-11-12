// Shared interface pieces: sheets, dialogs and toasts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from './sections'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Bottom sheet on phones (swipe down to close), centred panel on larger screens. */
export function Sheet({ title, onClose, children, wide, head }: {
  title: string
  onClose: () => void
  children: ReactNode | ((close: () => void) => ReactNode)
  wide?: boolean
  head?: ReactNode
}) {
  const [closing, setClosing] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    if (reduced()) return onClose()
    setClosing(true)
    setTimeout(onClose, 190)
  }, [onClose])

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key !== 'Tab' || !panel.current) return
      // keep focus inside the sheet
      const f = panel.current.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href]')
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus())
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus())
    }
    document.addEventListener('keydown', key)
    document.documentElement.classList.add('locked')
    return () => {
      document.removeEventListener('keydown', key)
      document.documentElement.classList.remove('locked')
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
      setTimeout(onClose, 180)
    } else panel.current.style.transform = ''
  }

  return (
    <div className={`scrim${closing ? ' out' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`sheet${wide ? ' wide' : ''}`} ref={panel} role="dialog" aria-modal aria-label={title}>
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
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && cancel()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })
  return (
    <div className="scrim mid" onPointerDown={(e) => e.target === e.currentTarget && cancel()}>
      <form className="dialog" role="alertdialog" aria-modal aria-label={d.o.title} onSubmit={(e) => (e.preventDefault(), ok())}>
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
  const timer = useRef(0)
  const ui = useMemo<UI>(
    () => ({
      ask: (o) => new Promise((done) => setDlg({ kind: 'ask', o, done })),
      confirm: (o) => new Promise((done) => setDlg({ kind: 'confirm', o, done })),
      toast: (text, action, run) => {
        clearTimeout(timer.current)
        setToast({ id: Date.now(), text, action, run })
        timer.current = window.setTimeout(() => setToast(null), action ? 6000 : 2600)
      },
    }),
    [],
  )
  return (
    <UICtx.Provider value={ui}>
      {children}
      {dlg && <Dialog d={dlg} close={() => setDlg(null)} />}
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
