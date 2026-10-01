// One-off effects above the canvas: the points that float off each cut, the
// multiplier callout when a tier is reached, a quiet note when the streak
// breaks. Imperative on purpose: throwaway nodes animated with the Web
// Animations API (compositor-only transform/opacity), no React render per
// slice.

import { useEffect, useRef } from 'react'
import { game, TIERS, formatMult } from '../game/game.js'

const MAX_POPS = 14

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function points(root, e) {
  const pop = el('div', `fx-points${e.whole ? '' : ' is-piece'}`)
  if (e.tier > 0) pop.style.setProperty('--tier', TIERS[e.tier].color) // ×1 stays ink
  pop.append(el('b', null, `+${e.points}`))
  if (e.mult > 1) pop.append(el('small', null, formatMult(e.mult)))
  pop.style.left = `${clamp(e.x, 44, innerWidth - 44)}px`
  pop.style.top = `${clamp(e.y - 26, 70, innerHeight - 50)}px`
  root.append(pop)
  const pops = root.getElementsByClassName('fx-points')
  while (pops.length > MAX_POPS) pops[0].remove()

  const drift = (Math.random() - 0.5) * 36
  pop.animate(
    [
      { transform: 'translate(-50%, -50%) translate(0, 8px) scale(0.45)', opacity: 0 },
      { transform: 'translate(-50%, -50%) translate(0, -8px) scale(1.16, 0.9)', opacity: 1, offset: 0.14 },
      { transform: 'translate(-50%, -50%) translate(0, -14px) scale(0.95, 1.06)', opacity: 1, offset: 0.26 },
      { transform: 'translate(-50%, -50%) translate(0, -18px) scale(1)', opacity: 1, offset: 0.4 },
      { transform: `translate(-50%, -50%) translate(${drift}px, -64px) scale(0.94)`, opacity: 0 },
    ],
    { duration: 1000, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' }
  ).onfinish = () => pop.remove()
}

export const TIER_FLIGHT_MS = 1150 // when the callout lands in the HUD badge

// The multiplier pops up big mid-screen, holds a beat, then flies into the
// HUD badge and shrinks to its size — the badge pops as it lands.
function tierCallout(root, e) {
  for (const old of root.querySelectorAll('.fx-tier')) old.remove()
  const call = el('div', `fx-tier tier-${e.tier}`)
  call.style.setProperty('--tier', TIERS[e.tier].color)
  const big = el('b', null, formatMult(e.mult))
  const kicker = el('span', 'fx-tier-kicker', `${e.streak} in a row`)
  call.append(kicker, big)
  root.append(call)

  // aim the numeral's centre at the badge's, scaling about the callout's centre
  const C = call.getBoundingClientRect()
  const N = big.getBoundingClientRect()
  const badge = document.querySelector('.hud-mult-badge')?.getBoundingClientRect()
  const cx = C.left + C.width / 2, cy = C.top + C.height / 2
  const nx = N.left + N.width / 2, ny = N.top + N.height / 2
  const s = badge ? Math.max(0.12, (badge.height * 0.62) / N.height) : 0.3
  const dx = badge ? badge.left + badge.width / 2 - cx - s * (nx - cx) : 0
  const dy = badge ? badge.top + badge.height / 2 - cy - s * (ny - cy) : -60
  const total = TIER_FLIGHT_MS + 180
  const at = (ms) => ms / total
  call.animate(
    [
      { transform: 'translate(-50%, -50%) translate(0, 14px) scale(1)', opacity: 0 },
      { transform: 'translate(-50%, -50%) translate(0, 0) scale(1)', opacity: 1, offset: at(130) },
      { transform: 'translate(-50%, -50%) translate(0, -6px) scale(1)', opacity: 1, offset: at(700), easing: 'cubic-bezier(0.6, 0, 0.3, 1)' },
      { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${s})`, opacity: 1, offset: at(TIER_FLIGHT_MS) },
      { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0 },
    ],
    { duration: total, fill: 'forwards' }
  ).onfinish = () => call.remove()
  kicker.animate([{ opacity: 1 }, { opacity: 1, offset: at(650) }, { opacity: 0, offset: at(820) }, { opacity: 0 }], { duration: total, fill: 'forwards' })
  // the numeral lands like a gummy
  big.animate(
    [
      { transform: 'scale(0.3, 0.3)' },
      { transform: 'scale(1.26, 0.78)', offset: 0.22 },
      { transform: 'scale(0.9, 1.12)', offset: 0.42 },
      { transform: 'scale(1.05, 0.96)', offset: 0.62 },
      { transform: 'scale(0.99, 1.01)', offset: 0.8 },
      { transform: 'scale(1, 1)' },
    ],
    { duration: 720, easing: 'ease-out' }
  )
}

// 3 · 2 · 1 · Slice!, and Time!: one big word at a time, landing like a gummy
function bigWord(root, text, cls, hold) {
  for (const old of root.querySelectorAll('.fx-word')) old.remove()
  const word = el('div', `fx-word ${cls}`)
  const b = el('b', null, text)
  word.append(b)
  root.append(word)
  const total = hold + 260
  word.animate(
    [
      { opacity: 0, transform: 'translate(-50%, -50%) translateY(18px)' },
      { opacity: 1, transform: 'translate(-50%, -50%) translateY(0)', offset: 120 / total },
      { opacity: 1, transform: 'translate(-50%, -50%) translateY(-4px)', offset: hold / total },
      { opacity: 0, transform: 'translate(-50%, -50%) translateY(-26px)' },
    ],
    { duration: total, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'forwards' }
  ).onfinish = () => word.remove()
  b.animate(
    [
      { transform: 'scale(0.35, 0.35)' },
      { transform: 'scale(1.24, 0.8)', offset: 0.24 },
      { transform: 'scale(0.9, 1.1)', offset: 0.44 },
      { transform: 'scale(1.04, 0.97)', offset: 0.64 },
      { transform: 'scale(1, 1)' },
    ],
    { duration: Math.min(620, hold), easing: 'ease-out' }
  )
}

function lost(root, e) {
  const note = el('div', 'fx-lost', `streak lost · ${formatMult(TIERS[e.was.tier].mult)}`)
  note.style.left = `${clamp(e.x, 90, innerWidth - 90)}px`
  root.append(note)
  note.animate(
    [
      { transform: 'translate(-50%, 0) translateY(10px)', opacity: 0 },
      { transform: 'translate(-50%, 0) translateY(0)', opacity: 1, offset: 0.15 },
      { transform: 'translate(-50%, 0) translateY(0)', opacity: 1, offset: 0.7 },
      { transform: 'translate(-50%, 0) translateY(-10px)', opacity: 0 },
    ],
    { duration: 1500, easing: 'ease-out', fill: 'forwards' }
  ).onfinish = () => note.remove()
}

export default function FxLayer() {
  const ref = useRef()

  useEffect(() => {
    const root = ref.current
    return game.onEvent((e) => {
      if (e.type === 'cut') points(root, e)
      else if (e.type === 'tier') tierCallout(root, e)
      else if (e.type === 'lost') lost(root, e)
      else if (e.type === 'count') bigWord(root, String(e.n), 'is-count', 760)
      else if (e.type === 'go') bigWord(root, 'Slice!', 'is-go', 640)
      else if (e.type === 'time') {
        for (const n of root.querySelectorAll('.fx-tier, .fx-points')) n.remove()
        bigWord(root, 'Time!', 'is-time', 1050)
      }
    })
  }, [])

  return <div ref={ref} className="fx-layer" aria-hidden="true" />
}
