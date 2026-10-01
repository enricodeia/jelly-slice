// Sound, synthesised on the fly with Web Audio (nothing to download): the
// knife's swish, a wet jelly "blup" on every slice that climbs a semitone per
// bear in the streak, a chime that grows with each multiplier tier, and a
// soft falling note when the streak breaks.
//
// Creating an AudioContext blocks the main thread (~150 ms in Chrome), so
// `prepare()` builds it while the preloader is up — it starts suspended, as
// autoplay rules require — and `unlock()`, on the first press, only resumes it.

import { game } from '../game/game.js'

let ctx = null
let out = null
let noise = null

function audio() {
  if (!ctx) {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
    if (!AC) return null
    ctx = new AC()
    // a gentle bus compressor: a triple slice sums without clipping
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 14
    comp.ratio.value = 4
    comp.attack.value = 0.002
    comp.release.value = 0.18
    out = ctx.createGain()
    out.gain.value = 0.6
    out.connect(comp).connect(ctx.destination)
    // one second of white noise, shared by every burst
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return ctx
}

function live() {
  if (game.getSnapshot().muted || !ctx) return false
  if (ctx.state === 'suspended') ctx.resume()
  return ctx.state === 'running'
}

function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
}

function noiseBurst(t, { from, to, q = 1.2, peak, attack = 0.003, decay, type = 'bandpass' }) {
  const src = ctx.createBufferSource()
  src.buffer = noise
  const f = ctx.createBiquadFilter()
  f.type = type
  f.Q.value = q
  f.frequency.setValueAtTime(from, t)
  f.frequency.exponentialRampToValueAtTime(to, t + attack + decay)
  const g = ctx.createGain()
  env(g, t, peak, attack, decay)
  src.connect(f).connect(g).connect(out)
  src.start(t, Math.random() * 0.7, attack + decay + 0.02)
}

function tone(t, { freq, to = freq, type = 'sine', peak, attack = 0.005, decay, vibrato = 0, rate = 0 }) {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay)
  const g = ctx.createGain()
  env(g, t, peak, attack, decay)
  o.connect(g).connect(out)
  const end = t + attack + decay + 0.03
  if (vibrato) {
    const lfo = ctx.createOscillator()
    lfo.frequency.value = rate
    const lg = ctx.createGain()
    lg.gain.value = vibrato
    lfo.connect(lg).connect(o.frequency)
    lfo.start(t)
    lfo.stop(end)
  }
  o.start(t)
  o.stop(end)
}

let lastSlice = 0

export const sound = {
  prepare() {
    audio()
  },

  /** 'none' | 'suspended' | 'running' | 'closed' — for the review tools */
  get state() {
    return ctx ? ctx.state : 'none'
  },

  unlock() {
    const c = audio()
    if (c && c.state === 'suspended') c.resume()
  },

  /** The knife through air: once per fast stroke. k: 0 lazy … 1 fast. */
  swish(k) {
    if (!live()) return
    const t = ctx.currentTime
    noiseBurst(t, { from: 1800 + 1400 * k, to: 520, q: 0.9, peak: 0.05 + 0.08 * k, attack: 0.02, decay: 0.16 })
  },

  /** A slice. streak: bears in a row (pitch climbs); k: blade speed 0…1. */
  slice({ streak = 0, k = 0.5, whole = true } = {}) {
    if (!live()) return
    const t = ctx.currentTime
    // several cuts in the same instant: stagger them a hair, like real hits
    const at = Math.max(t, lastSlice + 0.028)
    lastSlice = at
    const pitch = Math.pow(2, Math.min(streak, 18) / 12)
    // the blade parting the candy: a bright, short hiss sweeping down
    noiseBurst(at, { from: 5200, to: 1100, q: 1.6, peak: 0.12 + 0.12 * k, attack: 0.002, decay: 0.07 })
    // the jelly: a round, wobbling blup, dropping in pitch
    const f0 = (whole ? 230 : 320) * pitch
    tone(at + 0.004, { freq: f0, to: f0 * 0.5, peak: whole ? 0.3 : 0.18, attack: 0.006, decay: 0.2, vibrato: f0 * 0.07, rate: 26 })
    // a little tick of the edge on top
    tone(at, { freq: 2600 * Math.sqrt(pitch), type: 'triangle', peak: 0.04, attack: 0.001, decay: 0.03 })
  },

  /** Multiplier tier reached: an arpeggio that grows with the tier (1…4). */
  tierUp(tier) {
    if (!live()) return
    const t = ctx.currentTime + 0.03
    const root = [0, 523.25, 587.33, 659.25, 783.99][tier] || 523.25
    const steps = [1, 1.25, 1.5, 2, 2.5].slice(0, Math.min(5, 2 + tier))
    steps.forEach((m, i) => {
      const at = t + i * 0.065
      tone(at, { freq: root * m, type: 'triangle', peak: 0.12, attack: 0.004, decay: 0.42 })
      tone(at, { freq: root * m * 2, peak: 0.035, attack: 0.004, decay: 0.3 })
    })
    if (tier >= 4) noiseBurst(t + 0.2, { from: 9000, to: 6000, q: 0.7, peak: 0.03, attack: 0.05, decay: 0.5, type: 'highpass' })
  },

  /** The streak broke: a soft falling note. */
  lost() {
    if (!live()) return
    const t = ctx.currentTime
    tone(t, { freq: 392, to: 185, peak: 0.13, attack: 0.01, decay: 0.34 })
    tone(t + 0.05, { freq: 196, to: 110, type: 'triangle', peak: 0.06, attack: 0.01, decay: 0.3 })
  },
}
