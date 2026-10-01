// Entrance: the HARIBO logo drops in like a gummy (overshooting squash and
// stretch), breathes while the scene warms up, then docks to the top centre as
// the game starts, with a little jelly landing — and stays there.
//
// Everything animates transform/opacity through the Web Animations API, so it
// runs on the compositor and stays smooth while the main thread is busy
// building the bear and compiling shaders. The docked state is then committed
// to plain CSS, so it holds its place on resize.

import { useEffect, useRef, useState } from 'react'

const MIN_SHOW_MS = 1600 // let the entrance land before docking, even on a fast load
const LOGO_ASPECT = 460 / 1600

// ?nointro (review tools): dock at once, no choreography
const NO_INTRO = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nointro')
const reducedMotion = () => NO_INTRO || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)

export default function Preloader({ ready, onStart }) {
  const veilRef = useRef()
  const dockRef = useRef()
  const jellyRef = useRef()
  const barRef = useRef()
  const shownAt = useRef(performance.now())
  const idleRef = useRef(null)
  const [phase, setPhase] = useState('intro') // intro → docking → docked

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
      // a slow jelly breath while the scene warms up
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

  useEffect(() => {
    if (!ready || phase !== 'intro') return
    const wait = NO_INTRO ? 0 : Math.max(0, MIN_SHOW_MS - (performance.now() - shownAt.current))
    const t = setTimeout(dock, wait)
    return () => clearTimeout(t)
  }, [ready, phase])

  function dock() {
    setPhase('docking')
    const dockEl = dockRef.current
    const jelly = jellyRef.current
    idleRef.current?.cancel()

    // where it lands: top centre, a modest header size
    const from = dockEl.getBoundingClientRect()
    const dockWidth = Math.round(Math.min(210, window.innerWidth * 0.34))
    const top = window.innerWidth < 640 ? 16 : 22
    const s = dockWidth / from.width
    const dy = top + (dockWidth * LOGO_ASPECT) / 2 - (from.top + from.height / 2)
    const motion = !reducedMotion()

    barRef.current.animate(
      [{ transform: 'scaleX(0.82)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 1, offset: 0.5 }, { transform: 'scaleX(1)', opacity: 0 }],
      { duration: 420, easing: 'ease-out', fill: 'forwards' }
    )

    const travel = dockEl.animate(
      [
        { transform: 'translate(-50%, -50%) translateY(0) scale(1)' },
        { transform: `translate(-50%, -50%) translateY(${dy}px) scale(${s})` },
      ],
      { duration: motion ? 880 : 1, delay: motion ? 180 : 0, easing: 'cubic-bezier(0.75, 0, 0.2, 1)', fill: 'forwards' }
    )
    if (motion) {
      // on arrival it settles like jelly
      jelly.animate(
        [
          { transform: 'scale(1, 1)' },
          { transform: 'scale(0.9, 1.1)', offset: 0.18 }, // stretched by the pull upwards
          { transform: 'scale(1, 1)', offset: 0.62 },
          { transform: 'scale(1.09, 0.9)', offset: 0.75 }, // lands
          { transform: 'scale(0.96, 1.04)', offset: 0.86 },
          { transform: 'scale(1.015, 0.99)', offset: 0.94 },
          { transform: 'scale(1, 1)' },
        ],
        { duration: 1300, delay: 180, easing: 'ease-out' }
      )
    }
    veilRef.current.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 700,
      delay: motion ? 380 : 0,
      easing: 'ease-in-out',
      fill: 'forwards',
    })

    // the first bears start falling as the veil lifts
    setTimeout(() => onStart?.(), motion ? 420 : 0)

    travel.finished.then(() => {
      // commit to plain CSS — exactly the animation's end state — and drop the
      // animation in the same task, so no frame shows both
      dockEl.style.top = `${top}px`
      dockEl.style.width = `${dockWidth}px`
      dockEl.style.transform = 'translateX(-50%)'
      travel.cancel()
      setPhase('docked')
    })
  }

  return (
    <>
      {phase !== 'docked' && <div ref={veilRef} className="preloader-veil" />}
      <div ref={dockRef} className={`brand brand--${phase}`}>
        <div ref={jellyRef} className="brand-jelly">
          <img src="/haribo-logo.webp" alt="HARIBO" draggable="false" />
        </div>
        {phase !== 'docked' && (
          <div className="brand-progress" aria-hidden="true">
            <span ref={barRef} />
          </div>
        )}
      </div>
    </>
  )
}
