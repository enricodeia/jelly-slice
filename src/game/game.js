// Score, streak and multiplier: plain module state that the 3D side writes
// and the DOM reads (useSyncExternalStore), plus a small event bus for the
// one-off effects (points floating off a cut, tier callouts, streak lost).
//
// The streak counts bears sliced in succession: the first cut through each
// whole bear adds one; a whole bear that leaves the frame uncut breaks it.
// The streak picks the tier, and the tier the multiplier on every slice.

export const TIERS = [
  { at: 0, mult: 1, color: '#6f6a5d' },
  { at: 3, mult: 1.5, color: '#c0601c' }, // orange
  { at: 6, mult: 2, color: '#b01e2c' }, // strawberry
  { at: 10, mult: 4, color: '#7e1d58' }, // raspberry
  { at: 15, mult: 8, color: '#a8770c' }, // gold
]

const POINTS_BEAR = 10 // the first cut through a whole bear
const POINTS_PIECE = 5 // every further cut through a piece
const BEST_KEY = 'jelly-slice-best-score'
const MUTE_KEY = 'jelly-slice-muted'

function readNumber(key) {
  try {
    return Number(localStorage.getItem(key)) || 0
  } catch {
    return 0
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* storage unavailable: it just won't persist */
  }
}

let snapshot = {
  score: 0,
  best: readNumber(BEST_KEY),
  streak: 0,
  tier: 0,
  muted: readNumber(MUTE_KEY) === 1,
}
const listeners = new Set()
const eventListeners = new Set()

function set(patch) {
  snapshot = { ...snapshot, ...patch }
  if (snapshot.score > snapshot.best) {
    snapshot.best = snapshot.score
    write(BEST_KEY, snapshot.best)
  }
  listeners.forEach((l) => l())
}

export function tierFor(streak) {
  let t = 0
  for (let i = 0; i < TIERS.length; i++) if (streak >= TIERS[i].at) t = i
  return t
}

export function formatMult(m) {
  return `×${m}`
}

export const game = {
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
  emit(event) {
    eventListeners.forEach((l) => l(event))
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

  /** A cut landed. `whole`: the first cut through this bear (advances the streak). */
  cut({ whole }) {
    const streak = whole ? snapshot.streak + 1 : snapshot.streak
    const tier = tierFor(streak)
    const tierUp = tier > snapshot.tier
    const mult = TIERS[tier].mult
    const points = Math.round((whole ? POINTS_BEAR : POINTS_PIECE) * mult)
    set({ streak, tier, score: snapshot.score + points })
    return { points, tier, tierUp, mult, streak }
  },

  /** A whole bear left the frame uncut: the streak breaks. */
  miss() {
    const was = { streak: snapshot.streak, tier: snapshot.tier }
    if (snapshot.streak > 0) set({ streak: 0, tier: 0 })
    return was
  },

  reset() {
    set({ score: 0, streak: 0, tier: 0 })
  },

  setMuted(muted) {
    write(MUTE_KEY, muted ? 1 : 0)
    set({ muted })
  },
}
