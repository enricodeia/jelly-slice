// Tracks the active pointer stroke as NDC points with timestamps. Pure
// event bookkeeping — no three.js/frame logic here, so Experience.jsx can
// read `trailRef.current` (array) and `strokeIdRef.current` (bumped per
// new stroke, so a piece is never cut twice by the same still cursor)
// from inside its own useFrame without this hook re-rendering anything.

import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'

// enough history that a slow frame never drops segments before the hit test
// reads them (it tests every segment drawn since the last frame)
const MAX_POINTS = 32

export function useSwipeTrail() {
  const { gl } = useThree()
  const trailRef = useRef([])
  const activeRef = useRef(false)
  const strokeIdRef = useRef(0)

  useEffect(() => {
    const el = gl.domElement

    const toNDC = (clientX, clientY) => {
      const rect = el.getBoundingClientRect()
      return {
        x: ((clientX - rect.left) / rect.width) * 2 - 1,
        y: -((clientY - rect.top) / rect.height) * 2 + 1,
      }
    }

    const onDown = (e) => {
      activeRef.current = true
      strokeIdRef.current++
      trailRef.current = [{ ...toNDC(e.clientX, e.clientY), t: performance.now() }]
    }
    const onMove = (e) => {
      if (!activeRef.current) return
      const p = toNDC(e.clientX, e.clientY)
      const trail = trailRef.current
      trail.push({ ...p, t: performance.now() })
      if (trail.length > MAX_POINTS) trail.shift()
    }
    const onUp = () => {
      activeRef.current = false
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [gl])

  return { trailRef, activeRef, strokeIdRef }
}
