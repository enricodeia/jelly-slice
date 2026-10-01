// The leaderboard as a small editorial table: the score to beat up top, then
// the best round per nickname. Shared by the menu and the results; `refresh`
// re-reads it (after a round is submitted), `highlight` marks the player.

import { useEffect, useState } from 'react'
import { leaderboard, REMOTE } from '../game/leaderboard.js'

const fmt = new Intl.NumberFormat('en-US')

export default function Board({ limit = 5, highlight = '', refresh = 0, title = 'Score to beat' }) {
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
        {top ? (
          <span className="board-best">
            <b>{fmt.format(top.score)}</b>
            <span>{top.nickname}</span>
          </span>
        ) : (
          <span className="board-best">
            <span>{rows ? 'no scores yet' : ''}</span>
          </span>
        )}
      </header>
      <ol className={`board-list${rows === null ? ' is-loading' : ''}`}>
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
            <li key={`${r.nickname}-${i}`} className={r.nickname.toLowerCase() === me ? 'is-me' : ''}>
              <span className="board-rank">{i + 1}</span>
              <span className="board-name">{r.nickname}</span>
              <span className="board-score">{fmt.format(r.score)}</span>
            </li>
          ))}
        {rows && rows.length === 0 && !error && <li className="board-empty">Be the first on the board.</li>}
      </ol>
      <footer className="board-foot">
        <span className={`dot${error ? ' is-off' : ''}`} />
        {error ? 'Leaderboard offline' : REMOTE ? 'Global leaderboard' : 'Scores on this device'}
      </footer>
    </section>
  )
}
