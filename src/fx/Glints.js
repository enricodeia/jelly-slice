// The glint of the cut: a thin streak of light that zips along the cut line,
// across the body, then fades — the knife's edge catching the softbox.
// Camera-facing quads on one InstancedMesh, drawn over everything.

import * as THREE from 'three'

const MAX = 16
const LIFE = 0.26 // s

const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()

export class Glints {
  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1)
    this.lifeArr = new Float32Array(MAX)
    this.lifeAttr = new THREE.InstancedBufferAttribute(this.lifeArr, 1)
    geometry.setAttribute('aLife', this.lifeAttr)

    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#fffaf0') } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aLife;
        varying vec2 vUv;
        varying float vLife;
        void main() {
          vUv = uv;
          vLife = aLife;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vLife;
        void main() {
          float along = vUv.x;
          float across = abs(vUv.y - 0.5) * 2.0;
          // the head runs the length of the cut in the first third of its life
          float head = smoothstep(0.0, 0.32, vLife) * 1.15;
          float lit = 1.0 - smoothstep(head - 0.12, head, along);
          float taper = sin(along * 3.14159);
          float core = exp(-across * across * 9.0);
          float fade = 1.0 - smoothstep(0.3, 1.0, vLife);
          float a = lit * taper * core * fade;
          gl_FragColor = vec4(uColor, a * 0.95);
          #include <colorspace_fragment>
        }
      `,
    })

    this.mesh = new THREE.InstancedMesh(geometry, this.material, MAX)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 10
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.items = []
  }

  /** A glint centred at `center`, along `dir` (unit, ⟂ view), `length` long. */
  add(center, dir, length, width = 0.07) {
    if (this.items.length >= MAX) this.items.shift()
    this.items.push({ c: [center[0], center[1], center[2]], d: [dir[0], dir[1], dir[2]], length, width, age: 0 })
  }

  update(dt, camera) {
    const items = this.items
    for (let i = items.length - 1; i >= 0; i--) {
      items[i].age += dt
      if (items[i].age >= LIFE) items.splice(i, 1)
    }
    const M = this.mesh.instanceMatrix.array
    camera.getWorldDirection(_z).negate()
    for (let i = 0; i < items.length; i++) {
      const g = items[i]
      _x.set(g.d[0], g.d[1], g.d[2])
      _y.crossVectors(_z, _x).normalize()
      const t = g.age / LIFE
      const w = g.width * (1.4 - 0.8 * t) // born wide, thins as it fades
      const o = 16 * i
      M[o] = _x.x * g.length; M[o + 1] = _x.y * g.length; M[o + 2] = _x.z * g.length; M[o + 3] = 0
      M[o + 4] = _y.x * w; M[o + 5] = _y.y * w; M[o + 6] = _y.z * w; M[o + 7] = 0
      M[o + 8] = _z.x; M[o + 9] = _z.y; M[o + 10] = _z.z; M[o + 11] = 0
      M[o + 12] = g.c[0]; M[o + 13] = g.c[1]; M[o + 14] = g.c[2]; M[o + 15] = 1
      this.lifeArr[i] = t
    }
    this.mesh.count = items.length
    this.mesh.instanceMatrix.needsUpdate = true
    this.lifeAttr.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
