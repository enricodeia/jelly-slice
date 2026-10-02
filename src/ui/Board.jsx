// The leaderboard: the score to beat up top (the hero), then the best round
// per nickname, gold · silver · bronze for the first three. Shared by the
// menu and the results; `refresh` re-reads it (after a round is submitted),
// `highlight` marks the player.

import { useEffect, useState } from 'react'
import { leaderboard, REMOTE } from '../game/leaderboard.js'

const fmt = new Intl.NumberFormat('en-US')

export default function Board({ limit = 5, highlight = '', refresh = 0, title = 'Score to beat', hero = true }) {
  const [rows, setRows] = useState(null) // null while loading
  const [error, setError] = useState(null)

  useEffect(() => {
    let off = false
    setError(null)
    leaderboard
      .top(limit)
      .then((r) => !off && setRows(r))
      .catch((e) => {
        if (off) return
        setError(e.message || 'offline')
        setRows([])
      })
    return () => {
      off = true
    }
  }, [limit, refresh])

  const me = highlight.toLowerCase()
  const top = rows && rows[0]

  return (
    <section className="board" aria-label="Leaderboard">
      <header className="board-head">
        <span className="kicker">{title}</span>
        {hero && top && (
          <>
            <b className="board-top">{fmt.format(top.score)}</b>
            <span className="board-by">by {top.nickname}</span>
          </>
        )}
      </header>
      <ol className="board-list">
        {rows === null &&
          Array.from({ length: Math.min(limit, 3) }, (_, i) => (
            <li key={i} className="is-loading" aria-hidden="true">
              <span className="board-rank">{i + 1}</span>
              <span className="board-name" />
              <span className="board-score" />
            </li>
          ))}
        {rows &&
          rows.map((r, i) => (
            <li key={`${r.nickname}-${i}`} className={`rank-${i + 1}${r.nickname.toLowerCase() === me ? ' is-me' : ''}`}>
              <span className="board-rank">{i + 1}</span>
              <span className="board-name">{r.nickname}</span>
              <span className="board-score">{fmt.format(r.score)}</span>
            </li>
          ))}
        {rows && rows.length === 0 && !error && <li className="board-empty">No scores yet. Be the first!</li>}
      </ol>
      <footer className="board-foot">
        <span className={`dot${error ? ' is-off' : ''}`} />
        {error ? 'Leaderboard offline' : REMOTE ? 'Global leaderboard' : 'Scores on this device'}
      </footer>
    </section>
  )
}
