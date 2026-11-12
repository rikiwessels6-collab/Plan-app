// Pointer-driven card reordering that works with mouse and touch.
// Mouse: drag the card header. Touch: press and hold the header, then drag.
// The card being moved follows the finger as a floating copy while the board
// reflows underneath it (see useFlip for the reflow animation).
import { useCallback, useLayoutEffect, useRef, type PointerEvent as RPointerEvent, type RefObject } from 'react'
import type { Action } from './store'

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function useCardDrag(dispatch: (a: Action) => void) {
  return useCallback(
    (e: RPointerEvent<HTMLElement>, id: string) => {
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('button, a, .menu')) return
      const src = e.currentTarget.closest<HTMLElement>('[data-card]')
      if (!src) return
      const touch = e.pointerType !== 'mouse'
      const sx = e.clientX, sy = e.clientY
      let x = sx, y = sy, ox = 0, oy = 0
      let active = false, lastMove = 0, raf = 0
      let clone: HTMLElement | null = null

      const place = () => clone && (clone.style.transform = `translate(${x - ox}px, ${y - oy}px) rotate(1.2deg) scale(1.03)`)

      const activate = () => {
        active = true
        ;(document.activeElement as HTMLElement | null)?.blur()
        const r = src.getBoundingClientRect()
        ox = x - r.left
        oy = y - r.top
        clone = src.cloneNode(true) as HTMLElement
        // cloned form fields lose what was typed; copy it across
        const from = src.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input')
        clone.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input').forEach((el, i) => (el.value = from[i].value))
        clone.classList.add('drag-clone')
        clone.style.width = `${r.width}px`
        clone.removeAttribute('data-card')
        clone.setAttribute('aria-hidden', 'true')
        document.body.appendChild(clone)
        place()
        src.dataset.dragging = '1'
        document.documentElement.classList.add('dragging')
        if (touch) navigator.vibrate?.(8)
        raf = requestAnimationFrame(autoScroll)
      }

      const autoScroll = () => {
        const edge = 90
        const v = y < edge ? -(edge - y) / 6 : y > innerHeight - edge ? (y - (innerHeight - edge)) / 6 : 0
        if (v) {
          scrollBy(0, v)
          hit()
        }
        raf = requestAnimationFrame(autoScroll)
      }

      const hit = () => {
        const now = performance.now()
        if (now - lastMove < 240) return // let the reflow settle so cards do not ping-pong
        const over = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-card]')
        if (!over || over === src) return
        const ids = [...document.querySelectorAll<HTMLElement>('[data-card]')].map((el) => el.dataset.card)
        const i = ids.indexOf(id), j = ids.indexOf(over.dataset.card)
        const r = over.getBoundingClientRect()
        const before = y < r.top + r.height / 2
        if ((before && i === j - 1) || (!before && i === j + 1)) return
        lastMove = now
        dispatch(before ? { t: 'moveCard', id, beforeId: over.dataset.card } : { t: 'moveCard', id, afterId: over.dataset.card })
      }

      const hold = touch ? window.setTimeout(activate, 320) : 0

      const move = (ev: PointerEvent) => {
        x = ev.clientX
        y = ev.clientY
        if (!active) {
          const d = Math.hypot(x - sx, y - sy)
          if (!touch && d > 6) activate()
          else if (touch && d > 10) end() // the finger moved first: this is a scroll, not a drag
          return
        }
        place()
        hit()
      }
      const noScroll = (ev: TouchEvent) => active && ev.preventDefault()
      const noMenu = (ev: Event) => ev.preventDefault()

      const end = () => {
        clearTimeout(hold)
        cancelAnimationFrame(raf)
        removeEventListener('pointermove', move)
        removeEventListener('pointerup', end)
        removeEventListener('pointercancel', end)
        document.removeEventListener('touchmove', noScroll)
        src.removeEventListener('contextmenu', noMenu)
        if (!active || !clone) return
        const c = clone
        clone = null
        const finish = () => {
          c.remove()
          delete src.dataset.dragging
          document.documentElement.classList.remove('dragging')
        }
        const r = src.getBoundingClientRect()
        if (reduced()) return finish()
        c.animate([{ transform: c.style.transform }, { transform: `translate(${r.left}px, ${r.top}px)` }], { duration: 220, easing: EASE }).onfinish = finish
      }

      addEventListener('pointermove', move)
      addEventListener('pointerup', end)
      addEventListener('pointercancel', end)
      document.addEventListener('touchmove', noScroll, { passive: false })
      src.addEventListener('contextmenu', noMenu)
    },
    [dispatch],
  )
}

/** Animate cards from where they were to where they are whenever `key` (order, filter, columns) changes. */
export function useFlip(board: RefObject<HTMLElement | null>, key: string) {
  const prev = useRef(new Map<string, { x: number; y: number }>())
  const lastKey = useRef(key)
  useLayoutEffect(() => {
    const root = board.current
    if (!root) return
    const next = new Map<string, { x: number; y: number }>()
    const els = [...root.querySelectorAll<HTMLElement>('[data-card]')]
    // offsetLeft/Top ignore transforms, so cards that are mid-animation still report their true slot
    for (const el of els) next.set(el.dataset.card!, { x: el.offsetLeft, y: el.offsetTop })
    if (lastKey.current !== key && !reduced()) {
      for (const el of els) {
        const a = prev.current.get(el.dataset.card!), b = next.get(el.dataset.card!)!
        if (!a || (a.x === b.x && a.y === b.y)) continue
        el.animate([{ transform: `translate(${a.x - b.x}px, ${a.y - b.y}px)` }, { transform: 'none' }], { duration: 340, easing: EASE })
      }
    }
    prev.current = next
    lastKey.current = key
  })
}
