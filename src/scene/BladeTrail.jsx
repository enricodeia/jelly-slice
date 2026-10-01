// Visual feedback for the swipe: a tapering, fading ribbon built each frame
// from the last few pointer points, unprojected onto a plane facing the
// camera at a fixed play depth. Plain BufferGeometry updated in place —
// cheap, no extra ribbon/meshline dependency needed for a stroke this short.

import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { game, TIERS } from '../game/game.js'

const MAX_SEGMENTS = 9
const PLAY_Z = 0
const TRAIL_MS = 170

// the ink takes the multiplier tier's colour, and the stroke gets bolder
const TIER_COLORS = TIERS.map((t, i) => new THREE.Color(i === 0 ? '#211d16' : t.color))

export default function BladeTrail({ trailRef, color = '#fff6ea' }) {
  const meshRef = useRef()
  const { camera } = useThree()
  const weight = useRef(1)

  const { geometry, positions, alphas } = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const verts = new Float32Array(MAX_SEGMENTS * 2 * 3)
    const alpha = new Float32Array(MAX_SEGMENTS * 2)
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1))
    const indices = []
    for (let i = 0; i < MAX_SEGMENTS - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3
      indices.push(a, b, c, b, d, c)
    }
    geo.setIndex(indices)
    geo.setDrawRange(0, 0)
    return { geometry: geo, positions: verts, alphas: alpha }
  }, [])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color(color) } },
        vertexShader: /* glsl */ `
          attribute float aAlpha;
          varying float vAlpha;
          void main() {
            vAlpha = aAlpha;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying float vAlpha;
          void main() {
            gl_FragColor = vec4(uColor, vAlpha);
            #include <colorspace_fragment>
          }
        `,
      }),
    [color]
  )

  const _plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), -PLAY_Z), [])
  const _ray = useMemo(() => new THREE.Raycaster(), [])
  const _pt = useMemo(() => new THREE.Vector3(), [])
  const _right = useMemo(() => new THREE.Vector3(), [])
  const _dir = useMemo(() => new THREE.Vector3(), [])
  const _camDir = useMemo(() => new THREE.Vector3(), [])
  const _camRight = useMemo(() => new THREE.Vector3(), [])
  const _camUp = useMemo(() => new THREE.Vector3(), [])
  const _planeOrigin = useMemo(() => new THREE.Vector3(0, 0, PLAY_Z), [])

  useFrame((_, delta) => {
    const tier = game.getSnapshot().tier
    const k = 1 - Math.exp(-delta * 10)
    material.uniforms.uColor.value.lerp(TIER_COLORS[tier], k)
    weight.current += (1 + 0.22 * tier - weight.current) * k

    // only the last instant of the stroke: the ribbon follows the blade and
    // retracts behind it when it stops or lifts
    const trail = trailRef.current
    const now = performance.now()
    let fresh = trail.length
    while (fresh > 0 && now - trail[fresh - 1].t < TRAIL_MS) fresh--
    const n = Math.min(trail.length - fresh, MAX_SEGMENTS)
    if (n < 2) {
      geometry.setDrawRange(0, 0)
      return
    }

    camera.getWorldDirection(_camDir)
    _plane.normal.copy(_camDir).negate()
    _plane.constant = -_plane.normal.dot(_planeOrigin)
    _camRight.setFromMatrixColumn(camera.matrixWorld, 0)
    _camUp.setFromMatrixColumn(camera.matrixWorld, 1)

    const start = trail.length - n
    for (let i = 0; i < n; i++) {
      const p = trail[start + i]
      _ray.setFromCamera({ x: p.x, y: p.y }, camera)
      if (!_ray.ray.intersectPlane(_plane, _pt)) _pt.set(0, 0, PLAY_Z)

      if (i === 0) {
        const next = trail[start + 1]
        _dir.set(next.x - p.x, next.y - p.y, 0)
      } else {
        const prev = trail[start + i - 1]
        _dir.set(p.x - prev.x, p.y - prev.y, 0)
      }
      if (_dir.lengthSq() < 1e-8) _dir.set(1, 0, 0)
      _dir.normalize()
      // Perpendicular to the stroke in screen space, projected into world
      // space via the camera's own right/up basis vectors.
      _right.set(0, 0, 0).addScaledVector(_camRight, -_dir.y).addScaledVector(_camUp, _dir.x)

      const t = i / (n - 1)
      const width = 0.05 * t * weight.current
      const ai = i * 2
      positions[ai * 3 + 0] = _pt.x + _right.x * width
      positions[ai * 3 + 1] = _pt.y + _right.y * width
      positions[ai * 3 + 2] = _pt.z + _right.z * width
      positions[(ai + 1) * 3 + 0] = _pt.x - _right.x * width
      positions[(ai + 1) * 3 + 1] = _pt.y - _right.y * width
      positions[(ai + 1) * 3 + 2] = _pt.z - _right.z * width
      alphas[ai] = t * 0.85
      alphas[ai + 1] = t * 0.85
    }

    geometry.attributes.position.needsUpdate = true
    geometry.attributes.aAlpha.needsUpdate = true
    geometry.setDrawRange(0, (n - 1) * 6)
    geometry.computeBoundingSphere()
  })

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />
}
