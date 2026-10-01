// Entrance and menu. The HARIBO logo drops in like a gummy and breathes while
// the scene warms up; then it rises and the menu comes in under it (the rules,
// your nickname, the score to beat) with the bears already drifting down
// behind the paper. Play docks the logo to the top centre with a jelly
// landing, and the countdown starts.
//
// Transforms and opacity only, through the Web Animations API (compositor
// work: smooth while the main thread builds the bear and compiles shaders).
// The docked state is committed to plain CSS, so it holds on resize.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { game, cleanNickname, nicknameOk, PRACTICE } from '../game/game.js'
import Board from './Board.jsx'

const MIN_SHOW_MS = 1600 // let the entrance land, even on a fast load
const LOGO_ASPECT = 460 / 1600
const reducedMotion = () => PRACTICE || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)

// the logo's widths: at rest (its CSS), over the menu, docked
const baseWidth = () => Math.min(window.innerWidth * 0.64, 700)
const menuWidth = () => Math.min(360, window.innerWidth * 0.6)
const dockWidth = () => Math.round(Math.min(210, window.innerWidth * 0.34))
const dockTop = () => (window.innerWidth < 640 ? 16 : 22)

// the element is centred by translate(-50%, -50%); a pose moves its centre and scales it
const pose = ({ dy, k }) => `translate(-50%, -50%) translateY(${dy}px) scale(${k})`

// logo above the card, the pair centred in the viewport
function menuLayout(card) {
  const vh = window.innerHeight
  const lm = menuWidth() * LOGO_ASPECT
  const gap = vh < 720 ? 14 : 24
  const g = lm + gap + card.offsetHeight
  const top = Math.max(10, (vh - g) / 2)
  const cardTop = top + lm + gap
  return { dy: top + lm / 2 - vh / 2, k: menuWidth() / baseWidth(), cardTop, maxHeight: vh - cardTop - 10 }
}

export default function Intro({ ready }) {
  const veilRef = useRef()
  const dockRef = useRef()
  const jellyRef = useRef()
  const barRef = useRef()
  const cardRef = useRef()
  const inputRef = useRef()
  const shownAt = useRef(performance.now())
  const idleRef = useRef(null)
  const menuPose = useRef({ dy: 0, k: 1 })
  const [phase, setPhase] = useState('intro') // intro → menu → docking → docked
  const [name, setName] = useState(() => game.getSnapshot().nickname)

  // the entrance: a gummy drop, then a slow breath while the scene warms
  useEffect(() => {
    const jelly = jellyRef.current
    if (reducedMotion()) {
      jelly.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'forwards' })
    } else {
      jelly.animate(
        [
          { transform: 'translateY(48px) scale(0.32, 0.32)', opacity: 0 },
          { transform: 'translateY(-10px) scale(1.1, 0.87)', opacity: 1, offset: 0.4 },
          { transform: 'translateY(0) scale(0.93, 1.07)', offset: 0.58 },
          { transform: 'scale(1.035, 0.97)', offset: 0.74 },
          { transform: 'scale(0.99, 1.012)', offset: 0.88 },
          { transform: 'scale(1, 1)', opacity: 1 },
        ],
        { duration: 1150, easing: 'cubic-bezier(0.25, 0.75, 0.35, 1)', fill: 'forwards' }
      )
      idleRef.current = jelly.animate(
        [{ transform: 'scale(1, 1)' }, { transform: 'scale(1.014, 0.987)' }, { transform: 'scale(0.992, 1.008)' }, { transform: 'scale(1, 1)' }],
        { duration: 1800, delay: 1150, iterations: Infinity, easing: 'ease-in-out' }
      )
    }
    barRef.current.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(0.82)' }], {
      duration: 2600,
      delay: 300,
      easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)',
      fill: 'forwards',
    })
  }, [])

  // warm → the menu (tools: straight to a docked logo and play)
  useEffect(() => {
    if (!ready || phase !== 'intro') return
    const wait = PRACTICE ? 0 : Math.max(0, MIN_SHOW_MS - (performance.now() - shownAt.current))
    const t = setTimeout(() => (PRACTICE ? dock() : setPhase('menu')), wait)
    return () => clearTimeout(t)
  }, [ready, phase])

  // the menu is in the DOM: measure it, lift the logo over it, bring it in
  useLayoutEffect(() => {
    if (phase !== 'menu') return
    const card = cardRef.current
    const motion = !reducedMotion()
    const place = (animate) => {
      const L = menuLayout(card)
      card.style.top = `${L.cardTop}px`
      card.style.maxHeight = `${L.maxHeight}px`
      const from = menuPose.current
      menuPose.current = { dy: L.dy, k: L.k }
      dockRef.current.getAnimations().forEach((a) => a.cancel())
      dockRef.current.animate([{ transform: pose(animate ? from : menuPose.current) }, { transform: pose(menuPose.current) }], {
        duration: animate && motion ? 900 : 1,
        easing: 'cubic-bezier(0.7, 0, 0.2, 1)',
        fill: 'forwards',
      })
    }
    idleRef.current?.cancel()
    place(true)
    if (motion) {
      jellyRef.current.animate(
        [
          { transform: 'scale(1, 1)' },
          { transform: 'scale(0.92, 1.08)', offset: 0.2 },
          { transform: 'scale(1, 1)', offset: 0.6 },
          { transform: 'scale(1.06, 0.94)', offset: 0.75 },
          { transform: 'scale(0.98, 1.02)', offset: 0.88 },
          { transform: 'scale(1, 1)' },
        ],
        { duration: 1200, easing: 'ease-out' }
      )
    }
    barRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' })
    veilRef.current.animate([{ opacity: 1 }, { opacity: 0.8 }], { duration: 900, easing: 'ease-in-out', fill: 'forwards' })
    card.animate(
      [
        { opacity: 0, transform: 'translate(-50%, 26px)' },
        { opacity: 1, transform: 'translate(-50%, 0)' },
      ],
      // in once the logo has mostly lifted clear of it
      { duration: motion ? 700 : 1, delay: motion ? 620 : 0, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'both' }
    )
    // a keyboard is waiting to type; a phone shouldn't throw its keyboard up unasked
    const focus = setTimeout(() => {
      if (matchMedia('(pointer: fine)').matches) inputRef.current?.focus({ preventScroll: true })
    }, 900)
    const onResize = () => place(false)
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(focus)
      window.removeEventListener('resize', onResize)
    }
  }, [phase])

  function play(e) {
    e.preventDefault()
    const clean = cleanNickname(name)
    if (!nicknameOk(clean)) {
      inputRef.current?.focus()
      return
    }
    setName(clean)
    game.setNickname(clean)
    inputRef.current?.blur()
    dock()
  }

  function dock() {
    const fromMenu = phase === 'menu'
    setPhase('docking')
    const dockEl = dockRef.current
    const jelly = jellyRef.current
    idleRef.current?.cancel()
    const motion = !reducedMotion()

    // where it lands: top centre, a modest header size
    const dw = dockWidth()
    const top = dockTop()
    const to = { dy: top + (dw * LOGO_ASPECT) / 2 - window.innerHeight / 2, k: dw / baseWidth() }
    const from = fromMenu ? menuPose.current : { dy: 0, k: 1 }

    cardRef.current?.animate(
      [
        { opacity: 1, transform: 'translate(-50%, 0)' },
        { opacity: 0, transform: 'translate(-50%, 18px)' },
      ],
      { duration: motion ? 320 : 1, easing: 'ease-in', fill: 'forwards' }
    )
    if (!fromMenu) {
      barRef.current?.animate(
        [{ transform: 'scaleX(0.82)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 1, offset: 0.5 }, { transform: 'scaleX(1)', opacity: 0 }],
        { duration: 420, easing: 'ease-out', fill: 'forwards' }
      )
    }
    dockEl.getAnimations().forEach((a) => a.cancel())
    // 'both': it holds the start pose through the delay (the menu pose was
    // just cancelled; without it the logo would flash back to the centre)
    const travel = dockEl.animate([{ transform: pose(from) }, { transform: pose(to) }], {
      duration: motion ? 840 : 1,
      delay: motion ? 120 : 0,
      easing: 'cubic-bezier(0.75, 0, 0.2, 1)',
      fill: 'both',
    })
    if (motion) {
      // on arrival it settles like jelly
      jelly.animate(
        [
          { transform: 'scale(1, 1)' },
          { transform: 'scale(0.9, 1.1)', offset: 0.18 },
          { transform: 'scale(1, 1)', offset: 0.62 },
          { transform: 'scale(1.09, 0.9)', offset: 0.75 },
          { transform: 'scale(0.96, 1.04)', offset: 0.86 },
          { transform: 'scale(1.015, 0.99)', offset: 0.94 },
          { transform: 'scale(1, 1)' },
        ],
        { duration: 1300, delay: 120, easing: 'ease-out' }
      )
    }
    const veil = veilRef.current
    const veilFrom = getComputedStyle(veil).opacity
    veil.getAnimations().forEach((a) => a.cancel())
    veil.animate([{ opacity: veilFrom }, { opacity: 0 }], {
      duration: 700,
      delay: motion ? 300 : 0,
      easing: 'ease-in-out',
      fill: 'forwards',
    })

    // the countdown starts as the veil lifts (tools are already playing)
    if (!PRACTICE) setTimeout(() => game.start(), motion ? 360 : 0)

    travel.finished.then(() => {
      // commit to plain CSS (exactly the animation's end state), then drop
      // the animations in the same task, so no frame shows both
      dockEl.style.top = `${top}px`
      dockEl.style.width = `${dw}px`
      dockEl.style.transform = 'translateX(-50%)'
      dockEl.getAnimations().forEach((a) => a.cancel())
      setPhase('docked')
    })
  }

  const showCard = phase === 'menu' || phase === 'docking'

  return (
    <>
      {phase !== 'docked' && <div ref={veilRef} className="preloader-veil" />}
      <div ref={dockRef} className={`brand brand--${phase}`}>
        <div ref={jellyRef} className="brand-jelly">
          <img src="/haribo-logo.webp" alt="HARIBO" draggable="false" />
        </div>
        {phase === 'intro' && (
          <div className="brand-progress" aria-hidden="true">
            <span ref={barRef} />
          </div>
        )}
      </div>
      {showCard && (
        <div ref={cardRef} className="menu-card" style={{ opacity: 0 }}>
          <p className="kicker">60-second challenge</p>
          <h1 className="menu-title">Slice the Goldbears</h1>
          <p className="menu-copy">
            Swipe through the falling bears. Slice them one after another to multiply every point, up to ×8. Let one fall and
            the streak breaks.
          </p>
          <form className="menu-form" onSubmit={play}>
            <label className="menu-field">
              <span className="kicker">Your nickname</span>
              <input
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 16))}
                maxLength={16}
                autoComplete="nickname"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="go"
                placeholder="2 to 16 letters"
                aria-label="Your nickname"
              />
            </label>
            <button className="menu-play" type="submit" disabled={!nicknameOk(name)}>
              Play
            </button>
          </form>
          <Board limit={5} title="Score to beat" />
        </div>
      )}
    </>
  )
}
