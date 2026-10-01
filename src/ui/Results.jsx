// The end of a round: the score counts up, your best and your rank, the
// leaderboard with your row marked (re-read once the round is in), and Play
// again, with the nickname still editable.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { game, cleanNickname, nicknameOk, RANKED } from '../game/game.js'
import { REMOTE } from '../game/leaderboard.js'
import Board from './Board.jsx'

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
        { opacity: 0, transform: 'translate(-50%, -50%) translateY(30px) scale(0.94, 0.9)' },
        { opacity: 1, transform: 'translate(-50%, -50%) translateY(-4px) scale(1.02, 0.99)', offset: 0.55 },
        { opacity: 1, transform: 'translate(-50%, -50%) translateY(0) scale(0.995, 1.005)', offset: 0.8 },
        { opacity: 1, transform: 'translate(-50%, -50%) translateY(0) scale(1, 1)' },
      ],
      { duration: 700, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'both' }
    )
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
    game.start()
  }

  return (
    <div className="results">
      <div className="results-veil" />
      <div ref={cardRef} className="results-card" role="dialog" aria-label="Round over">
        <p className="kicker">Time</p>
        <div className="results-score">{fmt.format(shown)}</div>
        <p className={`results-best${r.newBest ? ' is-new' : ''}`}>
          {r.newBest ? 'New personal best' : g.best > 0 ? `Your best ${fmt.format(g.best)}` : ''}
        </p>
        <p className="results-rank">{rankLine(r, score)}</p>
        <div className="results-stats">
          <span>
            <b>{g.stats.bears}</b> bears
          </span>
          <span>
            <b>{g.stats.slices}</b> slices
          </span>
          <span>
            <b>{g.stats.bestStreak}</b> best streak
          </span>
        </div>
        <Board limit={8} highlight={g.nickname} refresh={r.pending ? 0 : 1} title="Leaderboard" />
        <form className="results-again" onSubmit={again}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 16))}
            maxLength={16}
            autoComplete="nickname"
            spellCheck={false}
            enterKeyHint="go"
            aria-label="Your nickname"
          />
          <button className="menu-play" type="submit" disabled={!nicknameOk(name)}>
            Play again
          </button>
        </form>
      </div>
    </div>
  )
}
