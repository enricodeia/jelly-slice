import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { useControls, folder } from 'leva'
import * as THREE from 'three'

import { getBearModel } from '../geometry/bearModel.js'
import { SoftBody, JellyWorld } from '../sim/world.js'
import { cutBody } from '../sim/cutBody.js'
import {
  COLORWAYS,
  createBodyGeometry,
  createBodyMaterials,
  createLookUniforms,
  createSharedUniforms,
} from '../render/jellyMaterials.js'
import { ThicknessPass } from '../render/passes.js'
import { createBackdrop } from '../render/studio.js'
import { Crumbs } from '../fx/Crumbs.js'
import { Glints } from '../fx/Glints.js'
import { sound } from '../fx/sound.js'
import { game, TIERS } from '../game/game.js'
import { useSwipeTrail } from './useSwipeTrail.js'
import BladeTrail from './BladeTrail.jsx'

const LOOK_AT = new THREE.Vector3(0, 0.2, 0)
const SPAWN_Y = 5.8 // just above the frame
const CULL_Y = -5.5 // a body whose top is below this has left the frame: gone
const COLORWAY_NAMES = Object.keys(COLORWAYS)
const CUT_BUDGET_MS = 8
const MIN_PIECE_VOLUME = 0.01 // ~0.9% of a bear
const MIN_PIECE_THICKNESS = 0.035 // volume/area: no slab thinner than ~0.07 (sheets, shards)
const FAST = 18 // blade speed (world units/s) at which a slice feels "fast" (cutBody's scale)
const SLOW_MO = 0.12 // time scale during a hit-stop
const HEAT = [0, 0.05, 0.08, 0.11, 0.15] // how much each tier warms the paper
const HEAT_COLORS = TIERS.map((t) => new THREE.Color('#ffffff').lerp(new THREE.Color(t.color), 0.4))
// ?nospawn: no automatic drops — for staged reviews driven by tools/*.mjs
const NO_SPAWN = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nospawn')

// scratch
const _v = new THREE.Vector3()
const _d0 = new THREE.Vector3()
const _d1 = new THREE.Vector3()
const _n = new THREE.Vector3()
const _w0 = new THREE.Vector3()
const _w1 = new THREE.Vector3()
const _plane = new THREE.Plane()
const _ray = new THREE.Ray()
const _dir = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _size = new THREE.Vector2()

function rayDir(camera, ndc, out) {
  out.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize()
  return out
}

// distance from point to segment, in aspect-corrected NDC
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  const ex = ax + dx * t - px, ey = ay + dy * t - py
  return Math.sqrt(ex * ex + ey * ey)
}

// the pointer's speed at trail[i], in aspect-corrected NDC per second, over
// ~45 ms so that coalesced pointer events don't make it jitter
function strokeSpeed(trail, i, aspect) {
  const b = trail[i]
  let j = i - 1
  while (j > 0 && b.t - trail[j].t < 45) j--
  const a = trail[j]
  const dt = (b.t - a.t) / 1000
  return dt > 1e-4 ? Math.hypot((b.x - a.x) * aspect, b.y - a.y) / dt : 0
}

function meanVelocity(b) {
  let x = 0, y = 0, z = 0
  for (let a = 0; a < b.n; a++) { x += b.v[3 * a]; y += b.v[3 * a + 1]; z += b.v[3 * a + 2] }
  return [x / b.n, y / b.n, z / b.n]
}

export default function Experience({ onReady, playing, levaStore }) {
  const { gl, camera, scene } = useThree()
  const groupRef = useRef()
  const { trailRef, strokeIdRef } = useSwipeTrail()
  const state = useRef({ spawnTimer: 0.15, lastSwipeT: 0, swishStroke: -1, hitstop: 0, timeScale: 1, shake: 0 })
  const playingRef = useRef(playing)
  playingRef.current = playing

  const c = useControls(
    'Jelly Slice',
    {
      Drop: folder({
        interval: { value: 0.75, min: 0.25, max: 3, step: 0.05, label: 'every (s)' },
        maxPieces: { value: 36, min: 8, max: 64, step: 1, label: 'max pieces' },
      }),
      Jelly: folder({
        firmness: { value: 0.4, min: 0, max: 1, step: 0.01 },
        wobble: { value: 0.18, min: 0.02, max: 0.6, step: 0.01, label: 'wobble damping' },
        jiggle: { value: 1, min: 0, max: 3, step: 0.05, label: 'fall jiggle' },
        gravity: { value: 7, min: 2, max: 20, step: 0.1 },
      }),
      Candy: folder({
        cloudiness: { value: 0.3, min: 0, max: 1, step: 0.01 },
        glow: { value: 0.35, min: 0, max: 3, step: 0.05, label: 'back glow' },
        depth: { value: 1, min: 0.3, max: 2.5, step: 0.05, label: 'colour depth' },
        relief: { value: 1, min: 0, max: 2, step: 0.05, label: 'moulding' },
      }),
      // the knife's action on the pieces, all scaled by the blade's real speed
      Knife: folder({
        impulse: { value: 1, min: 0, max: 3, step: 0.05, label: 'wedge' },
        drag: { value: 1, min: 0, max: 3, step: 0.05, label: 'shear' },
        carry: { value: 1, min: 0, max: 3, step: 0.05, label: 'carry' },
      }),
      Juice: folder({
        crumbs: { value: 1, min: 0, max: 2.5, step: 0.05 },
        glint: { value: true },
        hitstop: { value: true, label: 'hit-stop' },
        shake: { value: 1, min: 0, max: 3, step: 0.05 },
        heat: { value: true, label: 'paper heat' },
      }),
      Streak: folder(
        {
          at15: { value: TIERS[1].at, min: 1, max: 40, step: 1, label: '×1.5 at' },
          at2: { value: TIERS[2].at, min: 2, max: 60, step: 1, label: '×2 at' },
          at4: { value: TIERS[3].at, min: 3, max: 80, step: 1, label: '×4 at' },
          at8: { value: TIERS[4].at, min: 4, max: 99, step: 1, label: '×8 at' },
        },
        { collapsed: true }
      ),
    },
    { store: levaStore }
  )

  useEffect(() => {
    // strictly increasing, whatever the sliders say
    const at = [c.at15, c.at2, c.at4, c.at8]
    for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i], at[i - 1] + 1)
    game.setThresholds(at)
  }, [c.at15, c.at2, c.at4, c.at8])

  const ctx = useMemo(() => {
    const model = getBearModel()
    const world = new JellyWorld()
    // no table: bears and pieces fall through the frame and are dropped below it
    world.params.floorY = -Infinity
    world.params.walls = null

    const tex = new THREE.DataTexture(world.texData, world.texWidth, world.texHeight, THREE.RGBAFormat, THREE.FloatType)
    tex.minFilter = THREE.NearestFilter
    tex.magFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true

    const shared = createSharedUniforms()
    shared.uParticles.value = tex
    shared.uTexWidth.value = world.texWidth
    shared.uCellInv.value = 1 / model.grid.s

    // the moulded detail map: (∂h/∂x, ∂h/∂y, h) in half floats
    const r = model.relief
    const half = new Uint16Array(r.data.length)
    for (let i = 0; i < r.data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(r.data[i])
    const reliefTex = new THREE.DataTexture(half, r.width, r.height, THREE.RGBAFormat, THREE.HalfFloatType)
    reliefTex.minFilter = THREE.LinearFilter
    reliefTex.magFilter = THREE.LinearFilter
    reliefTex.needsUpdate = true
    shared.uRelief.value = reliefTex
    shared.uReliefMin.value.set(r.min[0], r.min[1])
    shared.uReliefSize.value.set(r.size[0], r.size[1])

    const thickness = new ThicknessPass()
    shared.uBackDepth.value = thickness.target.texture

    return {
      model,
      world,
      tex,
      reliefTex,
      shared,
      look: createLookUniforms(),
      thickness,
      backdrop: createBackdrop(),
      bearGeometry: createBodyGeometry(model.render, model.lattice),
      crumbs: new Crumbs(),
      glints: new Glints(),
      camBase: new THREE.Vector3(),
      meshes: [],
      queue: [],
      queued: new Set(),
      colorBag: [],
      stats: { step: 0 },
      overrides: {}, // tools/*.mjs: e.g. { gravity: 0 } without the panel overwriting it
    }
  }, [])

  useEffect(() => {
    camera.lookAt(LOOK_AT)
    camera.updateProjectionMatrix()
    ctx.camBase.copy(camera.position)
    return () => {
      // the shake moves the camera: leave it where it was found
      camera.position.copy(ctx.camBase)
      camera.lookAt(LOOK_AT)
    }
  }, [camera, ctx])

  // Warm-up while the preloader is up: compile the candy's programs (and the
  // back-face one, only drawn by our pass) on a throwaway mesh, so the first
  // real bear never hitches. Its materials stay alive — disposing them would
  // release the shared programs and throw the warm-up away. The crumbs and
  // glints are in the scene already, so they compile here too. The mesh is
  // collapsed to a point (no pixels) but stays drawn for two frames: three
  // allocates its full-res transmission target the first time a transmissive
  // object renders, and that should happen under the preloader, not on the
  // first bear (a 150 ms hitch).
  useEffect(() => {
    let cancelled = false
    const mats = createBodyMaterials(ctx.shared, 'orange', ctx.look)
    mats.uniforms.uShrink.value = 0
    const warm = new THREE.Mesh(ctx.bearGeometry, mats.main)
    warm.frustumCulled = false
    warm.userData.materials = mats
    const group = groupRef.current
    group.add(warm)
    const compile = gl.compileAsync ? gl.compileAsync(scene, camera) : Promise.resolve(gl.compile(scene, camera))
    compile.then(() => {
      if (cancelled) return
      ctx.thickness.render(gl, group, camera, [warm])
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled) return
          warm.visible = false
          onReady?.()
        })
      )
    })
    return () => {
      cancelled = true
      group.remove(warm)
      mats.main.dispose()
      mats.back.dispose()
    }
  }, [ctx, gl, scene, camera])

  // audio: built now, under the preloader (it blocks); it may only start
  // inside a gesture, so the first press on the canvas resumes it
  useEffect(() => {
    sound.prepare()
    const el = gl.domElement
    el.addEventListener('pointerdown', sound.unlock)
    return () => el.removeEventListener('pointerdown', sound.unlock)
  }, [gl])

  // handle for tools/*.mjs (puppeteer): world, passes, renderer, staged spawns
  useEffect(() => {
    window.__jelly = {
      ctx,
      gl,
      camera,
      game,
      sound,
      state: state.current,
      spawn: (opts) => !!spawnBear(opts),
      get playing() {
        return playingRef.current
      },
    }
    return () => {
      if (window.__jelly?.ctx === ctx) delete window.__jelly
    }
  }, [ctx, gl, camera])

  useEffect(() => {
    return () => {
      for (const m of ctx.meshes) {
        const mats = m.userData.materials
        mats.main.dispose(); mats.back.dispose()
        if (m.userData.ownsGeometry) m.geometry.dispose()
      }
      ctx.bearGeometry.dispose()
      ctx.tex.dispose()
      ctx.reliefTex.dispose()
      ctx.thickness.dispose()
      ctx.backdrop.geometry.dispose()
      ctx.backdrop.material.dispose()
      ctx.crumbs.dispose()
      ctx.glints.dispose()
    }
  }, [ctx])

  function nextColorway() {
    if (!ctx.colorBag.length) ctx.colorBag = COLORWAY_NAMES.slice().sort(() => Math.random() - 0.5)
    return ctx.colorBag.pop()
  }

  // half the width bears may drop across: inside the frame, on any aspect
  function spawnHalfWidth() {
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360)
    const halfW = ctx.camBase.z * tanHalf * camera.aspect
    return Math.max(0.3, Math.min(3.5, halfW - 1))
  }

  function addMesh(body, geometry, colorway, ownsGeometry) {
    const mats = createBodyMaterials(ctx.shared, colorway, ctx.look)
    mats.uniforms.uOffset.value = body.offset
    const mesh = new THREE.Mesh(geometry, mats.main)
    mesh.frustumCulled = false
    mesh.userData.materials = mats
    mesh.userData.ownsGeometry = ownsGeometry
    body.data.mesh = mesh
    body.data.colorway = colorway
    groupRef.current.add(mesh)
    ctx.meshes.push(mesh)
  }

  function removeBody(body) {
    const mesh = body.data.mesh
    if (mesh) {
      groupRef.current.remove(mesh)
      ctx.meshes.splice(ctx.meshes.indexOf(mesh), 1)
      const mats = mesh.userData.materials
      mats.main.dispose(); mats.back.dispose()
      if (mesh.userData.ownsGeometry) mesh.geometry.dispose()
    }
    ctx.world.remove(body)
  }

  // opts (all optional): { x, y, z, q: [x, y, z, w], v: [x, y, z], w: [x, y, z], colorway, still }
  function spawnBear(opts = {}) {
    const { model, world } = ctx
    const body = new SoftBody({
      lattice: model.lattice,
      proxyPoints: model.proxyPoints,
      proxyEmbed: model.proxyEmbed,
      proxyRadius: model.proxyRadius,
      data: { soup: model.soup, render: model.render, volume: model.volume, whole: true },
    })
    if (opts.q) _q.set(...opts.q).normalize()
    else _q.random()
    const spin = () => (Math.random() - 0.5) * 2.4
    const v = opts.v || [(Math.random() - 0.5) * 0.8, -0.6, 0]
    const w = opts.w || [spin(), spin(), spin()]
    body.setRigid(
      _q.x, _q.y, _q.z, _q.w,
      opts.x ?? (Math.random() * 2 - 1) * spawnHalfWidth(), opts.y ?? SPAWN_Y, opts.z ?? (Math.random() - 0.5) * 1.8,
      v[0], v[1], v[2],
      w[0], w[1], w[2],
      ...model.centroid
    )
    // no landing to set them wobbling: start each bear with a stretch along a
    // random axis, so it jiggles all the way down
    if (!opts.still && c.jiggle > 0) {
      const cen = body.centroid()
      _v.randomDirection()
      const k = 1.1 * c.jiggle
      for (let a = 0; a < body.n; a++) {
        const r = (body.x[3 * a] - cen[0]) * _v.x + (body.x[3 * a + 1] - cen[1]) * _v.y + (body.x[3 * a + 2] - cen[2]) * _v.z
        body.v[3 * a] += k * r * _v.x
        body.v[3 * a + 1] += k * r * _v.y
        body.v[3 * a + 2] += k * r * _v.z
      }
    }
    if (!world.add(body)) return null
    body.data.born = world.time
    addMesh(body, ctx.bearGeometry, opts.colorway || nextColorway(), false)
    return body
  }

  // One stroke segment p0 → p1 (NDC), drawn at `ndcSpeed`: queue a cut for
  // every body whose silhouette it crosses.
  function queueHits(p0, p1, ndcSpeed) {
    const aspect = camera.aspect
    const ax = p0.x * aspect, ay = p0.y, bx = p1.x * aspect, by = p1.y
    if (Math.hypot(bx - ax, by - ay) < 0.004) return
    // the cut plane holds the eye and the stroke: on screen it *is* the swipe
    rayDir(camera, p0, _d0)
    rayDir(camera, p1, _d1)
    _n.crossVectors(_d0, _d1)
    if (_n.lengthSq() < 1e-12) return
    _n.normalize()
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360)
    const stroke = strokeIdRef.current

    for (const body of ctx.world.bodies) {
      if (ctx.queued.has(body) || body.data.dying) continue
      // pieces born from this same stroke a moment ago would just be slivered
      if (body.data.stroke === stroke && ctx.world.time - body.data.born < 0.25) continue
      const bb = body.aabb
      _v.set((bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2)
      const radius = 0.5 * Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2])
      const dist = _v.distanceTo(camera.position)
      _v.project(camera)
      const r2d = radius / (dist * tanHalf)
      if (segDist(_v.x * aspect, _v.y, ax, ay, bx, by) > r2d + 0.02) continue

      const P = body.proxyPos
      const hitR = (body.proxyRadius * 1.2) / (dist * tanHalf)
      let hit = false
      for (let p = 0; p < body.proxyCount && !hit; p++) {
        _v.set(P[3 * p], P[3 * p + 1], P[3 * p + 2]).project(camera)
        if (segDist(_v.x * aspect, _v.y, ax, ay, bx, by) < hitR) hit = true
      }
      if (!hit) continue

      // the blade's direction of travel at the body's depth
      _v.set((bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2)
      camera.getWorldDirection(_dir)
      _plane.setFromNormalAndCoplanarPoint(_dir, _v)
      _ray.set(camera.position, _d0).intersectPlane(_plane, _w0)
      _ray.set(camera.position, _d1).intersectPlane(_plane, _w1)
      const blade = _w1.sub(_w0).normalize()

      ctx.stats.hits = (ctx.stats.hits || 0) + 1
      ctx.queue.push({
        body,
        p: [camera.position.x, camera.position.y, camera.position.z],
        n: [_n.x, _n.y, _n.z],
        blade: [blade.x, blade.y, blade.z],
        speed: ndcSpeed * dist * tanHalf, // world units/s where the blade meets it
        stroke,
      })
      ctx.queued.add(body)
    }
  }

  function processCuts(out) {
    const t0 = performance.now()
    while (ctx.queue.length && performance.now() - t0 < CUT_BUDGET_MS) {
      const job = ctx.queue.shift()
      const parent = job.body
      ctx.queued.delete(parent)
      if (!ctx.world.bodies.includes(parent)) continue
      const cen = parent.centroid()
      const vel = meanVelocity(parent)
      const bb = parent.aabb
      const span = 0.5 * Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2])
      const kids = cutBody(ctx.model, parent, job.p, job.n, job.blade, {
        speed: job.speed,
        impulse: c.impulse,
        drag: c.drag,
        carry: c.carry,
        minVolume: MIN_PIECE_VOLUME,
        minThickness: MIN_PIECE_THICKNESS,
        now: ctx.world.time,
      })
      if (!kids) {
        ctx.stats.rejected = (ctx.stats.rejected || 0) + 1
        continue
      }
      const colorway = parent.data.colorway
      const whole = !!parent.data.whole
      ctx.stats.lastSpeed = job.speed
      removeBody(parent)
      for (const kid of kids) {
        if (!ctx.world.add(kid)) continue
        kid.data.whole = false // the data object is the parent's, copied
        kid.data.born = ctx.world.time
        kid.data.stroke = job.stroke
        addMesh(kid, createBodyGeometry(kid.data.render, kid.lat), colorway, true)
      }
      out.push({ job, cen, vel, span, colorway, whole })
    }
    return out
  }

  // score it, and make it felt: points, sound, crumbs, glint, hit-stop, shake
  function landCut({ job, cen, vel, span, colorway, whole }, size) {
    const { n, p, blade } = job
    const d = (cen[0] - p[0]) * n[0] + (cen[1] - p[1]) * n[1] + (cen[2] - p[2]) * n[2]
    const anchor = [cen[0] - n[0] * d, cen[1] - n[1] * d, cen[2] - n[2] * d] // on the cut, mid-body
    const k = 1 - Math.exp(-job.speed / FAST)
    const res = game.cut({ whole })

    // the points rise from just above the body, not over the candy
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360)
    _v.set(anchor[0], anchor[1], anchor[2])
    const rPx = (span / (_v.distanceTo(camera.position) * tanHalf)) * (size.height / 2)
    _v.project(camera)
    const x = (_v.x * 0.5 + 0.5) * size.width
    const y = (-_v.y * 0.5 + 0.5) * size.height - Math.min(rPx * 0.75, 90)
    game.emit({ type: 'cut', x, y, points: res.points, mult: res.mult, tier: res.tier, whole })
    if (res.tierUp) game.emit({ type: 'tier', tier: res.tier, mult: res.mult, streak: res.streak })

    sound.slice({ streak: res.streak, k, whole })
    if (res.tierUp) sound.tierUp(res.tier)

    const count = Math.round(c.crumbs * (whole ? 8 + 8 * k + 2 * res.tier : 3 + 4 * k))
    if (count > 0) ctx.crumbs.burst({ anchor, n, blade, span, vel, k, colorway, count })
    if (c.glint) ctx.glints.add(anchor, blade, span * 2, whole ? 0.075 + 0.015 * res.tier : 0.05)

    const s = state.current
    if (c.hitstop) s.hitstop = Math.max(s.hitstop, res.tierUp ? 0.12 : whole ? 0.04 + 0.01 * res.tier : 0.02)
    s.shake = Math.max(s.shake, c.shake * (res.tierUp ? 0.06 : whole ? 0.016 + 0.007 * res.tier : 0.008))
  }

  // a whole bear gone below the frame uncut breaks the streak
  function checkEscapes(size) {
    for (const b of ctx.world.bodies) {
      if (!b.data.whole || b.data.escaped || b.data.dying) continue
      const bb = b.aabb
      _v.set((bb[0] + bb[3]) / 2, bb[4], (bb[2] + bb[5]) / 2).project(camera)
      if (_v.y > -1.02) continue
      b.data.escaped = true
      const was = game.miss()
      if (was.tier > 0) {
        game.emit({ type: 'lost', x: (_v.x * 0.5 + 0.5) * size.width, y: size.height, was })
        sound.lost()
      }
    }
  }

  function cull(now) {
    const bodies = ctx.world.bodies
    let alive = bodies.filter((b) => !b.data.dying).length
    // a safety valve only: with no table, pieces leave the frame on their own
    if (alive > c.maxPieces) {
      const candidates = bodies.filter((b) => !b.data.dying).sort((a, b) => a.data.born - b.data.born)
      for (const b of candidates) {
        if (alive <= c.maxPieces) break
        b.data.dying = now
        b.ghost = true
        const u = b.data.mesh.userData.materials.uniforms
        const cen = b.centroid()
        u.uShrinkCenter.value.set(cen[0], cen[1], cen[2])
        alive--
      }
    }
    for (const b of bodies.slice()) {
      if (b.data.dying) {
        const k = Math.min(1, (now - b.data.dying) / 0.45)
        b.data.mesh.userData.materials.uniforms.uShrink.value = 1 - k * k * (3 - 2 * k)
        if (k >= 1) removeBody(b)
      } else if (b.aabb[4] < CULL_Y) {
        removeBody(b)
      }
    }
  }

  useFrame(({ size }, delta) => {
    const realDt = Math.min(delta, 1 / 30)
    const { world } = ctx
    const s = state.current

    // hit-stop: a beat of slow motion as the knife goes through, then ease back
    if (s.hitstop > 0) {
      s.hitstop -= realDt
      s.timeScale = SLOW_MO
    } else s.timeScale = Math.min(1, s.timeScale + realDt * 6)
    const film = ctx.overrides.timeScale ?? 1 // tools: slow the whole show down to film it
    const dt = realDt * s.timeScale * film

    // panel → sim + look
    const prm = world.params
    // firmness 0.4 ≈ a gummy that wobbles ~4 Hz for half a second when struck
    // or cut (compliance 4e-4); 1 is the old near-rigid rubber (6e-6)
    prm.edgeCompliance = Math.pow(10, -2.2 - 3 * c.firmness)
    prm.damping = c.wobble
    prm.gravity = ctx.overrides.gravity ?? c.gravity
    ctx.look.uCloudiness.value = c.cloudiness
    ctx.look.uGlowStrength.value = c.glow
    ctx.look.uThicknessScale.value = c.depth
    ctx.look.uReliefStrength.value = c.relief

    if (playingRef.current && !NO_SPAWN) {
      s.spawnTimer -= dt
      if (s.spawnTimer <= 0) {
        // now and then a pair, far enough apart to slice both in one stroke
        const R = spawnHalfWidth()
        const x = (Math.random() * 2 - 1) * R
        spawnBear({ x })
        if (R > 1.6 && Math.random() < 0.35) {
          const gap = Math.min(2.4 + Math.random() * 1.6, 2 * R)
          const x2 = x > 0 ? x - gap : x + gap
          spawnBear({ x: Math.max(-R, Math.min(R, x2)), y: SPAWN_Y + 0.8 })
        }
        s.spawnTimer = c.interval * (0.75 + Math.random() * 0.5)
      }
    }

    // every segment the pointer drew since last frame, not only the newest
    const trail = trailRef.current
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360)
    for (let i = 1; i < trail.length; i++) {
      if (trail[i].t <= s.lastSwipeT) continue
      const sp = strokeSpeed(trail, i, camera.aspect)
      queueHits(trail[i - 1], trail[i], sp)
      const worldSpeed = sp * ctx.camBase.z * tanHalf
      if (worldSpeed > 14 && s.swishStroke !== strokeIdRef.current) {
        s.swishStroke = strokeIdRef.current
        sound.swish(1 - Math.exp(-worldSpeed / 30))
      }
    }
    if (trail.length) s.lastSwipeT = trail[trail.length - 1].t

    const landed = processCuts([])
    for (const r of landed) landCut(r, size)

    const t0 = performance.now()
    world.step(dt)
    // rolling average for tools/perf.mjs
    ctx.stats.step = ctx.stats.step * 0.95 + (performance.now() - t0) * 0.05
    if (playingRef.current) checkEscapes(size)
    cull(world.time)
    ctx.tex.needsUpdate = true

    // fresh sections: wet for a second, and a flash of light the instant they're cut
    for (const b of world.bodies) {
      if (b.data.whole) continue
      const u = b.data.mesh.userData.materials.uniforms
      const age = world.time - b.data.born
      u.uFresh.value = age < 2 ? Math.exp(-age / 0.6) : 0
      u.uFlash.value = age < 0.5 ? Math.exp(-age / 0.07) : 0
    }

    ctx.crumbs.update(dt, prm.gravity, camera)
    ctx.glints.update(realDt * film, camera)

    // the paper warms with the multiplier
    const tier = game.getSnapshot().tier
    const bd = ctx.backdrop.material.uniforms
    const kh = 1 - Math.exp(-realDt * 3)
    bd.uHeat.value += ((c.heat ? HEAT[tier] : 0) - bd.uHeat.value) * kh
    bd.uHeatColor.value.lerp(HEAT_COLORS[tier], kh)

    // camera shake: a quick decaying tremor, translation only
    s.shake *= Math.exp(-realDt * 20)
    const tt = performance.now() / 1000
    const sx = s.shake * (Math.sin(tt * 91.7) + 0.6 * Math.sin(tt * 57.3 + 1.7))
    const sy = s.shake * (Math.sin(tt * 77.1 + 0.9) + 0.6 * Math.sin(tt * 43.9 + 2.3))
    const B = ctx.camBase
    camera.position.set(B.x + sx, B.y + sy, B.z)
    camera.lookAt(LOOK_AT.x + sx * 0.6, LOOK_AT.y + sy * 0.6, LOOK_AT.z)

    gl.getDrawingBufferSize(_size)
    if (ctx.shared.uResolution.value.x !== _size.x || ctx.shared.uResolution.value.y !== _size.y) {
      ctx.shared.uResolution.value.copy(_size)
      ctx.thickness.setSize(_size.x, _size.y)
    }
    if (ctx.meshes.length) ctx.thickness.render(gl, groupRef.current, camera, ctx.meshes)
  })

  return (
    <>
      <color attach="background" args={['#cbc3b3']} />
      <primitive object={ctx.backdrop} />
      <ambientLight intensity={0.25} color="#fff4e6" />
      {/* key: the big softbox, above and in front */}
      <directionalLight position={[2.5, 7, 4]} intensity={2.1} color="#fff6ea" />
      {/* back light through the candy: drives the thin-edge glow */}
      <directionalLight position={[-1.5, 3.5, -6]} intensity={1.6} color="#fff0d8" />
      {/* cool fill from the left */}
      <directionalLight position={[-6, 2, 3]} intensity={0.45} color="#e6eeff" />
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#a9a193']} />
        <Lightformer form="rect" intensity={3.2} position={[0, 6, 1.5]} rotation-x={Math.PI / 2} scale={[9, 5, 1]} />
        <Lightformer form="rect" intensity={1.7} position={[-6.5, 2.5, 2]} rotation-y={Math.PI / 2} scale={[1.3, 7, 1]} />
        <Lightformer form="rect" intensity={1.7} position={[6.5, 2.5, 2]} rotation-y={-Math.PI / 2} scale={[1.3, 7, 1]} />
        <Lightformer form="ring" intensity={2.4} position={[3.5, 3, 7]} scale={1.1} />
        <Lightformer form="rect" intensity={0.8} position={[0, -1, 9]} scale={[12, 2, 1]} />
      </Environment>
      <group ref={groupRef} />
      <primitive object={ctx.crumbs.mesh} />
      <primitive object={ctx.glints.mesh} />
      <BladeTrail trailRef={trailRef} color="#211d16" />
    </>
  )
}
