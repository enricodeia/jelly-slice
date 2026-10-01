import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRotateLeft, faVolume, faVolumeSlash } from '@fortawesome/pro-light-svg-icons'
import { game, TIERS, formatMult, formatClock, ROUND } from '../game/game.js'
import { TIER_FLIGHT_MS } from './FxLayer.jsx'

const fmt = new Intl.NumberFormat('en-US')

// the badge lands like the logo does: a gummy squash and stretch
const POP = [
  { transform: 'scale(1, 1)' },
  { transform: 'scale(1.32, 0.72)', offset: 0.16 },
  { transform: 'scale(0.86, 1.18)', offset: 0.34 },
  { transform: 'scale(1.08, 0.94)', offset: 0.52 },
  { transform: 'scale(0.97, 1.03)', offset: 0.72 },
  { transform: 'scale(1, 1)' },
]
const SHAKE = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-5px) rotate(-3deg)', offset: 0.2 },
  { transform: 'translateX(4px) rotate(2deg)', offset: 0.45 },
  { transform: 'translateX(-2px)', offset: 0.7 },
  { transform: 'translateX(0)' },
]

export default function ScoreHUD({ onReset, visible = true }) {
  const g = useSyncExternalStore(game.subscribe, game.getSnapshot)
  const [hintFaded, setHintFaded] = useState(false)
  const scoreRef = useRef()
  const badgeRef = useRef()
  const clockRef = useRef()
  const prevScore = useRef(g.score)

  useEffect(() => {
    if (g.score > prevScore.current) {
      setHintFaded(true)
      scoreRef.current?.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.14)', offset: 0.35 }, { transform: 'scale(1)' }],
        { duration: 260, easing: 'ease-out' }
      )
    }
    prevScore.current = g.score
  }, [g.score])

  useEffect(() => {
    const timers = new Set()
    const off = game.onEvent((e) => {
      const badge = badgeRef.current
      if (!badge) return
      if (e.type === 'tier') {
        // pops when the flying callout lands in it
        const t = setTimeout(() => {
          timers.delete(t)
          badgeRef.current?.animate(POP, { duration: 620, easing: 'ease-out' })
        }, TIER_FLIGHT_MS - 40)
        timers.add(t)
      } else if (e.type === 'lost') badge.animate(SHAKE, { duration: 420, easing: 'ease-out' })
      else if (e.type === 'tick') {
        clockRef.current?.animate(
          [{ transform: 'scale(1)' }, { transform: `scale(${e.s <= 3 ? 1.22 : 1.12})`, offset: 0.25 }, { transform: 'scale(1)' }],
          { duration: 420, easing: 'ease-out' }
        )
      }
    })
    return () => {
      off()
      timers.forEach(clearTimeout)
    }
  }, [])

  const tier = TIERS[g.tier]
  const next = TIERS[g.tier + 1]
  const progress = next ? Math.min(1, (g.streak - tier.at) / (next.at - tier.at)) : 1
  const label = g.streak === 0 ? 'slice them in a row' : next ? `${g.streak} in a row` : `${g.streak} in a row · max`
  const timed = g.secondsLeft != null
  const urgent = timed && g.phase === 'playing' && g.secondsLeft <= 10

  return (
    <div className={`hud${visible ? ' is-on' : ''}`}>
      {timed && (
        <div className={`hud-clock kicker${urgent ? ' is-urgent' : ''}`}>
          Time
          <b ref={clockRef}>{formatClock(g.secondsLeft)}</b>
          <span className="hud-clock-track">
            <i style={{ transform: `scaleX(${Math.max(0, g.secondsLeft) / ROUND})` }} />
          </span>
        </div>
      )}
      <div className="hud-top">
        <div className="hud-score kicker">
          Score
          <b ref={scoreRef}>{fmt.format(g.score)}</b>
        </div>
        <div className={`hud-mult tier-${g.tier}`} style={{ '--tier': tier.color }}>
          <span ref={badgeRef} className="hud-mult-badge">
            {formatMult(tier.mult)}
          </span>
          <span className="hud-mult-meter">
            <span className="hud-mult-track">
              <i style={{ transform: `scaleX(${progress})` }} />
            </span>
            <span className="hud-mult-label">{label}</span>
          </span>
        </div>
      </div>
      <div className="hud-right">
        <div className="hud-status">
          <span className="dot" />
          best {fmt.format(g.best)}
        </div>
        <button
          className="hud-btn"
          onClick={() => game.setMuted(!g.muted)}
          aria-label={g.muted ? 'Sound on' : 'Mute'}
          aria-pressed={g.muted}
        >
          <FontAwesomeIcon icon={g.muted ? faVolumeSlash : faVolume} />
        </button>
        <button className="hud-btn" onClick={onReset} aria-label="Restart the round" title="Restart the round">
          <FontAwesomeIcon icon={faArrowRotateLeft} />
        </button>
      </div>
      <div className={`hud-hint${hintFaded ? ' faded' : ''}`}>swipe across the falling bears to slice them</div>
    </div>
  )
}
