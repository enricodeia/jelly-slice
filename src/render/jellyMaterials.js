// Gummy materials. Every body is drawn twice per frame with the same vertex
// deformation: back faces → linear depth (for per-pixel thickness), then the
// visible candy itself.
//
// The deformation: each render vertex sits in a lattice cell with local
// (u, v, w); its position is the trilinear blend of that cell's 8 simulated
// nodes (read from one float texture shared by all bodies), and its normal is
// the rest normal pushed through the cofactor of the blend's Jacobian — the
// exact normal transform for the local deformation gradient.
//
// The visible candy is three's MeshPhysicalMaterial with transmission, so it
// refracts the studio behind it and absorbs with Beer–Lambert — but fed a
// *measured* thickness (back-face depth − front depth) instead of a constant,
// so thin ears and edges glow pale and the belly goes deep. On top: thicker
// = cloudier (more light scattered inside), and a back-lit glow through thin
// parts. One program for every body: only uniform values differ.

import * as THREE from 'three'

export const DEFORM_GLSL = /* glsl */ `
uniform highp sampler2D uParticles;
uniform float uTexWidth;
uniform float uOffset;
uniform float uCellInv;
uniform float uShrink;
uniform vec3 uShrinkCenter;
attribute vec4 aNodesA;
attribute vec4 aNodesB;
attribute vec3 aUVW;

vec3 jellyNode(float local) {
  float t = uOffset + local;
  float row = floor(t / uTexWidth);
  return texelFetch(uParticles, ivec2(int(t - row * uTexWidth), int(row)), 0).xyz;
}

void jellyDeform(out vec3 pos, inout vec3 nrm, out mat3 cof) {
  vec3 p000 = jellyNode(aNodesA.x), p100 = jellyNode(aNodesA.y);
  vec3 p010 = jellyNode(aNodesA.z), p110 = jellyNode(aNodesA.w);
  vec3 p001 = jellyNode(aNodesB.x), p101 = jellyNode(aNodesB.y);
  vec3 p011 = jellyNode(aNodesB.z), p111 = jellyNode(aNodesB.w);
  float u = aUVW.x, v = aUVW.y, w = aUVW.z;
  vec3 x00 = mix(p000, p100, u), x10 = mix(p010, p110, u);
  vec3 x01 = mix(p001, p101, u), x11 = mix(p011, p111, u);
  vec3 x0 = mix(x00, x10, v), x1 = mix(x01, x11, v);
  pos = mix(x0, x1, w);
  vec3 du = mix(mix(p100 - p000, p110 - p010, v), mix(p101 - p001, p111 - p011, v), w);
  vec3 dv = mix(x10 - x00, x11 - x01, w);
  vec3 dw = x1 - x0;
  mat3 F = mat3(du, dv, dw) * uCellInv;
  cof = mat3(cross(F[1], F[2]), cross(F[2], F[0]), cross(F[0], F[1]));
  nrm = normalize(cof * nrm);
  pos = uShrinkCenter + (pos - uShrinkCenter) * uShrink;
}
`

// Shared across bodies (same objects referenced by every material).
export function createSharedUniforms() {
  return {
    uParticles: { value: null },
    uTexWidth: { value: 1024 },
    uCellInv: { value: 1 },
    uBackDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uRelief: { value: null },
    uReliefMin: { value: new THREE.Vector2() },
    uReliefSize: { value: new THREE.Vector2(1, 1) },
  }
}

// Goldbear colourways, solved from the reference photo (tools/reference):
// its rim and core colours, divided by our paper backdrop, give the tint at
// zero thickness and the Beer–Lambert absorption σ per unit of thickness
// (thin edge ≈ 0.15, core ≈ 0.7). Linear RGB.
export const COLORWAYS = {
  // orange and strawberry fitted band-by-band (rim → core) against the photo
  orange: { tint: [0.7, 0.81, 0.48], sigma: [0.5, 3.49, 3.96], glow: '#ffb070', cloud: 1 },
  strawberry: { tint: [0.83, 0.45, 0.53], sigma: [0.63, 3.93, 4.03], glow: '#ff6a60', cloud: 1 },
  lemon: { tint: [0.78, 0.76, 0.46], sigma: [0.25, 1.5, 4.2], glow: '#ffe07a', cloud: 0.9 },
  apple: { tint: [0.56, 0.72, 0.36], sigma: [3.6, 0.75, 4.0], glow: '#aef06a', cloud: 1 },
  raspberry: { tint: [0.78, 0.4, 0.55], sigma: [0.95, 4.2, 3.1], glow: '#ff6a9a', cloud: 1 },
  // the clear one: frosted glass, not marzipan
  pineapple: { tint: [0.86, 0.84, 0.78], sigma: [0.16, 0.26, 0.62], glow: '#fff4d8', cloud: 0.55 },
}

export function createBodyMaterials(shared, colorway, look) {
  const cw = COLORWAYS[colorway]
  const sigma = new THREE.Vector3(...cw.sigma)
  const tint = new THREE.Color().setRGB(cw.tint[0], cw.tint[1], cw.tint[2], THREE.LinearSRGBColorSpace)
  // three's attenuation is "the colour after `distance`": at distance 1 that's e^−σ
  const absorbColor = new THREE.Color().setRGB(Math.exp(-cw.sigma[0]), Math.exp(-cw.sigma[1]), Math.exp(-cw.sigma[2]), THREE.LinearSRGBColorSpace)

  const uniforms = {
    ...shared,
    uOffset: { value: 0 },
    uShrink: { value: 1 },
    uShrinkCenter: { value: new THREE.Vector3() },
    // the section this piece was just cut along: wet (1 → 0 over ~1 s), and
    // for an instant it catches the light
    uFresh: { value: 0 },
    uFlash: { value: 0 },
    uSigma: { value: sigma },
    uGlowColor: { value: new THREE.Color(cw.glow) },
    uCloudiness: look.uCloudiness,
    uCloudMul: { value: cw.cloud },
    uCloudDensity: look.uCloudDensity,
    uGlowStrength: look.uGlowStrength,
    uThicknessScale: look.uThicknessScale,
    uReliefStrength: look.uReliefStrength,
    uDebug: look.uDebug,
  }

  const main = new THREE.MeshPhysicalMaterial({
    color: tint,
    roughness: 0.34,
    metalness: 0,
    ior: 1.45,
    transmission: 1,
    thickness: 0.5,
    attenuationColor: absorbColor,
    attenuationDistance: 1,
    specularIntensity: 1,
    // the waxed skin: a soft, broad sheen rather than a mirror coat
    clearcoat: 0.3,
    clearcoatRoughness: 0.24,
    envMapIntensity: 1,
    side: THREE.FrontSide,
  })

  main.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${DEFORM_GLSL}
attribute float aSkin; // 1 moulded skin, 0 an old section, 2 the section just cut
varying vec2 vRestXY;
varying vec3 vRelX;
varying vec3 vRelY;
varying float vFresh;`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = vec3( normal );
vec3 jellyPos;
mat3 jellyCof;
jellyDeform( jellyPos, objectNormal, jellyCof );
// the moulded relief lives on the front skin, in rest x/y: carry those axes
// through the deformation exactly as the normal was (same cofactor, same
// scale), so a rest-space slope tilts the view-space normal correctly
float jScale = 1.0 / max( length( jellyCof * normal ), 1e-6 );
float jSkin = aSkin > 0.5 && aSkin < 1.5 ? 1.0 : 0.0;
vFresh = aSkin > 1.5 ? 1.0 : 0.0;
float jFront = jSkin * smoothstep( 0.12, 0.5, normal.z ) * normal.z * jScale;
vRelX = normalMatrix * ( jellyCof * vec3( 1.0, 0.0, 0.0 ) ) * jFront;
vRelY = normalMatrix * ( jellyCof * vec3( 0.0, 1.0, 0.0 ) ) * jFront;
vRestXY = position.xy;`
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = jellyPos;')

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uBackDepth;
uniform vec2 uResolution;
uniform vec3 uSigma;
uniform vec3 uGlowColor;
uniform float uCloudiness;
uniform float uCloudMul;
uniform float uCloudDensity;
uniform float uGlowStrength;
uniform float uThicknessScale;
uniform sampler2D uRelief;
uniform vec2 uReliefMin;
uniform vec2 uReliefSize;
uniform float uReliefStrength;
uniform float uDebug;
uniform float uFresh;
uniform float uFlash;
varying vec2 vRestXY;
varying vec3 vRelX;
varying vec3 vRelY;
varying float vFresh;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
// a fresh section is wet-smooth: the studio's softboxes mirror in it
roughnessFactor = mix( roughnessFactor, 0.05, vFresh * uFresh );`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // (∂h/∂x, ∂h/∂y, h) of the fine relief: smile, fur marks, pad outlines…
  vec3 jRel = texture2D( uRelief, ( vRestXY - uReliefMin ) / uReliefSize ).xyz;
  normal = normalize( normal - uReliefStrength * ( jRel.x * vRelX + jRel.y * vRelY ) );
}`
      )
      .replace(
        '#include <clearcoat_normal_fragment_begin>',
        `#include <clearcoat_normal_fragment_begin>
#ifdef USE_CLEARCOAT
  clearcoatNormal = normal; // the glossy skin follows the moulding
#endif`
      )
      .replace(
        '#include <transmission_fragment>',
        `
// thickness along the view ray: our back face behind this pixel minus us
float jBack = texture2D( uBackDepth, gl_FragCoord.xy / uResolution ).r;
float jFront = vViewPosition.z;
float jThick = jBack > jFront ? jBack - jFront : 0.04;
jThick = clamp( jThick, 0.0, 2.5 ) * uThicknessScale;
` +
          THREE.ShaderChunk.transmission_fragment
            .replace('material.thickness = thickness;', 'material.thickness = jThick;')
            // light scattered inside the candy crosses candy too: absorb it on the way
            .replace('vec3 pos = vWorldPosition;', 'totalDiffuse *= exp( -uSigma * jThick * 0.5 );\n\tvec3 pos = vWorldPosition;')
            // thicker candy scatters more of the light it lets through
            .replace(
              'material.transmission = transmission;',
              'material.transmission = transmission * ( 1.0 - uCloudiness * uCloudMul * ( 1.0 - exp( - jThick * uCloudDensity ) ) );'
            )
      )
      .replace(
        '#include <opaque_fragment>',
        `
#if NUM_DIR_LIGHTS > 0
{
  // light behind thin parts shines through, tinted by what survives the trip
  vec3 jV = normalize( vViewPosition );
  vec3 jGlow = vec3( 0.0 );
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
    vec3 L = directionalLights[ i ].direction;
    vec3 Hb = normalize( L + normal * 0.35 );
    float back = pow( clamp( dot( jV, -Hb ), 0.0, 1.0 ), 3.0 );
    jGlow += directionalLights[ i ].color * back;
  }
  vec3 jT = exp( -uSigma * ( jThick * 0.55 + 0.02 ) );
  outgoingLight += jGlow * uGlowColor * jT * uGlowStrength;
}
#endif
// the instant of the cut: the new face catches the light
outgoingLight += vFresh * uFlash * ( 0.6 * uGlowColor + 0.3 );
#include <opaque_fragment>
if ( uDebug > 0.5 && uDebug < 1.5 ) gl_FragColor = vec4( vec3( jThick / 1.2 ), 1.0 );`
      )
  }
  main.customProgramCacheKey = () => 'jelly-main-v5'

  const back = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      ${DEFORM_GLSL}
      varying float vViewZ;
      void main() {
        vec3 n = normal;
        vec3 p;
        mat3 cof;
        jellyDeform(p, n, cof);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vViewZ;
      void main() { gl_FragColor = vec4(vViewZ, 0.0, 0.0, 1.0); }
    `,
  })

  return { main, back, uniforms }
}

// One set of "look" uniforms shared by every body, driven by the panel.
export function createLookUniforms() {
  return {
    uCloudiness: { value: 0.3 },
    uCloudDensity: { value: 2.2 },
    uGlowStrength: { value: 0.35 },
    uThicknessScale: { value: 1 },
    uReliefStrength: { value: 1 },
    uDebug: { value: 0 },
  }
}

// Render geometry for a body: rest normals + the trilinear embedding.
export function createBodyGeometry(render, lattice) {
  const g = new THREE.BufferGeometry()
  const V = render.positions.length / 3
  g.setAttribute('position', new THREE.BufferAttribute(render.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(render.normals, 3))
  const A = new Float32Array(4 * V)
  const B = new Float32Array(4 * V)
  const { cellOf, uvw } = render.embed
  const CN = lattice.cellNodes
  for (let v = 0; v < V; v++) {
    const c = 8 * cellOf[v]
    A[4 * v] = CN[c]; A[4 * v + 1] = CN[c + 1]; A[4 * v + 2] = CN[c + 2]; A[4 * v + 3] = CN[c + 3]
    B[4 * v] = CN[c + 4]; B[4 * v + 1] = CN[c + 5]; B[4 * v + 2] = CN[c + 6]; B[4 * v + 3] = CN[c + 7]
  }
  g.setAttribute('aNodesA', new THREE.BufferAttribute(A, 4))
  g.setAttribute('aNodesB', new THREE.BufferAttribute(B, 4))
  g.setAttribute('aUVW', new THREE.BufferAttribute(uvw, 3))
  g.setAttribute('aSkin', new THREE.BufferAttribute(render.skin, 1))
  g.setIndex(new THREE.BufferAttribute(render.index, 1))
  return g
}
