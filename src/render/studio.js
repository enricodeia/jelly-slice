// The set: a seamless paper backdrop behind the falling bears — no table, so
// nothing lands and piles up. Unlit and art-directed on purpose: a soft pool
// of light from one big softbox, falling off to the edges, the paper staying
// exactly the paper colour. It is the opaque backdrop the transmission pass
// refracts through the candy.

import * as THREE from 'three'

export function createBackdrop({ z = -6, width = 70, height = 44 } = {}) {
  const geometry = new THREE.PlaneGeometry(width, height)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPaper: { value: new THREE.Color('#ece6db') },
      uShade: { value: new THREE.Color('#cbc3b3') },
      uPool: { value: new THREE.Vector3(0.0, 0.6, 0.028) }, // x, y of the light pool, falloff
      // the streak warms the light pool towards the multiplier tier's colour
      uHeat: { value: 0 },
      uHeatColor: { value: new THREE.Color('#ffffff') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uPaper;
      uniform vec3 uShade;
      uniform vec3 uPool;
      uniform float uHeat;
      uniform vec3 uHeatColor;
      varying vec3 vWorld;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

      void main() {
        vec2 d = vWorld.xy - uPool.xy;
        d.x *= 0.62; // a wide softbox: the pool is broader than tall
        float pool = exp(-dot(d, d) * uPool.z);
        vec3 col = mix(uShade, uPaper, pool);
        col = mix(col, col * uHeatColor, uHeat * (0.35 + 0.65 * pool));
        col *= 1.0 + (hash(floor(gl_FragCoord.xy)) - 0.5) * 0.012; // paper tooth
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    toneMapped: false,
    depthWrite: true,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.z = z
  return mesh
}
