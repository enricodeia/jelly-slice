// The leaderboard: the best 60 s score per nickname.
//
// Global when the build has VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (the
// public anon key, meant for browsers): it reads the `leaderboard` view and
// writes only through the `submit_score` function, which validates the run
// (supabase/schema.sql). Plain fetch on Supabase's REST API, no client
// library. Without those variables it keeps a board on this device, and says
// so in the UI.

const URL_ = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const LOCAL_KEY = 'jelly-slice-board'
const TIMEOUT_MS = 7000

export const REMOTE = !!(URL_ && KEY)

async function rest(path, { method = 'GET', body } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${URL_.replace(/\/$/, '')}/rest/v1/${path}`, {
      method,
      signal: ctrl.signal,
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : null
    if (!res.ok) throw new Error((data && (data.message || data.hint)) || `leaderboard ${res.status}`)
    return data
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('leaderboard timed out')
    throw err
  } finally {
    clearTimeout(t)
  }
}

// ── this device ──
function readLocal() {
  try {
    const list = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')
    return Array.isArray(list) ? list.filter((r) => r && typeof r.nickname === 'string' && Number.isFinite(r.score)) : []
  } catch {
    return []
  }
}

function writeLocal(list) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, 200)))
  } catch {
    /* storage unavailable */
  }
}

const byScore = (a, b) => b.score - a.score || a.at - b.at

export const leaderboard = {
  remote: REMOTE,

  /** Best score per nickname, highest first: [{ nickname, score }] */
  async top(limit = 10) {
    if (REMOTE) {
      const rows = await rest(`leaderboard?select=nickname,score&order=score.desc,created_at.asc&limit=${limit}`)
      return rows.map((r) => ({ nickname: r.nickname, score: r.score }))
    }
    return readLocal().sort(byScore).slice(0, limit)
  },

  /** Records a finished round. → { rank, total, best } for this nickname */
  async submit({ nickname, score, bears = 0, bestStreak = 0 }) {
    if (REMOTE) {
      const r = await rest('rpc/submit_score', {
        method: 'POST',
        body: { p_nickname: nickname, p_score: score, p_bears: bears, p_best_streak: bestStreak },
      })
      return { rank: r.rank, total: r.total, best: r.best }
    }
    const list = readLocal()
    const key = nickname.toLowerCase()
    const mine = list.find((r) => r.nickname.toLowerCase() === key)
    if (!mine) list.push({ nickname, score, at: Date.now() })
    else if (score > mine.score) Object.assign(mine, { nickname, score, at: Date.now() })
    list.sort(byScore)
    writeLocal(list)
    const best = Math.max(score, mine ? mine.score : 0)
    return { rank: list.filter((r) => r.score > best).length + 1, total: list.length, best }
  },
}
