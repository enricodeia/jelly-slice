// How to play, shown not told: a looping little scene at the top of the menu
// card. A Goldbear (the real one, baked from the 3D model) floats down, a
// finger swipes through it, the bear splits along the swipe and its halves
// wobble away; +10. Each slice fills a dot; the third in a row pays +15 and
// shows ×1.5, which is the whole rule of the game.

import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faHandPointer } from '@fortawesome/pro-regular-svg-icons'
import { bearSprite } from './bearSprite.js'

const COLORWAYS = ['orange', 'strawberry', 'apple', 'lemon', 'raspberry', 'pineapple']
const LOOP_MS = 2100
const BEAR_H = 104 // px
const BEAR_W = (BEAR_H * 240) / 384
// the swipe, in stage fractions: from low left to high right
const SWIPE = { x0: -0.08, y0: 0.66, x1: 1.08, y1: 0.36 }

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export default function HowTo() {
  const stage = useRef()
  const bear = useRef()
  const top = useRef()
  const bottom = useRef()
  const trail = useRef()
  const finger = useRef()
  const pop = useRef()
  const crumbs = useRef()
  const dots = useRef()
  const bonus = useRef()
  const [urls, setUrls] = useState(null)

  useEffect(() => {
    let off = false
    Promise.all(COLORWAYS.map(bearSprite))
      .then((u) => !off && setUrls(u))
      .catch(() => {})
    return () => {
      off = true
    }
  }, [])

  useEffect(() => {
    if (!urls || !stage.current) return
    const st = stage.current
    const W = st.clientWidth, H = st.clientHeight
    const bx = W / 2 - BEAR_W / 2, by = H * 0.52 - BEAR_H / 2
    // the swipe line where it crosses the bear's box → the two halves' clip
    const lineY = (x) => H * (SWIPE.y0 + ((x / W - SWIPE.x0) / (SWIPE.x1 - SWIPE.x0)) * (SWIPE.y1 - SWIPE.y0))
    const yl = ((lineY(bx) - by) / BEAR_H) * 100
    const yr = ((lineY(bx + BEAR_W) - by) / BEAR_H) * 100
    top.current.style.clipPath = `polygon(0 0, 100% 0, 100% ${yr}%, 0 ${yl}%)`
    bottom.current.style.clipPath = `polygon(0 ${yl}%, 100% ${yr}%, 100% 100%, 0 100%)`
    const path = trail.current.querySelector('path')
    path.setAttribute('d', `M ${SWIPE.x0 * W} ${SWIPE.y0 * H} L ${SWIPE.x1 * W} ${SWIPE.y1 * H}`)
    const len = Math.hypot((SWIPE.x1 - SWIPE.x0) * W, (SWIPE.y1 - SWIPE.y0) * H)
    path.style.strokeDasharray = `${len}`
    const angle = (Math.atan2((SWIPE.y1 - SWIPE.y0) * H, (SWIPE.x1 - SWIPE.x0) * W) * 180) / Math.PI

    const setBear = (url) => {
      for (const el of [bear.current, top.current, bottom.current]) el.style.backgroundImage = `url(${url})`
    }

    if (reduced()) {
      // one still frame: the bear, the swipe through it, the reward
      setBear(urls[0])
      path.style.strokeDashoffset = '0'
      trail.current.style.opacity = '1'
      pop.current.textContent = '+10'
      pop.current.style.opacity = '1'
      return
    }

    let n = 0
    let timers = []
    const anims = []
    const play = (el, frames, opts) => {
      const a = el.animate(frames, { fill: 'both', ...opts })
      anims.push(a)
      return a
    }
    const later = (ms, fn) => timers.push(setTimeout(fn, ms))

    const loop = () => {
      anims.splice(0).forEach((a) => a.cancel())
      timers.forEach(clearTimeout)
      timers = []
      const k = n++ % 3 // 0, 1, 2 in a row
      setBear(urls[n % urls.length])
      top.current.style.opacity = bottom.current.style.opacity = '0'
      if (k === 0) [...dots.current.children].forEach((d) => d.classList.remove('is-on'))

      // the bear floats down into place, a little wobble as it settles
      play(bear.current, [
        { transform: `translateY(${-H * 0.78}px) rotate(-8deg)`, opacity: 1 },
        { transform: 'translateY(4px) rotate(3deg) scale(1.03, 0.97)', opacity: 1, offset: 0.78 },
        { transform: 'translateY(0) rotate(0deg) scale(1, 1)', opacity: 1 },
      ], { duration: 560, easing: 'cubic-bezier(0.25, 0.7, 0.35, 1)' })

      // the finger swipes through, the trail drawn behind it
      const t0 = 560
      play(finger.current, [
        { transform: `translate(${SWIPE.x0 * W}px, ${SWIPE.y0 * H}px) rotate(${angle - 18}deg)`, opacity: 0 },
        { transform: `translate(${SWIPE.x0 * W}px, ${SWIPE.y0 * H}px) rotate(${angle - 18}deg)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${SWIPE.x1 * W}px, ${SWIPE.y1 * H}px) rotate(${angle - 8}deg)`, opacity: 1, offset: 0.85 },
        { transform: `translate(${SWIPE.x1 * W}px, ${SWIPE.y1 * H}px) rotate(${angle - 8}deg)`, opacity: 0 },
      ], { duration: 520, delay: t0 - 120, easing: 'cubic-bezier(0.55, 0, 0.35, 1)' })
      play(path, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 300, delay: t0, easing: 'cubic-bezier(0.55, 0, 0.35, 1)' })
      play(trail.current, [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: 620, delay: t0 })

      // the cut: the halves part along the swipe, wobble, fall away
      const tc = t0 + 140
      later(tc, () => {
        bear.current.getAnimations().forEach((a) => a.cancel())
        bear.current.style.opacity = '0'
        top.current.style.opacity = bottom.current.style.opacity = '1'
        dots.current.children[k].classList.add('is-on')
        if (k === 2) {
          play(bonus.current, [
            { transform: 'scale(0.3)', opacity: 0 },
            { transform: 'scale(1.18, 0.86)', opacity: 1, offset: 0.25 },
            { transform: 'scale(0.94, 1.06)', opacity: 1, offset: 0.45 },
            { transform: 'scale(1)', opacity: 1, offset: 0.65 },
            { transform: 'scale(1)', opacity: 0 },
          ], { duration: 1500, easing: 'ease-out' })
        }
      })
      play(top.current, [
        { transform: 'translate(0, 0) rotate(0) scale(1, 1)', opacity: 1 },
        { transform: 'translate(-7px, -7px) rotate(-8deg) scale(1.07, 0.93)', opacity: 1, offset: 0.16 },
        { transform: 'translate(-12px, -4px) rotate(-12deg) scale(0.96, 1.04)', opacity: 1, offset: 0.32 },
        { transform: `translate(-30px, ${H * 0.75}px) rotate(-34deg) scale(1, 1)`, opacity: 0 },
      ], { duration: 950, delay: tc, easing: 'cubic-bezier(0.45, 0, 0.7, 0.4)', fill: 'forwards' })
      play(bottom.current, [
        { transform: 'translate(0, 0) rotate(0) scale(1, 1)', opacity: 1 },
        { transform: 'translate(6px, 6px) rotate(6deg) scale(1.06, 0.94)', opacity: 1, offset: 0.16 },
        { transform: 'translate(11px, 9px) rotate(10deg) scale(0.97, 1.03)', opacity: 1, offset: 0.32 },
        { transform: `translate(24px, ${H * 0.85}px) rotate(28deg) scale(1, 1)`, opacity: 0 },
      ], { duration: 950, delay: tc, easing: 'cubic-bezier(0.45, 0, 0.7, 0.4)', fill: 'forwards' })
      ;[...crumbs.current.children].forEach((c, i) => {
        const a = ((angle + (i - 2) * 26) * Math.PI) / 180
        const r = 26 + (i % 3) * 12
        play(c, [
          { transform: 'translate(0, 0) scale(0.4)', opacity: 0 },
          { transform: `translate(${Math.cos(a) * r * 0.5}px, ${Math.sin(a) * r * 0.5 - 6}px) scale(1)`, opacity: 1, offset: 0.25 },
          { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r + 30}px) scale(0.6)`, opacity: 0 },
        ], { duration: 650, delay: tc, easing: 'ease-out' })
      })
      pop.current.textContent = k === 2 ? '+15' : '+10'
      play(pop.current, [
        { transform: 'translate(-50%, 0) scale(0.4)', opacity: 0 },
        { transform: 'translate(-50%, -10px) scale(1.15, 0.9)', opacity: 1, offset: 0.18 },
        { transform: 'translate(-50%, -14px) scale(0.96, 1.05)', opacity: 1, offset: 0.32 },
        { transform: 'translate(-50%, -30px) scale(1)', opacity: 0 },
      ], { duration: 900, delay: tc + 40, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' })

      later(LOOP_MS, loop)
    }
    loop()
    return () => {
      timers.forEach(clearTimeout)
      anims.forEach((a) => a.cancel())
    }
  }, [urls])

  const box = { width: BEAR_W, height: BEAR_H, marginLeft: -BEAR_W / 2, marginTop: -BEAR_H / 2 }
  return (
    <div className="howto" aria-hidden="true">
      <div ref={stage} className="howto-stage">
        <div ref={bear} className="howto-bear" style={box} />
        <div ref={top} className="howto-bear is-half" style={{ ...box, opacity: 0 }} />
        <div ref={bottom} className="howto-bear is-half" style={{ ...box, opacity: 0 }} />
        <div ref={crumbs} className="howto-crumbs">
          {Array.from({ length: 5 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
        <svg ref={trail} className="howto-trail">
          <path />
        </svg>
        <div ref={finger} className="howto-finger">
          <FontAwesomeIcon icon={faHandPointer} />
        </div>
        <div ref={pop} className="howto-pop" />
      </div>
      <div className="howto-streak">
        <span ref={dots} className="howto-dots">
          <i />
          <i />
          <i />
        </span>
        <span>in a row</span>
        <b ref={bonus} className="howto-bonus">
          ×1.5
        </b>
      </div>
    </div>
  )
}
