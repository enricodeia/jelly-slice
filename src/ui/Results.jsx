// The end of a round: the score counts up, your best and your rank, the
// leaderboard with your row marked (re-read once the round is in), and Play
// again, with the nickname still editable.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { game, cleanNickname, nicknameOk, RANKED } from '../game/game.js'
import { REMOTE } from '../game/leaderboard.js'
import Board from './Board.jsx'
import { useJelly } from './useJelly.js'

const fmt = new Intl.NumberFormat('en-US')
const APPEAR_MS = 1250 // after "Time!" has landed

function useCountUp(target, run, ms = 900) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!run) return
    let raf
    const t0 = performance.now()
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, run, ms])
  return v
}

function rankLine(r, score) {
  if (!RANKED) return 'Practice round, not ranked'
  if (!r.ranked) return score > 0 ? '' : 'Slice a bear to get on the board'
  if (r.pending) return 'Ranking your round'
  if (r.error) return 'Couldn’t reach the leaderboard'
  return `#${fmt.format(r.rank)} of ${fmt.format(r.total)}${REMOTE ? '' : ' on this device'}`
}

export default function Results() {
  const g = useSyncExternalStore(game.subscribe, game.getSnapshot)
  const [show, setShow] = useState(false)
  const [name, setName] = useState(g.nickname)
  const cardRef = useRef()
  const jelly = useJelly()
  const playJelly = useJelly({ stiffness: 320, damping: 10, follow: false })

  useEffect(() => {
    if (g.phase !== 'over') {
      setShow(false)
      return
    }
    setName(game.getSnapshot().nickname)
    const t = setTimeout(() => setShow(true), APPEAR_MS)
    return () => clearTimeout(t)
  }, [g.phase])

  useEffect(() => {
    if (!show || !cardRef.current) return
    cardRef.current.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) translateY(40px)' },
        { opacity: 1, transform: 'translate(-50%, -50%) translateY(0)' },
      ],
      { duration: 480, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'both' }
    )
    // it lands like a gummy
    const t = setTimeout(() => jelly.kick(1.2), 300)
    return () => clearTimeout(t)
  }, [show])

  const r = g.result || {}
  const score = r.score ?? g.score
  const shown = useCountUp(score, show)
  if (!show) return null

  function again(e) {
    e.preventDefault()
    const clean = cleanNickname(name)
    if (!nicknameOk(clean)) return
    if (clean !== g.nickname) game.setNickname(clean)
    playJelly.kick(-1.6)
    game.start()
  }

  const best = r.newBest ? 'New personal best!' : g.best > 0 ? `Your best ${fmt.format(g.best)}` : ''
  const rank = rankLine(r, score)

  return (
    <div className="results">
      <div className="results-veil" />
      <div ref={cardRef} className="results-card" role="dialog" aria-label="Round over">
        <div ref={jelly.ref} className="card-jelly">
          <div className="card-surface">
            <p className="kicker">Time’s up</p>
            <div className="results-score">{fmt.format(shown)}</div>
            {best && <p className={`results-best${r.newBest ? ' is-new' : ''}`}>{best}</p>}
            {rank && <p className="results-rank">{rank}</p>}
            <div className="results-stats">
              <span className="chip">
                <b>{g.stats.bears}</b> bears
              </span>
              <span className="chip">
                <b>{g.stats.slices}</b> slices
              </span>
              <span className="chip">
                <b>{g.stats.bestStreak}</b> best streak
              </span>
            </div>
            <Board limit={6} highlight={g.nickname} refresh={r.pending ? 0 : 1} title="Leaderboard" hero={false} />
            <form className="menu-form" onSubmit={again}>
              <input
                className="pill-input"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 16))}
                maxLength={16}
                autoComplete="nickname"
                spellCheck={false}
                enterKeyHint="go"
                placeholder="Your nickname"
                aria-label="Your nickname"
              />
              <button ref={playJelly.ref} className="btn-play" type="submit" disabled={!nicknameOk(name)}>
                Play again
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
