// A card whose body is jelly. Its outline is a ring of points on springs: each
// tied to its place on the rounded rectangle and to its two neighbours, so a
// poke travels round the edge as a wave and the shape bulges and settles
// instead of scaling like a rigid sheet. The body is an SVG path redrawn every
// frame (smoothed through the points); the content sits on top, steady, and
// only rides a little of the body's motion.
//
//   land()     the bottom flattens, the sides bulge, it wobbles out
//   squeeze()  pressed in all round, then it springs back
//   pointer    the edge near the cursor is dragged along by it
//   idle       two slow waves running opposite ways: it never quite stops

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

const M = 28 // room around the card for bulges and the shadow
const R = 34 // corner radius at rest
const K_REST = 130 // pull back to its place (1/s²)
const K_NEIGH = 1100 // pull towards its neighbours: how fast a wave travels
const DAMP = 4.2 // 1/s
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

// points around a W×H rounded rectangle: dense on the corners, sparse on the sides
function outline(W, H) {
  const r = Math.min(R, W / 2, H / 2)
  const pts = []
  const edge = (x0, y0, x1, y1, nx, ny) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 26))
    for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, nx, ny])
  }
  const arc = (cx, cy, a0) => {
    for (let i = 0; i < 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2)
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)])
    }
  }
  edge(r, 0, W - r, 0, 0, -1)
  arc(W - r, r, -Math.PI / 2)
  edge(W, r, W, H - r, 1, 0)
  arc(W - r, H - r, 0)
  edge(W - r, H, r, H, 0, 1)
  arc(r, H - r, Math.PI / 2)
  edge(0, H - r, 0, r, -1, 0)
  arc(r, r, Math.PI)
  return pts
}

// a closed Catmull-Rom curve through the points, as cubic Béziers
function pathOf(x, y, n) {
  let d = `M${x[0].toFixed(1)},${y[0].toFixed(1)}`
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = i, c = (i + 1) % n, e = (i + 2) % n
    d +=
      `C${(x[b] + (x[c] - x[a]) / 6).toFixed(1)},${(y[b] + (y[c] - y[a]) / 6).toFixed(1)} ` +
      `${(x[c] - (x[e] - x[b]) / 6).toFixed(1)},${(y[c] - (y[e] - y[b]) / 6).toFixed(1)} ` +
      `${x[c].toFixed(1)},${y[c].toFixed(1)}`
  }
  return d + 'Z'
}

let uid = 0

const JellySurface = forwardRef(function JellySurface({ className = '', children }, ref) {
  const wrap = useRef()
  const path = useRef()
  const content = useRef()
  const sim = useRef(null)
  const gid = useRef(`jelly-fill-${++uid}`)

  // impulses in px/s, on every point or by weight
  const push = (fn) => {
    const s = sim.current
    if (!s || reduced()) return
    for (let i = 0; i < s.n; i++) {
      const [vx, vy] = fn(s.rest[i], i)
      s.vx[i] += vx
      s.vy[i] += vy
    }
  }

  useImperativeHandle(ref, () => ({
    land() {
      const s = sim.current
      if (!s) return
      push(([x, y, nx]) => {
        const low = Math.pow(y / s.H, 3) // the bottom takes the hit
        return [nx * 100 * low, -160 * low + 40 * (1 - low)]
      })
    },
    squeeze() {
      push(([, , nx, ny]) => [-nx * 120, -ny * 120])
    },
  }))

  useEffect(() => {
    const el = wrap.current
    let raf = 0
    let last = performance.now()
    const t0 = last

    const build = () => {
      const W = el.offsetWidth, H = el.offsetHeight
      const rest = outline(W, H)
      const n = rest.length
      sim.current = { W, H, n, rest, ox: new Float32Array(n), oy: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n) }
      el.querySelector('svg').setAttribute('viewBox', `0 0 ${W + 2 * M} ${H + 2 * M}`)
    }
    build()

    const xs = [], ys = []
    const frame = (t) => {
      const s = sim.current
      const dt = Math.min(0.033, (t - last) / 1000)
      last = t
      const { n, rest, ox, oy, vx, vy } = s
      const idle = reduced() ? 0 : 1
      const time = (t - t0) / 1000
      for (let sub = 0; sub < 2; sub++) {
        const h = dt / 2
        for (let i = 0; i < n; i++) {
          const a = (i - 1 + n) % n, b = (i + 1) % n
          // its place breathes: two slow waves running round the edge, opposite ways
          const ph = (i / n) * Math.PI * 2
          const breathe = idle * (1.3 * Math.sin(time * 1.9 + ph * 2) + 0.8 * Math.sin(time * 1.3 - ph * 3 + 1.7))
          const tx = rest[i][2] * breathe, ty = rest[i][3] * breathe
          const ax = -K_REST * (ox[i] - tx) + K_NEIGH * (ox[a] + ox[b] - 2 * ox[i]) - DAMP * vx[i]
          const ay = -K_REST * (oy[i] - ty) + K_NEIGH * (oy[a] + oy[b] - 2 * oy[i]) - DAMP * vy[i]
          vx[i] += ax * h
          vy[i] += ay * h
        }
        for (let i = 0; i < n; i++) {
          ox[i] += vx[i] * h
          oy[i] += vy[i] * h
        }
      }
      let my = 0
      for (let i = 0; i < n; i++) {
        xs[i] = rest[i][0] + ox[i] + M
        ys[i] = rest[i][1] + oy[i] + M
        my += oy[i]
      }
      path.current.setAttribute('d', pathOf(xs, ys, n))
      // the content rides a little of the body's motion, never enough to blur the text
      content.current.style.transform = `translateY(${((my / n) * 0.35).toFixed(2)}px)`
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    // the cursor drags the edge near it along
    let px = 0, py = 0, pt = 0
    const onMove = (e) => {
      const s = sim.current
      const t = performance.now()
      const b = el.getBoundingClientRect()
      const x = e.clientX - b.left, y = e.clientY - b.top
      const dt = (t - pt) / 1000
      if (pt && dt > 0 && dt < 0.1 && !reduced()) {
        const ux = Math.max(-2500, Math.min(2500, (x - px) / dt))
        const uy = Math.max(-2500, Math.min(2500, (y - py) / dt))
        for (let i = 0; i < s.n; i++) {
          const dx = s.rest[i][0] - x, dy = s.rest[i][1] - y
          const w = Math.exp(-(dx * dx + dy * dy) / (2 * 80 * 80)) * 0.01
          s.vx[i] += ux * w
          s.vy[i] += uy * w
        }
      }
      px = x
      py = y
      pt = t
    }
    el.addEventListener('pointermove', onMove)

    const ro = new ResizeObserver(() => {
      const s = sim.current
      if (Math.abs(el.offsetWidth - s.W) > 0.5 || Math.abs(el.offsetHeight - s.H) > 0.5) build()
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('pointermove', onMove)
    }
  }, [])

  return (
    <div ref={wrap} className={`jelly-surface ${className}`}>
      <svg className="jelly-body" aria-hidden="true" style={{ left: -M, top: -M, width: `calc(100% + ${2 * M}px)`, height: `calc(100% + ${2 * M}px)` }}>
        <defs>
          <linearGradient id={gid.current} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fffdf9" />
            <stop offset="1" stopColor="#fff3e3" />
          </linearGradient>
        </defs>
        <path ref={path} fill={`url(#${gid.current})`} stroke="rgba(255,255,255,0.95)" strokeWidth="1.5" />
      </svg>
      <div ref={content} className="jelly-content">
        {children}
      </div>
    </div>
  )
})

export default JellySurface
