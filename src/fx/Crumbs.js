// Gummy crumbs: little beads of candy thrown off the cut. Ballistic particles
// on one InstancedMesh (a soft body each would be absurd at a few pixels),
// shaded like the candy they came from: the paper seen through a bead that is
// thickest at its centre, Beer–Lambert with the colourway's own tint and σ —
// deep core, pale rim — plus the key light's highlight. Each one stretches
// along its velocity and wobbles like a drop, then shrinks away.

import * as THREE from 'three'
import { COLORWAYS } from '../render/jellyMaterials.js'

const MAX = 320
const KEY_LIGHT = new THREE.Vector3(2.5, 7, 4).normalize() // the softbox in Experience.jsx

const _l = new THREE.Vector3()

export class Crumbs {
  constructor() {
    const geometry = new THREE.IcosahedronGeometry(1, 1)
    this.tint = new Float32Array(3 * MAX)
    this.sigma = new Float32Array(3 * MAX)
    this.tintAttr = new THREE.InstancedBufferAttribute(this.tint, 3)
    this.sigmaAttr = new THREE.InstancedBufferAttribute(this.sigma, 3)
    geometry.setAttribute('aTint', this.tintAttr)
    geometry.setAttribute('aSigma', this.sigmaAttr)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPaper: { value: new THREE.Color('#e4ddcf') },
        uLight: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aTint;
        attribute vec3 aSigma;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vTint;
        varying vec3 vSigma;
        void main() {
          mat3 m = mat3(instanceMatrix);
          // stretched beads: normals go through the inverse transpose
          vN = normalize(normalMatrix * (transpose(inverse(m)) * normal));
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vV = -mv.xyz;
          vTint = aTint;
          vSigma = aSigma;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uPaper;
        uniform vec3 uLight;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vTint;
        varying vec3 vSigma;
        void main() {
          vec3 N = normalize(vN);
          vec3 V = normalize(vV);
          float ndv = clamp(dot(N, V), 0.0, 1.0);
          // the light that crossed the bead: thickest at its centre
          vec3 col = uPaper * vTint * exp(-vSigma * (0.05 + 0.42 * ndv));
          col *= 0.8 + 0.3 * clamp(dot(N, uLight), 0.0, 1.0);
          vec3 H = normalize(uLight + V);
          col += pow(max(dot(N, H), 0.0), 90.0) * 1.4; // the softbox, mirrored
          col += pow(1.0 - ndv, 3.0) * 0.16 * uPaper; // a pale rim
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })

    this.mesh = new THREE.InstancedMesh(geometry, this.material, MAX)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    this.n = 0
    this.p = new Float32Array(3 * MAX)
    this.v = new Float32Array(3 * MAX)
    this.r = new Float32Array(MAX)
    this.age = new Float32Array(MAX)
    this.life = new Float32Array(MAX)
    this.phase = new Float32Array(MAX)
  }

  /**
   * A burst along the cut: `anchor` on the plane at the body's centre,
   * `n` the plane normal, `blade` the knife's direction, `span` the half
   * length of the cut across the body, `vel` the body's own velocity, `k`
   * the blade's speed (0 lazy … 1 fast), `count` beads.
   */
  burst({ anchor, n, blade, span, vel, k, colorway, count }) {
    const cw = COLORWAYS[colorway] || COLORWAYS.orange
    for (let c = 0; c < count; c++) {
      let i = this.n
      if (i >= MAX) {
        // full: recycle the oldest-looking one
        i = Math.floor(Math.random() * MAX)
      } else this.n++
      const u = (Math.random() * 2 - 1) * span * 0.85
      const side = Math.random() < 0.5 ? -1 : 1
      const sideSpeed = 0.5 + 1.6 * Math.random()
      const bladeSpeed = 0.4 + (1 + 3.2 * k) * Math.random()
      for (let d = 0; d < 3; d++) {
        this.p[3 * i + d] = anchor[d] + blade[d] * u + n[d] * side * 0.03
        this.v[3 * i + d] = vel[d] + blade[d] * bladeSpeed + n[d] * side * sideSpeed + (Math.random() - 0.5) * 0.9
      }
      this.v[3 * i + 1] += 0.6 + 1.2 * Math.random() // flicked up a little before they fall
      const s = Math.random()
      this.r[i] = 0.018 + 0.05 * s * s // mostly specks, now and then a real drop
      this.age[i] = 0
      this.life[i] = 0.7 + 0.7 * Math.random()
      this.phase[i] = Math.random() * 6.283
      this.tint[3 * i] = cw.tint[0]; this.tint[3 * i + 1] = cw.tint[1]; this.tint[3 * i + 2] = cw.tint[2]
      this.sigma[3 * i] = cw.sigma[0]; this.sigma[3 * i + 1] = cw.sigma[1]; this.sigma[3 * i + 2] = cw.sigma[2]
    }
    this.tintAttr.needsUpdate = true
    this.sigmaAttr.needsUpdate = true
  }

  update(dt, gravity, camera) {
    const { p, v, r, age, life, phase } = this
    const drag = Math.max(0, 1 - 0.6 * dt)
    let i = 0
    while (i < this.n) {
      age[i] += dt
      if (age[i] >= life[i]) {
        this.kill(i)
        continue
      }
      v[3 * i] *= drag
      v[3 * i + 1] = (v[3 * i + 1] - gravity * dt) * drag
      v[3 * i + 2] *= drag
      p[3 * i] += v[3 * i] * dt
      p[3 * i + 1] += v[3 * i + 1] * dt
      p[3 * i + 2] += v[3 * i + 2] * dt
      i++
    }

    const M = this.mesh.instanceMatrix.array
    for (let j = 0; j < this.n; j++) {
      const vx = v[3 * j], vy = v[3 * j + 1], vz = v[3 * j + 2]
      const sp = Math.hypot(vx, vy, vz)
      // e1 along the velocity, e2 ⟂ e1, e3 = e1 × e2
      let ax = 0, ay = 1, az = 0
      if (sp > 1e-4) { ax = vx / sp; ay = vy / sp; az = vz / sp }
      let bx = -ay, by = ax, bz = 0
      if (Math.abs(az) > 0.9) { bx = 0; by = -az; bz = ay }
      const bl = Math.hypot(bx, by, bz) || 1
      bx /= bl; by /= bl; bz /= bl
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx
      const t = age[j] / life[j]
      const shrink = t < 0.65 ? 1 : 1 - smooth((t - 0.65) / 0.35)
      const grow = Math.min(1, age[j] / 0.05) // pop out of the section, not from nothing
      const wob = 1 + 0.16 * Math.sin(age[j] * 36 + phase[j]) * Math.exp(-age[j] * 3.5)
      const st = (1 + Math.min(sp * 0.07, 0.8)) * wob // drops stretch with speed
      const rr = r[j] * shrink * grow
      const s1 = rr * st, s2 = rr / Math.sqrt(st)
      const o = 16 * j
      M[o] = ax * s1; M[o + 1] = ay * s1; M[o + 2] = az * s1; M[o + 3] = 0
      M[o + 4] = bx * s2; M[o + 5] = by * s2; M[o + 6] = bz * s2; M[o + 7] = 0
      M[o + 8] = cx * s2; M[o + 9] = cy * s2; M[o + 10] = cz * s2; M[o + 11] = 0
      M[o + 12] = p[3 * j]; M[o + 13] = p[3 * j + 1]; M[o + 14] = p[3 * j + 2]; M[o + 15] = 1
    }
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.n) this.tintAttr.needsUpdate = this.sigmaAttr.needsUpdate = true

    _l.copy(KEY_LIGHT).transformDirection(camera.matrixWorldInverse)
    this.material.uniforms.uLight.value.copy(_l)
  }

  // swap-remove: the last live bead takes slot i
  kill(i) {
    const last = --this.n
    if (i === last) return
    for (let d = 0; d < 3; d++) {
      this.p[3 * i + d] = this.p[3 * last + d]
      this.v[3 * i + d] = this.v[3 * last + d]
      this.tint[3 * i + d] = this.tint[3 * last + d]
      this.sigma[3 * i + d] = this.sigma[3 * last + d]
    }
    this.r[i] = this.r[last]
    this.age[i] = this.age[last]
    this.life[i] = this.life[last]
    this.phase[i] = this.phase[last]
  }

  clear() {
    this.n = 0
    this.mesh.count = 0
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}

function smooth(x) {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
