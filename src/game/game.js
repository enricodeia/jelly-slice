// The game: phase, clock, score, streak and multiplier, plain module state
// that the 3D side writes and the DOM reads (useSyncExternalStore), plus a
// small event bus for the one-off moments (points off a cut, tier callouts,
// streak lost, the countdown, time up).
//
//   loading → menu (nickname, leaderboard) → countdown 3·2·1 → playing (60 s)
//   → over (results, submit) → countdown …
//
// The streak counts bears sliced in succession: the first cut through each
// whole bear adds one; a whole bear that leaves the frame uncut breaks it.
// The streak picks the tier, and the tier the multiplier on every slice.

import { leaderboard } from './leaderboard.js'

// color: the candy fill (badges, callouts, the paper's warmth); ink: a deeper
// shade that reads on paper (points, the blade trail)
export const TIERS = [
  { at: 0, mult: 1, color: '#7d6a5c', ink: '#2b1a12' },
  { at: 3, mult: 1.5, color: '#f28c1a', ink: '#d96a00' }, // orange
  { at: 6, mult: 2, color: '#e10a14', ink: '#c4000f' }, // HARIBO red
  { at: 10, mult: 4, color: '#c2185b', ink: '#a3124a' }, // raspberry
  { at: 15, mult: 8, color: '#ffc61a', ink: '#c98c00' }, // Goldbear gold
]

export const ROUND_SECONDS = 60
const POINTS_BEAR = 10 // the first cut through a whole bear
const POINTS_PIECE = 5 // every further cut through a piece
const COUNTDOWN = 3
const BEST_KEY = 'jelly-slice-best-60s'
const MUTE_KEY = 'jelly-slice-muted'
const NAME_KEY = 'jelly-slice-nickname'

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
// ?nointro (review tools): straight into an endless, untimed practice round
export const PRACTICE = params.has('nointro')
// ?panel: the tuning panel is out; a tuned run is never ranked
export const PANEL = params.has('panel')
// ?round=N (testing): an N-second round, never ranked
export const ROUND = Math.max(3, Math.min(600, Number(params.get('round')) || ROUND_SECONDS))
export const RANKED = !PRACTICE && !PANEL && ROUND === ROUND_SECONDS

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : v
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* storage unavailable: it just won't persist */
  }
}

/** Trim, collapse spaces, keep letters, digits and a little punctuation; 16 max. */
export function cleanNickname(name) {
  return String(name || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _.\-']/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16)
}

export const nicknameOk = (name) => cleanNickname(name).length >= 2

const freshStats = () => ({ bears: 0, slices: 0, bestStreak: 0 })

let snapshot = {
  phase: 'loading',
  score: 0,
  best: Number(read(BEST_KEY, 0)) || 0, // this device's best 60 s round
  streak: 0,
  tier: 0,
  muted: read(MUTE_KEY, '0') === '1',
  nickname: cleanNickname(read(NAME_KEY, '')),
  count: COUNTDOWN, // the countdown's current number
  secondsLeft: PRACTICE ? null : ROUND, // whole seconds, for the HUD (null: untimed)
  stats: freshStats(),
  result: null, // { score, ranked, pending, rank, total, best, newBest, error }
}
const listeners = new Set()
const eventListeners = new Set()

function set(patch) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((l) => l())
}

function emit(event) {
  eventListeners.forEach((l) => l(event))
}

export function tierFor(streak) {
  let t = 0
  for (let i = 0; i < TIERS.length; i++) if (streak >= TIERS[i].at) t = i
  return t
}

export function formatMult(m) {
  return `×${m}`
}

export function formatClock(s) {
  const v = Math.max(0, Math.ceil(s))
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}

export const game = {
  // precise, non-reactive clocks (seconds), advanced by update()
  clock: { left: PRACTICE ? Infinity : ROUND, count: COUNTDOWN },

  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  getSnapshot() {
    return snapshot
  },
  onEvent(fn) {
    eventListeners.add(fn)
    return () => eventListeners.delete(fn)
  },
  emit,

  /** The scene is built and warm: show the menu (tools skip straight to play). */
  ready() {
    if (snapshot.phase !== 'loading') return
    if (PRACTICE) set({ phase: 'playing' })
    else set({ phase: 'menu' })
  },

  setNickname(name) {
    const nickname = cleanNickname(name)
    write(NAME_KEY, nickname)
    set({ nickname })
  },

  /** A new round: 3 · 2 · 1, then the clock runs. */
  start() {
    game.clock.count = COUNTDOWN
    game.clock.left = PRACTICE ? Infinity : ROUND
    set({
      phase: 'countdown',
      count: COUNTDOWN,
      score: 0,
      streak: 0,
      tier: 0,
      stats: freshStats(),
      result: null,
      secondsLeft: PRACTICE ? null : ROUND,
    })
    emit({ type: 'count', n: COUNTDOWN })
  },

  /** Every frame (seconds of wall time, capped by the caller). */
  update(dt) {
    const ph = snapshot.phase
    if (ph === 'countdown') {
      const c = (game.clock.count -= dt)
      const n = Math.ceil(c)
      if (c <= 0) {
        set({ phase: 'playing', count: 0 })
        emit({ type: 'go' })
      } else if (n !== snapshot.count) {
        set({ count: n })
        emit({ type: 'count', n })
      }
    } else if (ph === 'playing' && !PRACTICE) {
      const left = (game.clock.left -= dt)
      const s = Math.max(0, Math.ceil(left))
      if (s !== snapshot.secondsLeft) {
        set({ secondsLeft: s })
        if (s > 0 && s <= 10) emit({ type: 'tick', s })
      }
      if (left <= 0) game.end()
    }
  },

  /** Time up: score the round, keep the device best, rank it. */
  end() {
    if (snapshot.phase !== 'playing') return
    const { score, nickname, stats } = snapshot
    const ranked = RANKED && score > 0 && nicknameOk(nickname)
    const newBest = RANKED && score > snapshot.best
    if (newBest) write(BEST_KEY, score)
    set({
      phase: 'over',
      secondsLeft: 0,
      best: newBest ? score : snapshot.best,
      result: { score, ranked, pending: ranked, newBest },
    })
    emit({ type: 'time', score, newBest })
    if (!ranked) return
    leaderboard
      .submit({ nickname, score, bears: stats.bears, bestStreak: stats.bestStreak })
      .then((r) => set({ result: { ...snapshot.result, ...r, pending: false } }))
      .catch((err) => set({ result: { ...snapshot.result, pending: false, error: String(err.message || err) } }))
  },

  /** A cut landed. `whole`: the first cut through this bear (advances the streak). */
  cut({ whole }) {
    const streak = whole ? snapshot.streak + 1 : snapshot.streak
    const tier = tierFor(streak)
    const tierUp = tier > snapshot.tier
    const mult = TIERS[tier].mult
    const points = Math.round((whole ? POINTS_BEAR : POINTS_PIECE) * mult)
    const s = snapshot.stats
    const stats = { bears: s.bears + (whole ? 1 : 0), slices: s.slices + 1, bestStreak: Math.max(s.bestStreak, streak) }
    set({ streak, tier, score: snapshot.score + points, stats })
    return { points, tier, tierUp, mult, streak }
  },

  /** A whole bear left the frame uncut: the streak breaks. */
  miss() {
    const was = { streak: snapshot.streak, tier: snapshot.tier }
    if (snapshot.streak > 0) set({ streak: 0, tier: 0 })
    return was
  },

  /** Streak needed for ×1.5, ×2, ×4, ×8 (the panel tunes them). */
  setThresholds(list) {
    let changed = false
    list.forEach((at, i) => {
      const t = TIERS[i + 1]
      if (t && t.at !== at) {
        t.at = at
        changed = true
      }
    })
    if (changed) set({ tier: tierFor(snapshot.streak) })
  },

  setMuted(muted) {
    write(MUTE_KEY, muted ? 1 : 0)
    set({ muted })
  },
}
