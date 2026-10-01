// Screen-space jelly: after the scene is drawn, the finished frame is copied
// into a texture and drawn back through one refraction pass —
//   slice: the picture splits along the swipe, the two sides sliding apart
//          along the cut, then snaps back with an elastic overshoot;
//   ring:  a gelatinous shockwave from the cut, a lens that bulges outward;
//   urgency: the last seconds of the round darken the edges with each tick.
// The displacement splits the colour channels a hair, so wavefronts fringe.
// Copying the drawn frame (not re-rendering into a target) keeps the image
// bit-exact: tone mapping, the unlit paper, MSAA. Idle frames cost nothing.

import * as THREE from 'three'

const MAX = 8

export class ScreenFx {
  constructor() {
    this.items = []
    this.urgency = 0
    this.tex = null
    this.size = new THREE.Vector2()
    const A = Array.from({ length: MAX }, () => new THREE.Vector4())
    const B = Array.from({ length: MAX }, () => new THREE.Vector4())
    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uScene: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uDpr: { value: 1 },
        uA: { value: A }, // x, y (buffer px, GL origin), age (s), strength (css px)
        uB: { value: B }, // dir x, dir y, radius (css px), kind (0 slice, 1 ring)
        uCount: { value: 0 },
        uUrgency: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = position.xy * 0.5 + 0.5;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uScene;
        uniform vec2 uRes;
        uniform float uDpr;
        uniform vec4 uA[${MAX}];
        uniform vec4 uB[${MAX}];
        uniform int uCount;
        uniform float uUrgency;
        varying vec2 vUv;

        void main() {
          vec2 p = vUv * uRes;
          vec2 off = vec2(0.0);
          float fringe = 0.0;
          float seam = 0.0;
          float shade = 0.0; // a ripple on flat paper bends nothing: it shows by catching light
          float flash = 0.0;
          for (int i = 0; i < ${MAX}; i++) {
            if (i >= uCount) break;
            vec4 a = uA[i];
            vec4 b = uB[i];
            vec2 d = p - a.xy;
            float t = a.z;
            float R = b.z * uDpr;
            if (b.w < 0.5) {
              // the frame splits along the swipe and jelly-snaps back
              vec2 dir = b.xy;
              vec2 nrm = vec2(-dir.y, dir.x);
              float along = dot(d, dir);
              float across = dot(d, nrm);
              float env = exp(-(along * along) / (R * R * 2.4)) * exp(-(across * across) / (R * R * 0.55));
              float side = across / (abs(across) + 1.5 * uDpr);
              float snap = exp(-t / 0.1) * cos(t * 48.0); // ~7.6 Hz, gone in ~0.3 s
              float amt = a.w * uDpr * env * snap;
              off += dir * side * amt;
              fringe += abs(amt) * 0.16;
              seam += exp(-abs(across) / (1.6 * uDpr)) * env * exp(-t / 0.05);
              // the instant of impact: a soft bloom where the blade went through
              flash += exp(-dot(d, d) / (R * R * 0.35)) * exp(-t / 0.045) * min(a.w / 10.0, 1.4);
            } else {
              // a gelatinous shockwave: a ring that travels out and rings down
              float r = length(d);
              float x = r - t * 980.0 * uDpr;
              float w = 34.0 * uDpr;
              float wave = exp(-(x * x) / (w * w)) * sin(x / w * 2.4);
              float amp = a.w * uDpr * exp(-t / 0.3) * smoothstep(0.0, 50.0 * uDpr, r) * exp(-r / max(R, 1.0));
              off += (r > 0.001 ? d / r : vec2(0.0)) * wave * amp;
              fringe += abs(wave * amp) * 0.2;
              shade += wave * amp / uDpr; // the crest lit, the trough shaded
            }
          }
          vec2 uv = (p - off) / uRes;
          vec2 ca = off / uRes * min(fringe, 2.5) * 0.35;
          vec3 col;
          col.r = texture2D(uScene, uv + ca).r;
          col.g = texture2D(uScene, uv).g;
          col.b = texture2D(uScene, uv - ca).b;
          col += vec3(1.0, 0.97, 0.9) * min(seam, 1.0) * 0.32; // the cut catches the light
          col *= 1.0 + clamp(shade * 0.011, -0.16, 0.16);
          col += vec3(1.0, 0.96, 0.88) * min(flash, 1.0) * 0.2;
          // the last seconds: the edges dim with every tick
          vec2 q = vUv - 0.5;
          float vig = smoothstep(0.32, 0.78, length(q * vec2(1.0, 0.8)));
          col *= 1.0 - uUrgency * vig * 0.32;
          col = mix(col, col * vec3(1.06, 0.88, 0.86), uUrgency * vig * 0.6);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
    const geo = new THREE.BufferGeometry()
    // one triangle covering the screen
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    this.quad = new THREE.Mesh(geo, this.material)
    this.quad.frustumCulled = false
    this.quadScene = new THREE.Scene()
    this.quadScene.add(this.quad)
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  }

  /**
   * The frame splits along the cut. x, y: CSS px from the top-left; dx, dy:
   * the swipe's screen direction; radius: CSS px; strength: CSS px of slide.
   */
  slice(x, y, dx, dy, radius, strength) {
    const l = Math.hypot(dx, dy) || 1
    this.push({ x, y, dx: dx / l, dy: dy / l, radius, strength, kind: 0, life: 0.38 })
  }

  /** A jelly shockwave from (x, y) CSS px; radius = how far it carries. */
  ring(x, y, radius, strength) {
    this.push({ x, y, dx: 0, dy: 0, radius, strength, kind: 1, life: 0.9 })
  }

  push(item) {
    if (this.items.length >= MAX) this.items.shift()
    item.age = 0
    this.items.push(item)
  }

  /** Last seconds of the round: pulse the edges (decays on its own). */
  pulse(amount) {
    this.urgency = Math.max(this.urgency, amount)
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      it.age += dt
      if (it.age >= it.life) this.items.splice(i, 1)
    }
    this.urgency *= Math.exp(-dt * 2.2)
    if (this.urgency < 0.004) this.urgency = 0
  }

  get active() {
    return this.items.length > 0 || this.urgency > 0
  }

  /** Draws the scene, then — only while something is playing — the lens pass. */
  render(gl, scene, camera) {
    gl.setRenderTarget(null)
    gl.render(scene, camera)
    if (!this.active) return

    gl.getDrawingBufferSize(this.size)
    const w = this.size.x, h = this.size.y
    if (!this.tex || this.tex.image.width !== w || this.tex.image.height !== h) {
      this.tex?.dispose()
      this.tex = new THREE.FramebufferTexture(w, h)
      this.tex.minFilter = THREE.LinearFilter
      this.tex.magFilter = THREE.LinearFilter
    }
    gl.copyFramebufferToTexture(this.tex)

    const dpr = gl.getPixelRatio()
    const u = this.material.uniforms
    u.uScene.value = this.tex
    u.uRes.value.set(w, h)
    u.uDpr.value = dpr
    u.uCount.value = this.items.length
    u.uUrgency.value = this.urgency
    this.items.forEach((it, i) => {
      // CSS px from the top-left → buffer px with GL's bottom-left origin
      u.uA.value[i].set(it.x * dpr, h - it.y * dpr, it.age, it.strength)
      u.uB.value[i].set(it.dx, -it.dy, it.radius, it.kind)
    })
    const auto = gl.autoClear
    gl.autoClear = false
    gl.render(this.quadScene, this.quadCam)
    gl.autoClear = auto
  }

  dispose() {
    this.tex?.dispose()
    this.quad.geometry.dispose()
    this.material.dispose()
  }
}
