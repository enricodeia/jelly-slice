// A gummy wobble for any element: two damped springs, squash (scale x up, y
// down, area kept) and lean (skew), excited by `kick()` and by the pointer
// moving across it. Writes `transform` on the element itself, so put it on an
// inner wrapper if something else animates the outer one. `ref` is a callback
// ref: the element can mount later than the component using the hook.

import { useCallback, useEffect, useRef, useState } from 'react'

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function useJelly({ stiffness = 210, damping = 8.5, enter = 0, follow = true } = {}) {
  const [el, setEl] = useState(null)
  const elRef = useRef(null)
  elRef.current = el
  const s = useRef({ x: 0, v: 0, k: 0, kv: 0, raf: 0, last: 0, px: 0, py: 0, pt: 0 })

  const tick = useCallback(
    (t) => {
      const st = s.current
      const node = elRef.current
      const dt = Math.min(0.033, (t - st.last) / 1000)
      st.last = t
      st.v += (-stiffness * st.x - damping * st.v) * dt
      st.x += st.v * dt
      st.kv += (-stiffness * st.k - damping * st.kv) * dt
      st.k += st.kv * dt
      const live = Math.abs(st.x) + Math.abs(st.v) * 0.02 + Math.abs(st.k) * 0.01 + Math.abs(st.kv) * 0.0005 > 0.0005
      if (!live) st.x = st.v = st.k = st.kv = 0
      if (node) node.style.transform = live ? `scale(${1 + st.x}, ${1 / (1 + st.x)}) skewX(${st.k}deg)` : ''
      st.raf = live ? requestAnimationFrame(tick) : 0
    },
    [stiffness, damping]
  )

  /** squash: + wide, − tall (a velocity: ~0.6 is a soft poke); lean: skew velocity, deg/s */
  const kick = useCallback(
    (squash = 0.6, lean = 0) => {
      if (reduced()) return
      const st = s.current
      st.v += squash
      st.kv += lean
      if (!st.raf) {
        st.last = performance.now()
        st.raf = requestAnimationFrame(tick)
      }
    },
    [tick]
  )

  useEffect(() => {
    if (!el) return
    if (enter) kick(enter)
    const onMove = (e) => {
      const st = s.current
      const t = performance.now()
      const dt = (t - st.pt) / 1000
      if (st.pt && dt > 0 && dt < 0.1) {
        const vx = (e.clientX - st.px) / dt
        const vy = (e.clientY - st.py) / dt
        // a quick pass across it makes it shiver; a slow one barely does
        kick(Math.min(0.06, Math.hypot(vx, vy) * 0.000045), Math.max(-14, Math.min(14, vx * 0.006)))
      }
      st.px = e.clientX
      st.py = e.clientY
      st.pt = t
    }
    if (follow) el.addEventListener('pointermove', onMove)
    return () => {
      el.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(s.current.raf)
      s.current.raf = 0
    }
  }, [el, enter, follow, kick])

  return { ref: setEl, kick }
}
